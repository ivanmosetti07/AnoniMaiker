import Foundation

// MARK: - I progetti
//
// Un progetto contiene tutto quello che serve a un lavoro: i suoi documenti, il suo CRM (persone, aziende, trattative,
// attività), il suo dizionario dei segnaposto e le sue conversazioni con GPT. Ognuno sta nella cartella cifrata in file
// suoi («progetti/<id>_dizionario», «progetti/<id>_crm», «progetti/<id>_chat»); l'elenco sta in «elenco-progetti».
// I documenti restano in «documenti/…», uno per versione, come prima.
//
// Alla prima apertura i dati delle versioni precedenti (un dizionario, un CRM e una chat per tutta l'app) diventano
// progetti: uno per ogni cliente, con i suoi contatti, trattative, attività, documenti, voci del dizionario e
// conversazioni; quello che non è di nessun cliente va nel progetto «Generale». I segnaposto restano quelli di prima.

public struct Project: Codable, Sendable, Identifiable, Hashable {
    public var id = UUID()
    public var name: String
    public var notes = ""
    public var created = Date.now
    public var updated = Date.now

    public init(name: String, notes: String = "", created: Date = .now) {
        self.name = name
        self.notes = notes
        self.created = created
        updated = created
    }

    enum CodingKeys: String, CodingKey { case id, name, notes, created, updated }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = c.value(.name, default: "Progetto")
        notes = c.value(.notes, default: "")
        created = c.value(.created, default: .now)
        updated = c.value(.updated, default: .now)
    }
}

/// Gli archivi di un progetto: dizionario, CRM e conversazioni. Uno solo per progetto, condiviso da tutta l'app.
public final class ProjectSpace: Sendable {
    public let id: UUID
    public let vault: VaultStore
    public let crm: CRMStore
    public let chat: ChatStore

    init(id: UUID, folder: SecureFolder) {
        self.id = id
        vault = VaultStore(folder: folder, fileName: Self.fileName(id, "dizionario"))
        crm = CRMStore(folder: folder, fileName: Self.fileName(id, "crm"))
        chat = ChatStore(folder: folder, fileName: Self.fileName(id, "chat"))
    }

    static func fileName(_ id: UUID, _ kind: String) -> String { "progetti/\(id.uuidString)_\(kind)" }

    var fileNames: [String] { ["dizionario", "crm", "chat"].map { Self.fileName(id, $0) } }
}

