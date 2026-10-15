import Foundation

// MARK: - Le conversazioni con GPT
//
// Ogni messaggio tiene due forme: quella vera, che vede solo l'utente, e quella anonimizzata, l'unica che esce dal Mac.
// La conversazione si rimanda intera a ogni domanda (Codex non tiene memoria), sempre nella forma anonimizzata.

/// Un allegato della chat: un file, la scheda di un cliente, un documento del CRM.
public struct ChatAttachment: Codable, Sendable, Identifiable, Equatable, Hashable {
    public var id: UUID
    /// Il nome vero (solo sul Mac).
    public var name: String
    /// Il nome e il contenuto come sono partiti.
    public var sentName: String
    public var sentText: String
    /// «3 nomi, 1 IBAN» oppure vuoto.
    public var summary: String

    public init(id: UUID = UUID(), name: String, sentName: String, sentText: String, summary: String) {
        self.id = id
        self.name = name
        self.sentName = sentName
        self.sentText = sentText
        self.summary = summary
    }
}

public struct ChatMessage: Codable, Sendable, Identifiable, Equatable, Hashable {
    public enum Role: String, Codable, Sendable { case user, assistant }

    public var id: UUID
    public var role: Role
    public var date: Date
    /// Il testo con i dati veri: quello scritto dall'utente, o la risposta riconvertita.
    public var text: String
    /// Il testo con i segnaposto: quello partito, o la risposta così come è arrivata.
    public var sent: String
    public var attachments: [ChatAttachment]
    /// Cosa è stato nascosto (domande) o rimesso (risposte).
    public var summary: String
    /// Segnaposto che il dizionario non conosce (inventati da GPT): restano come sono.
    public var unknown: [String]
    /// Le modifiche ai documenti (o i documenti nuovi) che GPT propone: si applicano solo con la conferma.
    public var proposals: [ChatProposal]
    /// I documenti del progetto che GPT ha letto per rispondere (titoli veri).
    public var readDocuments: [String]

    public init(id: UUID = UUID(), role: Role, date: Date = .now, text: String, sent: String, attachments: [ChatAttachment] = [],
                summary: String = "", unknown: [String] = [], proposals: [ChatProposal] = [], readDocuments: [String] = []) {
        self.id = id
        self.role = role
        self.date = date
        self.text = text
        self.sent = sent
        self.attachments = attachments
        self.summary = summary
        self.unknown = unknown
        self.proposals = proposals
        self.readDocuments = readDocuments
    }

    enum CodingKeys: String, CodingKey { case id, role, date, text, sent, attachments, summary, unknown, proposals, readDocuments }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        role = try c.decode(Role.self, forKey: .role)
        date = c.value(.date, default: .now)
        text = c.value(.text, default: "")
        sent = c.value(.sent, default: "")
        attachments = c.value(.attachments, default: [])
        summary = c.value(.summary, default: "")
        unknown = c.value(.unknown, default: [])
        proposals = c.value(.proposals, default: [])
        readDocuments = c.value(.readDocuments, default: [])
    }
}

/// Una modifica a un documento del progetto, o un documento nuovo, proposta da GPT. Il contenuto è anonimizzato.
public struct ChatProposal: Codable, Sendable, Identifiable, Equatable, Hashable {
    public enum Status: String, Codable, Sendable { case pending, applied, discarded }

    public var id = UUID()
    /// Il documento da modificare; nil per un documento nuovo.
    public var documentID: UUID?
    /// Il titolo con i segnaposto (per un documento nuovo è quello scritto da GPT).
    public var sentTitle: String
    /// Il testo completo proposto, con i segnaposto.
    public var content: String
    public var status = Status.pending

    public init(documentID: UUID?, sentTitle: String, content: String) {
        self.documentID = documentID
        self.sentTitle = sentTitle
        self.content = content
    }

    public var isNewDocument: Bool { documentID == nil }
}

public struct ChatConversation: Codable, Sendable, Identifiable, Equatable, Hashable {
    public var id: UUID
    public var title: String
    /// Il cliente del CRM a cui legare i dati trovati (e le note salvate).
    public var clientID: UUID?
    public var created: Date
    public var updated: Date
    public var messages: [ChatMessage]

    public init(id: UUID = UUID(), title: String = "", clientID: UUID? = nil, created: Date = .now, messages: [ChatMessage] = []) {
        self.id = id
        self.title = title
        self.clientID = clientID
        self.created = created
        updated = created
        self.messages = messages
    }

    /// Il titolo da mostrare: quello scelto, o l'inizio della prima domanda.
    public var displayTitle: String {
        if !title.trimmingCharacters(in: .whitespaces).isEmpty { return title }
        guard let first = messages.first(where: { $0.role == .user }) else { return "Nuova conversazione" }
        let line = first.text.split(whereSeparator: \.isNewline).first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
        if line.isEmpty { return first.attachments.first?.name ?? "Nuova conversazione" }
        return line.count > 60 ? String(line.prefix(59)) + "…" : line
    }
}

// MARK: - Su disco, cifrate

/// Le conversazioni stanno nella cartella cifrata dell'app (`chat.sigillato`), insieme a dizionario e CRM, e finiscono
/// nella copia di sicurezza.
public actor ChatStore {
    public static let fileName = "chat"

    public nonisolated let folder: SecureFolder
    /// Il file cifrato delle conversazioni («chat», o quello di un progetto).
    public nonisolated let fileName: String
    private var conversations: [ChatConversation] = []
    private var isOpen = false

    public init(folder: SecureFolder, fileName: String = ChatStore.fileName) {
        self.folder = folder
        self.fileName = fileName
    }

    /// Le conversazioni, dalla più recente.
    @discardableResult
    public func open() throws -> [ChatConversation] {
        if !isOpen {
            if let data = try folder.read(fileName) {
                do {
                    conversations = try JSONDecoder().decode([ChatConversation].self, from: data)
                } catch {
                    throw SecureFolder.FolderError.unreadable(name: fileName, reason: error.localizedDescription)
                }
            } else {
                try folder.unlock()
            }
            isOpen = true
        }
        return conversations.sorted { $0.updated > $1.updated }
    }

    /// Salva (o aggiunge) una conversazione.
    @discardableResult
    public func save(_ conversation: ChatConversation) throws -> [ChatConversation] {
        var copy = try open()
        if let index = copy.firstIndex(where: { $0.id == conversation.id }) { copy[index] = conversation } else { copy.append(conversation) }
        try write(copy)
        return try open()
    }

    @discardableResult
    public func delete(_ id: UUID) throws -> [ChatConversation] {
        try write(try open().filter { $0.id != id })
        return try open()
    }

    /// Un cliente cancellato dal CRM: le sue conversazioni restano, senza il legame.
    @discardableResult
    public func unlink(client: UUID) throws -> [ChatConversation] {
        let copy = try open().map { conversation in
            var conversation = conversation
            if conversation.clientID == client { conversation.clientID = nil }
            return conversation
        }
        try write(copy)
        return try open()
    }

    /// Dopo un ripristino: rilegge dal disco.
    @discardableResult
    public func reload() throws -> [ChatConversation] {
        isOpen = false
        conversations = []
        return try open()
    }

    private func write(_ copy: [ChatConversation]) throws {
        guard copy != conversations else { return }
        try folder.write(JSONEncoder().encode(copy), to: fileName)
        conversations = copy
    }
}
