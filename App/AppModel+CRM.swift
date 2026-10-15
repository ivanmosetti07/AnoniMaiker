import AnonymizerKit
import AppKit
import Foundation

// MARK: - Il CRM dell'app
//
// Ogni modifica passa dall'archivio cifrato e torna come CRM aggiornato. Dentro la scheda di un cliente
// l'anonimizzazione usa anche i dati che il CRM conosce (ragione sociale, partita IVA, contatti) e lega le voci del
// dizionario al cliente.

extension AppModel {
    // MARK: Schede

    func save(_ company: Company) async {
        await perform { crm = try await crmStore.update { $0.save(company) } }
    }

    func save(_ contact: Contact) async {
        await perform { crm = try await crmStore.update { $0.save(contact) } }
    }

    func save(_ deal: Deal) async {
        await perform { crm = try await crmStore.update { $0.save(deal) } }
    }

    func save(_ activity: Activity) async {
        await perform { crm = try await crmStore.update { $0.save(activity) } }
    }

    func toggleDone(_ activity: Activity) async {
        var activity = activity
        activity.isDone.toggle()
        await save(activity)
    }

    func deleteContact(_ id: UUID) async {
        await perform { crm = try await crmStore.update { $0.deleteContact(id) } }
    }

    func deleteDeal(_ id: UUID) async {
        await perform { crm = try await crmStore.update { $0.deleteDeal(id) } }
    }

    func deleteActivity(_ id: UUID) async {
        await perform { crm = try await crmStore.update { $0.deleteActivity(id) } }
    }

    /// Toglie un'azienda con tutto quello che le appartiene; a richiesta anche i suoi dati dal dizionario.
    func deleteCompany(_ id: UUID, removeFromDictionary: Bool) async {
        await perform {
            crm = try await crmStore.deleteCompany(id)
            chat.conversations = try await chatStore.unlink(client: id)
            if removeFromDictionary {
                _ = try await store.update { $0.removeClient(id) }
                await refreshVault()
            }
        }
        companiesPath.removeAll { $0 == .company(id) }
    }

    // MARK: Documenti

    func chooseDocuments(for companyID: UUID?) async {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = FilePanels.documentTypes
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.message = "Scegli i file del cliente (testo, Markdown, CSV, Excel, Word, PDF): restano cifrati su questo Mac"
        panel.prompt = "Aggiungi"
        guard panel.runModal() == .OK else { return }
        await addDocuments(panel.urls, to: companyID)
    }

    func addDocuments(_ urls: [URL], to companyID: UUID?) async {
        for url in urls {
            await perform { crm = try await crmStore.addDocument(from: url, companyID: companyID).database }
        }
    }

    /// Il file di una versione (l'originale, l'anonimizzato, una risposta dell'AI).
    func data(of version: DocumentVersion) async throws -> Data {
        try await crmStore.data(of: version)
    }

    /// Anonimizza un documento del cliente (in qualunque formato), con i dati che il CRM conosce di lui.
    func anonymizeDocument(_ documentID: UUID) async {
        guard let engine, let document = crm.document(documentID), let original = document.original,
              !busyDocuments.contains(documentID) else { return }
        busyDocuments.insert(documentID)
        defer { busyDocuments.remove(documentID) }
        let known = document.companyID.map { crm.knownValues(for: $0) } ?? []
        let settings = settings
        await perform {
            let data = try await crmStore.data(of: original)
            let anonymizer = Anonymizer(engine: engine, store: store)
            let outcome = try await anonymizer.anonymizeFile(data, format: document.format, fileExtension: (original.fileName as NSString).pathExtension,
                                                             settings: settings, client: document.companyID, known: known)
            var summary = outcome.report.map { $0.isEmpty ? "Nessun dato da nascondere" : "Nascosti: \($0.summary)" } ?? ""
            if outcome.recognizedPages > 0 { summary += " · \(outcome.recognizedPages) pagine lette con l'OCR" }
            crm = try await crmStore.setAnonymized(outcome.data, summary: summary, for: documentID)
            await refreshVault()
        }
    }

    /// Aggiunge a un documento la risposta di un'AI: un file con i segnaposto, in qualunque formato gestito.
    func importAnswer(for documentID: UUID) async {
        guard let url = FilePanels.chooseDocument() else { return }
        guard let format = DocumentFormat.of(url) else {
            alert = DocumentFormat.FormatError.unsupported(url.pathExtension.lowercased()).localizedDescription
            return
        }
        await perform { try await addAnswer(Data(contentsOf: url), format: format, fileName: url.lastPathComponent, to: documentID) }
    }

