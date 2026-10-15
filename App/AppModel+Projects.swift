import AnonymizerKit
import AppKit
import Foundation

// MARK: - I progetti
//
// Aprire un progetto carica il suo dizionario, il suo CRM e le sue conversazioni. Un file anonimizzato dentro un
// progetto finisce da solo fra i suoi documenti (originale e versione anonimizzata), e le persone e le aziende trovate
// entrano nel suo CRM.

extension AppModel {
    /// Carica gli archivi del progetto aperto.
    func loadProject() async throws {
        chat.task?.cancel()
        chat.selectedID = nil
        chat.pending = []
        chat.error = nil
        companiesPath = []
        documentsPath = []
        dictionaryClient = nil
        guard hasProject else {
            vault = Vault()
            crm = CRMDatabase()
            chat.conversations = []
            return
        }
        vault = try await store.open()
        crm = try await crmStore.open()
        chat.conversations = try await chatStore.open()
    }

    func selectProject(_ id: UUID?) {
        guard id != currentProjectID || id == nil else { return }
        currentProjectID = id
        if let id { section = section == .dictionary ? .anonymize : section; touch(id) }
        Task { await perform { try await loadProject() } }
    }

    /// Torna all'elenco dei progetti.
    func showProjects() {
        currentProjectID = nil
        Task { await perform { try await loadProject() } }
    }

    func createProject(named name: String) async {
        await perform {
            let project = try await projectStore.create(name: name)
            projects = try await projectStore.open()
            currentProjectID = project.id
            section = .anonymize
            try await loadProject()
        }
    }

    func renameProject(_ id: UUID, to name: String) async {
        await perform { projects = try await projectStore.rename(id, to: name) }
    }

    /// Cancella il progetto con documenti, CRM, dizionario e conversazioni.
    func deleteProject(_ id: UUID) async {
        await perform {
            projects = try await projectStore.delete(id)
            removeWorkspaces(of: id)
            if currentProjectID == id {
                currentProjectID = nil
                try await loadProject()
            }
        }
    }

    private func touch(_ id: UUID) {
        Task {
            try? await projectStore.touch(id)
            if let updated = try? await projectStore.open() { projects = updated }
        }
    }

    // MARK: Documenti e CRM dal banco «Anonimizza»

    /// Un file anonimizzato entra nei documenti del progetto (o aggiorna quello che c'è già con lo stesso nome), e le
    /// persone e aziende trovate entrano nel CRM. Restituisce la nota da mostrare.
    func archive(original data: Data, format: DocumentFormat, fileName: String, anonymized: Data, anonymizedText: String,
                 report: AnonymizationReport?) async throws -> String {
        let title = (fileName as NSString).deletingPathExtension
        var summary = report.map { $0.isEmpty ? "Nessun dato da nascondere" : "Nascosti: \($0.summary)" } ?? ""
        if summary.isEmpty { summary = "Anonimizzato" }
        let documentID: UUID
        if let existing = crm.documents.first(where: { $0.title == title && $0.original?.fileName == fileName && $0.format == format }) {
            documentID = existing.id
        } else {
            documentID = try await crmStore.addDocument(title: title, data: data, format: format, fileName: fileName, companyID: nil).document.id
        }
        crm = try await crmStore.setAnonymized(anonymized, summary: summary, for: documentID)
        let extraction = try await extractPeople(from: anonymizedText, source: fileName)
        await touchCurrentProject()
        return ["Salvato nei documenti del progetto", extraction.summary].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// Persone e aziende di un testo anonimizzato entrano nel CRM del progetto.
    @discardableResult
    func extractPeople(from anonymized: String, source: String) async throws -> CRMExtractionReport {
        let current = try await store.snapshot()
        var database = try await crmStore.snapshot()
        let report = CRMExtraction.apply(anonymized, vault: current, source: source, to: &database)
        guard !report.isEmpty else { return report }
        let updated = database
        crm = try await crmStore.update { $0 = updated }
        return report
    }

    func touchCurrentProject() async {
        guard let id = currentProjectID else { return }
        try? await projectStore.touch(id)
        if let updated = try? await projectStore.open() { projects = updated }
    }

    /// Il testo del banco «Anonimizza» entra nei documenti del progetto (con il CRM).
    func saveToProject(_ space: Workspace) async {
        guard hasProject, space.hasOutput, !space.isStale, case .anonymized(let report) = space.outcome else { return }
        await perform {
            if let source = space.source, source.isFile, let output = space.outputData {
                space.projectNote = try await archive(original: source.data, format: source.format, fileName: source.url.lastPathComponent,
                                                      anonymized: output, anonymizedText: space.output, report: report)
            } else {
                let text = space.source?.text ?? TextDocument(text: space.input, kind: .plainText)
                var result = text
                result.text = space.output
                let format: DocumentFormat = text.kind == .markdown ? .markdown : .plainText
                // Un testo incollato prende il nome dalla sua prima riga.
                let firstLine = space.input.split(whereSeparator: \.isNewline).first.map(String.init)?
                    .trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "/", with: "-") ?? ""
                let title = firstLine.isEmpty ? "Testo del \(Date.now.formatted(.dateTime.day().month().year().hour().minute()))"
                    : String(firstLine.prefix(60))
                let fileName = space.source?.url.lastPathComponent ?? "\(title).\(format.defaultExtension)"
                space.projectNote = try await archive(original: text.data(), format: format, fileName: fileName,
                                                      anonymized: result.data(), anonymizedText: space.output, report: report)
            }
        }
    }
}
