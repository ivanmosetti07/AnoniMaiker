import AnonymizerKit
import AppKit
import Foundation

// MARK: - Il CRM del progetto
//
// Ogni modifica passa dall'archivio cifrato del progetto e torna come CRM aggiornato. L'anonimizzazione usa anche i
// dati che il CRM del progetto conosce (ragioni sociali, partite IVA, persone), così si nascondono anche dove il motore
// non li riconosce.

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

    /// Toglie un'azienda dal CRM del progetto: persone, trattative, attività e documenti restano, senza l'azienda.
    func deleteCompany(_ id: UUID) async {
        await perform {
            crm = try await crmStore.update { database in
                database.companies.removeAll { $0.id == id }
                for index in database.contacts.indices where database.contacts[index].companyID == id { database.contacts[index].companyID = nil }
                for index in database.deals.indices where database.deals[index].companyID == id { database.deals[index].companyID = nil }
                for index in database.activities.indices where database.activities[index].companyID == id { database.activities[index].companyID = nil }
                for index in database.documents.indices where database.documents[index].companyID == id { database.documents[index].companyID = nil }
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
        panel.message = "Scegli i file del progetto (testo, Markdown, CSV, Excel, Word, PDF): si anonimizzano e restano cifrati su questo Mac"
        panel.prompt = "Aggiungi"
        guard panel.runModal() == .OK else { return }
        await addDocuments(panel.urls, to: companyID)
    }

    /// Aggiunge file ai documenti del progetto e li anonimizza subito (le persone trovate entrano nel CRM).
    func addDocuments(_ urls: [URL], to companyID: UUID?) async {
        for url in urls {
            var added: UUID?
            await perform {
                let result = try await crmStore.addDocument(from: url, companyID: companyID)
                crm = result.database
                added = result.document.id
            }
            if let added, engine != nil { await anonymizeDocument(added) }
        }
        await touchCurrentProject()
    }

    /// Il file di una versione (l'originale, l'anonimizzato, una risposta dell'AI).
    func data(of version: DocumentVersion) async throws -> Data {
        try await crmStore.data(of: version)
    }

    /// Anonimizza un documento del progetto (in qualunque formato), con i dati che il CRM conosce; le persone e le
    /// aziende trovate entrano nel CRM.
    func anonymizeDocument(_ documentID: UUID) async {
        guard let engine, let document = crm.document(documentID), let original = document.original,
              !busyDocuments.contains(documentID) else { return }
        busyDocuments.insert(documentID)
        defer { busyDocuments.remove(documentID) }
        let known = crm.knownValues()
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
            try await extractPeople(from: outcome.preview.plainText, source: original.fileName.isEmpty ? document.title : original.fileName)
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
        documentsPath.removeAll { $0 == .document(documentID) }
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

    // MARK: Navigazione

    func openCompany(_ id: UUID?) {
        guard let id else { return }
        section = .companies
        companiesPath = [.company(id)]
    }

    func openDocument(_ id: UUID) {
        section = .documents
        // Dopo il cambio di sezione: la pila di navigazione nasce adesso.
        Task {
            try? await Task.sleep(for: .milliseconds(50))
            documentsPath = [.document(id)]
        }
    }

    /// Il dizionario filtrato sulle voci di un cliente.
    func showDictionary(of companyID: UUID) {
        dictionaryClient = companyID
        section = .dictionary
    }

    /// Le aziende per i menu di scelta, in ordine alfabetico.
    var companyChoices: [Company] { crm.sortedCompanies }
}