    /// Aggiunge a un documento la risposta di un'AI copiata negli appunti (testo).
    func pasteAnswer(for documentID: UUID) async {
        guard let pasted = NSPasteboard.general.string(forType: .string), !pasted.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            alert = "Negli appunti non c'è testo da incollare."
            return
        }
        await perform { try await addAnswer(Data(pasted.utf8), format: .markdown, fileName: "", to: documentID) }
    }

    private func addAnswer(_ data: Data, format: DocumentFormat, fileName: String, to documentID: UUID) async throws {
        let outcome = try await FileReveal.reveal(data, format: format, fileExtension: (fileName as NSString).pathExtension,
                                                  vault: try await store.snapshot())
        let result = outcome.reveal ?? RevealResult(text: "")
        var summary = result.count == 0 ? "Nessun segnaposto da riconvertire" : "Riconvertiti \(result.count) segnaposto"
        if !result.unknown.isEmpty { summary += " · \(result.unknown.count) sconosciuti" }
        crm = try await crmStore.addAnswer(data, format: format, fileName: fileName, summary: summary, for: documentID)
    }

    func removeVersion(_ versionID: UUID, from documentID: UUID) async {
        await perform { crm = try await crmStore.removeVersion(versionID, from: documentID) }
    }

    func deleteDocument(_ documentID: UUID) async {
        await perform { crm = try await crmStore.deleteDocument(documentID) }
        companiesPath.removeAll { $0 == .document(documentID) }
    }

    /// Salva una versione in un file: l'originale e l'anonimizzato come sono, una risposta dell'AI riconvertita.
    func export(_ version: DocumentVersion, of document: CRMDocument) async {
        await perform {
            var data = try await crmStore.data(of: version)
            let format = document.format(of: version)
            let original = document.original?.fileName ?? ""
            let base = original.isEmpty ? "\(document.title).\(document.format.defaultExtension)" : original
            // Una risposta in un altro formato (testo incollato) prende la sua estensione.
            let fileName = version.kind == .aiAnswer && format != document.format
                ? "\((base as NSString).deletingPathExtension).\(format.defaultExtension)" : base
            let url = URL(filePath: "/").appending(path: fileName)
            let name: String
            switch version.kind {
            case .original:
                name = fileName
            case .anonymized:
                name = DocumentNaming.anonymizedName(for: url, vault: vault, settings: settings)
            case .aiAnswer:
                let current = try await store.snapshot()
                data = try await FileReveal.reveal(data, format: format, fileExtension: url.pathExtension, vault: current).data
                name = DocumentNaming.revealedName(for: url, vault: current)
            }
            try FilePanels.save(data, suggestedName: name, in: nil)
        }
    }

    /// Come mostrare una versione: originale e anonimizzato come sono, una risposta dell'AI riconvertita.
    /// `compared`: l'anteprima con i segnaposto, per evidenziare cosa è cambiato.
    func preview(of version: DocumentVersion, in document: CRMDocument) async throws
        -> (preview: DocumentPreview, compared: DocumentPreview?, highlights: [NSRange], unknown: [String]) {
        let data = try await crmStore.data(of: version)
        let format = document.format(of: version)
        let ext = (version.fileName as NSString).pathExtension
        switch version.kind {
        case .original:
            return (try await FileReveal.preview(data, format: format, fileExtension: ext), nil, [], [])
        case .anonymized:
            let preview = try await FileReveal.preview(data, format: format, fileExtension: ext)
            return (preview, nil, Revealer.placeholderRanges(in: preview.plainText), [])
        case .aiAnswer:
            let raw = try await FileReveal.preview(data, format: format, fileExtension: ext)
            let outcome = try await FileReveal.reveal(data, format: format, fileExtension: ext, vault: vault)
            var highlights: [NSRange] = []
            if case .text = outcome.preview {
                let revealed = Revealer.reveal(raw.plainText, vault: vault)
                if revealed.text == outcome.preview.plainText { highlights = revealed.spans }
            }
            return (outcome.preview, raw, highlights, outcome.reveal?.unknown ?? [])
        }
    }

    // MARK: Scheda del cliente

    /// La scheda in Markdown e la sua versione anonimizzata (con i dati noti del cliente).
    func dossier(for companyID: UUID) async throws -> (original: String, anonymized: AnonymizationResult) {
        guard let engine else { throw EngineError.notInstalled }
        guard let markdown = ClientDossier.markdown(for: companyID, in: crm) else { throw EngineError.failed("cliente non trovato") }
        let anonymizer = Anonymizer(engine: engine, store: store)
        let result = try await anonymizer.anonymize(markdown, settings: settings, client: companyID, known: crm.knownValues(for: companyID))
        await refreshVault()
        return (markdown, result)
    }

    /// Dal banco «Anonimizza» alla scheda del cliente: il testo o il file diventa un documento con la sua versione anonimizzata.
    func saveToClient(_ space: Workspace) async {
        guard let companyID = space.clientID, crm.company(companyID) != nil, space.hasOutput, !space.isStale,
              case .anonymized(let report) = space.outcome else { return }
        let title = space.source.map { $0.url.deletingPathExtension().lastPathComponent }
            ?? "Testo del \(Date.now.formatted(date: .abbreviated, time: .shortened))"
        let fileName = space.source?.url.lastPathComponent ?? ""
        let summary = report.isEmpty ? "Nessun dato da nascondere" : "Nascosti: \(report.summary)"
        let original: (data: Data, format: DocumentFormat)
        let anonymized: Data
        if let source = space.source, source.isFile {
            guard let output = space.outputData else { return }
            original = (source.data, source.format)
            anonymized = output
        } else {
            let text = space.source?.text ?? TextDocument(text: space.input, kind: .plainText)
            var result = text
            result.text = space.output
            original = (text.data(), text.kind == .markdown ? .markdown : .plainText)
            anonymized = result.data()
        }
        await perform {
            let added = try await crmStore.addDocument(title: title, data: original.data, format: original.format, fileName: fileName,
                                                       companyID: companyID)
            crm = try await crmStore.setAnonymized(anonymized, summary: summary, for: added.document.id)
        }
    }

    // MARK: Navigazione

    func openCompany(_ id: UUID) {
        section = .companies
        companiesPath = [.company(id)]
    }

    /// Il dizionario filtrato sulle voci di un cliente.
    func showDictionary(of companyID: UUID) {
        dictionaryClient = companyID
        section = .dictionary
    }

    /// Le aziende per i menu di scelta, in ordine alfabetico.
    var companyChoices: [Company] { crm.sortedCompanies }
}
