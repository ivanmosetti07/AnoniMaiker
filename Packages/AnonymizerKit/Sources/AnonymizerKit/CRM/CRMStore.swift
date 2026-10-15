import Foundation

// MARK: - Il CRM su disco, cifrato
//
// `crm.sigillato` con aziende, contatti, trattative, attività e l'elenco dei documenti; il testo di ogni versione di
// un documento sta in un suo file cifrato (`documenti/<id>.sigillato`), così un salvataggio del CRM non riscrive i
// documenti. Ogni modifica si salva subito.

public actor CRMStore {
    static let fileName = "crm"

    public nonisolated let folder: SecureFolder
    private var database = CRMDatabase()
    private var isOpen = false

    public init(folder: SecureFolder) {
        self.folder = folder
    }

    @discardableResult
    public func open() throws -> CRMDatabase {
        if isOpen { return database }
        if let data = try folder.read(Self.fileName) {
            do {
                database = try JSONDecoder().decode(CRMDatabase.self, from: data)
            } catch {
                throw SecureFolder.FolderError.unreadable(name: Self.fileName, reason: error.localizedDescription)
            }
        } else {
            try folder.unlock()
        }
        isOpen = true
        return database
    }

    public func snapshot() throws -> CRMDatabase { try open() }

    /// Modifica il CRM e lo salva subito cifrato; restituisce il CRM aggiornato.
    @discardableResult
    public func update(_ body: @Sendable (inout CRMDatabase) throws -> Void) throws -> CRMDatabase {
        var copy = try open()
        try body(&copy)
        try save(copy)
        return copy
    }

    private func save(_ copy: CRMDatabase) throws {
        guard copy != database else { return }
        try folder.write(JSONEncoder().encode(copy), to: Self.fileName)
        database = copy
    }

    /// Dopo un ripristino: rilegge dal disco.
    @discardableResult
    public func reload() throws -> CRMDatabase {
        isOpen = false
        database = CRMDatabase()
        return try open()
    }

    // MARK: Cancellazioni con i loro file

    @discardableResult
    public func deleteCompany(_ id: UUID) throws -> CRMDatabase {
        var copy = try open()
        let blobs = copy.deleteCompany(id)
        try save(copy)
        for blob in blobs { try? folder.delete(blob) }
        return copy
    }

    @discardableResult
    public func deleteDocument(_ id: UUID) throws -> CRMDatabase {
        var copy = try open()
        let blobs = copy.deleteDocument(id)
        try save(copy)
        for blob in blobs { try? folder.delete(blob) }
        return copy
    }

    // MARK: Documenti

    /// Archivia un file (testo, Markdown, CSV, Excel, Word, PDF) nella scheda di un cliente: l'originale si conserva com'è,
    /// byte per byte.
    public func addDocument(from url: URL, title: String? = nil, companyID: UUID?) throws -> (document: CRMDocument, database: CRMDatabase) {
        guard let format = DocumentFormat.of(url) else { throw DocumentFormat.FormatError.unsupported(url.pathExtension.lowercased()) }
        return try addDocument(title: title ?? url.deletingPathExtension().lastPathComponent, data: Data(contentsOf: url), format: format,
                               fileName: url.lastPathComponent, companyID: companyID)
    }

    /// Archivia un testo (per esempio incollato) come documento del cliente.
    public func addDocument(title: String, text: TextDocument, fileName: String, companyID: UUID?) throws -> (document: CRMDocument, database: CRMDatabase) {
        try addDocument(title: title, data: text.data(), format: text.kind == .markdown ? .markdown : .plainText, fileName: fileName,
                        companyID: companyID)
    }

    /// Archivia un file già letto.
    public func addDocument(title: String, data: Data, format: DocumentFormat, fileName: String,
                            companyID: UUID?) throws -> (document: CRMDocument, database: CRMDatabase) {
        var document = CRMDocument(title: title, format: format, companyID: companyID)
        let version = DocumentVersion(kind: .original, fileName: fileName)
        try folder.write(data, to: version.blobName)
        document.versions = [version]
        let added = document
        let database = try update { $0.save(added) }
        return (added, database)
    }

    /// Il file di una versione, com'è.
    public func data(of version: DocumentVersion) throws -> Data {
        guard let data = try folder.read(version.blobName) else {
            throw SecureFolder.FolderError.unreadable(name: version.blobName, reason: "file mancante")
        }
        return data
    }

    /// Il testo di una versione di testo o Markdown, con la codifica e il BOM con cui è arrivata.
    public func text(of version: DocumentVersion, in document: CRMDocument) throws -> TextDocument {
        let format = document.format(of: version)
        return try TextDocument.decode(data(of: version), kind: format == .markdown ? .markdown : .plainText)
    }

    /// Mette (o sostituisce) la versione anonimizzata di un documento.
    @discardableResult
    public func setAnonymized(_ data: Data, summary: String, for documentID: UUID) throws -> CRMDatabase {
        var copy = try open()
        guard var document = copy.document(documentID) else { return copy }
        let old = document.versions.filter { $0.kind == .anonymized }
        let version = DocumentVersion(kind: .anonymized, fileName: document.original?.fileName ?? "", summary: summary)
        try folder.write(data, to: version.blobName)
        document.versions.removeAll { $0.kind == .anonymized }
        document.versions.append(version)
        copy.save(document)
        try save(copy)
        for version in old { try? folder.delete(version.blobName) }
        return copy
    }

    @discardableResult
    public func setAnonymized(_ text: TextDocument, summary: String, for documentID: UUID) throws -> CRMDatabase {
        try setAnonymized(text.data(), summary: summary, for: documentID)
    }

    /// Aggiunge la risposta di un'AI (con i segnaposto) a un documento: un file di qualunque formato, o un testo incollato.
    @discardableResult
    public func addAnswer(_ data: Data, format: DocumentFormat, fileName: String, summary: String, for documentID: UUID) throws -> CRMDatabase {
        var copy = try open()
        guard var document = copy.document(documentID) else { return copy }
        let version = DocumentVersion(kind: .aiAnswer, fileName: fileName, format: format == document.format ? nil : format, summary: summary)
        try folder.write(data, to: version.blobName)
        document.versions.append(version)
        copy.save(document)
        try save(copy)
        return copy
    }

    @discardableResult
    public func addAnswer(_ text: TextDocument, fileName: String, summary: String, for documentID: UUID) throws -> CRMDatabase {
        try addAnswer(text.data(), format: text.kind == .markdown ? .markdown : .plainText, fileName: fileName, summary: summary, for: documentID)
    }

    /// Toglie una versione (non l'originale).
    @discardableResult
    public func removeVersion(_ versionID: UUID, from documentID: UUID) throws -> CRMDatabase {
        var copy = try open()
        guard var document = copy.document(documentID),
              let version = document.versions.first(where: { $0.id == versionID }), version.kind != .original else { return copy }
        document.versions.removeAll { $0.id == versionID }
        copy.save(document)
        try save(copy)
        try? folder.delete(version.blobName)
        return copy
    }
}