public actor ProjectStore {
    static let indexName = "elenco-progetti"

    public nonisolated let folder: SecureFolder
    private var projects: [Project] = []
    private var isOpen = false
    private let spaces = SpaceCache()

    public init(folder: SecureFolder) {
        self.folder = folder
    }

    /// Gli archivi di un progetto (sempre gli stessi oggetti: due archivi sullo stesso file perderebbero modifiche).
    public nonisolated func space(_ id: UUID) -> ProjectSpace {
        spaces.space(id, folder: folder)
    }

    /// I progetti, dal più recente. La prima volta porta nei progetti i dati delle versioni precedenti.
    @discardableResult
    public func open() throws -> [Project] {
        if !isOpen {
            if let data = try folder.read(Self.indexName) {
                do {
                    projects = try JSONDecoder().decode([Project].self, from: data)
                } catch {
                    throw SecureFolder.FolderError.unreadable(name: Self.indexName, reason: error.localizedDescription)
                }
            } else {
                projects = try migrateLegacyData()
            }
            isOpen = true
        }
        return sorted
    }

    private var sorted: [Project] { projects.sorted { $0.updated > $1.updated } }

    /// Dopo un ripristino: rilegge dal disco (e se la copia era di una versione precedente, la porta nei progetti).
    @discardableResult
    public func reload() throws -> [Project] {
        isOpen = false
        projects = []
        spaces.removeAll()
        return try open()
    }

    public func create(name: String, now: Date = .now) throws -> Project {
        try open()
        let project = Project(name: Self.cleaned(name), created: now)
        projects.append(project)
        try save()
        return project
    }

    public func rename(_ id: UUID, to name: String) throws -> [Project] {
        try open()
        guard let index = projects.firstIndex(where: { $0.id == id }) else { return sorted }
        projects[index].name = Self.cleaned(name)
        try save()
        return sorted
    }

    /// Il progetto è stato usato adesso: sale in cima all'elenco.
    public func touch(_ id: UUID, now: Date = .now) throws {
        try open()
        guard let index = projects.firstIndex(where: { $0.id == id }) else { return }
        projects[index].updated = now
        try save()
    }

    /// Cancella un progetto con tutto quello che contiene: documenti, CRM, dizionario e conversazioni.
    public func delete(_ id: UUID) async throws -> [Project] {
        try open()
        let space = space(id)
        let database = try await space.crm.snapshot()
        for blob in database.documents.flatMap({ $0.versions.map(\.blobName) }) { try folder.delete(blob) }
        for name in space.fileNames { try folder.delete(name) }
        projects.removeAll { $0.id == id }
        spaces.remove(id)
        try save()
        return sorted
    }

    private func save() throws {
        try folder.write(JSONEncoder().encode(projects), to: Self.indexName)
    }

    static func cleaned(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Nuovo progetto" : trimmed
    }

    // MARK: Dai dati delle versioni precedenti

    /// Un progetto per ogni cliente, più «Generale» per il resto. Se non c'è niente, nessun progetto.
    private func migrateLegacyData() throws -> [Project] {
        let vault = try folder.read(VaultStore.fileName).map { try JSONDecoder().decode(Vault.self, from: $0) } ?? Vault()
        let crm = try folder.read(CRMStore.fileName).map { try JSONDecoder().decode(CRMDatabase.self, from: $0) } ?? CRMDatabase()
        let chats = try folder.read(ChatStore.fileName).map { try JSONDecoder().decode([ChatConversation].self, from: $0) } ?? []
        try folder.unlock()

        var result: [Project] = []
        let plan = Self.split(vault: vault, crm: crm, chats: chats)
        for part in plan {
            var project = Project(name: part.name, created: part.created)
            project.updated = part.updated
            let space = ProjectSpace(id: project.id, folder: folder)
            try folder.write(JSONEncoder().encode(part.vault), to: Self.fileName(of: space.vault))
            try folder.write(JSONEncoder().encode(part.crm), to: Self.fileName(of: space.crm))
            try folder.write(JSONEncoder().encode(part.chats), to: Self.fileName(of: space.chat))
            result.append(project)
        }
        projects = result
        try save()
        // I file vecchi servono solo a questo passaggio: tolti, i dati restano solo nei progetti.
        for name in [VaultStore.fileName, CRMStore.fileName, ChatStore.fileName] { try folder.delete(name) }
        return result
    }

    private static func fileName(of store: VaultStore) -> String { store.fileName }
    private static func fileName(of store: CRMStore) -> String { store.fileName }
    private static func fileName(of store: ChatStore) -> String { store.fileName }

    struct Part {
        var name: String
        var created: Date
        var updated: Date
        var vault: Vault
        var crm: CRMDatabase
        var chats: [ChatConversation]
    }

    /// Come si dividono i dati di prima: ogni cliente con le sue cose, il resto in «Generale».
    static func split(vault: Vault, crm: CRMDatabase, chats: [ChatConversation]) -> [Part] {
        var parts: [Part] = []
        var placed = (contacts: Set<UUID>(), deals: Set<UUID>(), activities: Set<UUID>(), documents: Set<UUID>(), chats: Set<UUID>())
        for company in crm.companies {
            var database = CRMDatabase()
            database.companies = [company]
            database.contacts = crm.contacts.filter { $0.companyID == company.id }
            database.deals = crm.deals.filter { $0.companyID == company.id }
            database.activities = crm.activities.filter { $0.companyID == company.id }
            database.documents = crm.documents.filter { $0.companyID == company.id }
            placed.contacts.formUnion(database.contacts.map(\.id))
            placed.deals.formUnion(database.deals.map(\.id))
            placed.activities.formUnion(database.activities.map(\.id))
            placed.documents.formUnion(database.documents.map(\.id))
            let conversations = chats.filter { $0.clientID == company.id }
            placed.chats.formUnion(conversations.map(\.id))
            let dates = database.documents.map(\.updated) + database.activities.map(\.updated) + [company.updated]
            parts.append(Part(name: company.name.isEmpty ? "Cliente senza nome" : company.name, created: company.created,
                              updated: dates.max() ?? company.updated,
                              vault: vault.subset { $0.clients.contains(company.id) }, crm: database, chats: conversations))
        }
        var rest = CRMDatabase()
        rest.contacts = crm.contacts.filter { !placed.contacts.contains($0.id) }
        rest.deals = crm.deals.filter { !placed.deals.contains($0.id) }
        rest.activities = crm.activities.filter { !placed.activities.contains($0.id) }
        rest.documents = crm.documents.filter { !placed.documents.contains($0.id) }
        let companyIDs = Set(crm.companies.map(\.id))
        let restVault = vault.subset { $0.clients.isDisjoint(with: companyIDs) }
        let restChats = chats.filter { !placed.chats.contains($0.id) }
        if !rest.isEmpty || !restVault.isEmpty || !restChats.isEmpty {
            let dates = rest.documents.map(\.updated) + restChats.map(\.updated) + restVault.entries.map(\.lastUsed)
            parts.append(Part(name: "Generale", created: dates.min() ?? .now, updated: dates.max() ?? .now,
                              vault: restVault, crm: rest, chats: restChats))
        }
        return parts
    }
}

/// Gli archivi già aperti, uno per progetto.
private final class SpaceCache: @unchecked Sendable {
    private let lock = NSLock()
    private var spaces: [UUID: ProjectSpace] = [:]

    func space(_ id: UUID, folder: SecureFolder) -> ProjectSpace {
        lock.withLock {
            if let space = spaces[id] { return space }
            let space = ProjectSpace(id: id, folder: folder)
            spaces[id] = space
            return space
        }
    }

    func remove(_ id: UUID) {
        lock.withLock { _ = spaces.removeValue(forKey: id) }
    }

    func removeAll() {
        lock.withLock { spaces.removeAll() }
    }
}
