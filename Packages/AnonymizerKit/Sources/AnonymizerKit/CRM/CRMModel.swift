import Foundation

// MARK: - Il CRM dentro l'app
//
// Aziende (i clienti), contatti, trattative, note e attività, documenti. I dati veri restano sul Mac, cifrati nella
// stessa cartella del dizionario. Ogni tipo si legge in modo tollerante: un campo che manca (scritto da una versione
// più vecchia dell'app) prende il suo valore di partenza, così le versioni future possono aggiungere campi.

extension KeyedDecodingContainer {
    func value<T: Decodable>(_ key: Key, default value: T) -> T {
        (try? decodeIfPresent(T.self, forKey: key)) ?? value
    }
}

public enum CompanyStatus: String, Codable, Sendable, CaseIterable, Identifiable {
    case prospect, client, former, supplier, partner

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .prospect: "Potenziale"
        case .client: "Cliente"
        case .former: "Ex cliente"
        case .supplier: "Fornitore"
        case .partner: "Partner"
        }
    }
}

/// Un'azienda: il cliente del CRM.
public struct Company: Codable, Sendable, Identifiable, Hashable {
    public var id = UUID()
    public var name = ""
    public var status = CompanyStatus.prospect
    public var sector = ""
    public var vatNumber = ""
    public var taxCode = ""
    public var iban = ""
    public var email = ""
    public var pec = ""
    public var phone = ""
    public var website = ""
    /// Via e numero civico.
    public var street = ""
    public var zipCode = ""
    public var city = ""
    public var province = ""
    public var notes = ""
    public var created = Date.now
    public var updated = Date.now

    public init(name: String = "", status: CompanyStatus = .prospect) {
        self.name = name
        self.status = status
    }

    enum CodingKeys: String, CodingKey {
        case id, name, status, sector, vatNumber, taxCode, iban, email, pec, phone, website, street, zipCode, city, province, notes, created, updated
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = c.value(.name, default: "")
        status = c.value(.status, default: .prospect)
        sector = c.value(.sector, default: "")
        vatNumber = c.value(.vatNumber, default: "")
        taxCode = c.value(.taxCode, default: "")
        iban = c.value(.iban, default: "")
        email = c.value(.email, default: "")
        pec = c.value(.pec, default: "")
        phone = c.value(.phone, default: "")
        website = c.value(.website, default: "")
        street = c.value(.street, default: "")
        zipCode = c.value(.zipCode, default: "")
        city = c.value(.city, default: "")
        province = c.value(.province, default: "")
        notes = c.value(.notes, default: "")
        created = c.value(.created, default: .now)
        updated = c.value(.updated, default: .now)
    }

    /// «via Garibaldi 24, 20121 Milano (MI)».
    public var address: String {
        let place = [zipCode, city].filter { !$0.isEmpty }.joined(separator: " ") + (province.isEmpty ? "" : " (\(province))")
        return [street, place.trimmingCharacters(in: .whitespaces)].filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

/// Una persona, di solito di un'azienda cliente.
public struct Contact: Codable, Sendable, Identifiable, Hashable {
    public var id = UUID()
    public var firstName = ""
    public var lastName = ""
    public var role = ""
    public var email = ""
    public var phone = ""
    public var mobile = ""
    public var taxCode = ""
    public var notes = ""
    public var companyID: UUID?
    public var created = Date.now
    public var updated = Date.now

    public init(firstName: String = "", lastName: String = "", companyID: UUID? = nil) {
        self.firstName = firstName
        self.lastName = lastName
        self.companyID = companyID
    }

    enum CodingKeys: String, CodingKey {
        case id, firstName, lastName, role, email, phone, mobile, taxCode, notes, companyID, created, updated
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        firstName = c.value(.firstName, default: "")
        lastName = c.value(.lastName, default: "")
        role = c.value(.role, default: "")
        email = c.value(.email, default: "")
        phone = c.value(.phone, default: "")
        mobile = c.value(.mobile, default: "")
        taxCode = c.value(.taxCode, default: "")
        notes = c.value(.notes, default: "")
        companyID = c.value(.companyID, default: nil)
        created = c.value(.created, default: .now)
        updated = c.value(.updated, default: .now)
    }

    /// «Mario Rossi».
    public var fullName: String {
        [firstName, lastName].map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

public enum DealStage: String, Codable, Sendable, CaseIterable, Identifiable {
    case new, qualified, proposal, negotiation, won, lost

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .new: "Nuova"
        case .qualified: "Qualificata"
        case .proposal: "Preventivo inviato"
        case .negotiation: "In trattativa"
        case .won: "Vinta"
        case .lost: "Persa"
        }
    }

    /// Probabilità proposta quando si sceglie la fase.
    public var defaultProbability: Int {
        switch self {
        case .new: 10
        case .qualified: 25
        case .proposal: 50
        case .negotiation: 75
        case .won: 100
        case .lost: 0
        }
    }

    public var isOpen: Bool { self != .won && self != .lost }
}

/// Una trattativa o un preventivo.
public struct Deal: Codable, Sendable, Identifiable, Hashable {
    public var id = UUID()
    public var title = ""
    /// L'azienda della trattativa (in un progetto può anche non esserci).
    public var companyID: UUID?
    public var contactID: UUID?
    public var stage = DealStage.new
    public var amount: Decimal?
    public var probability = DealStage.new.defaultProbability
    public var expectedClose: Date?
    public var notes = ""
    public var created = Date.now
    public var updated = Date.now

    public init(title: String = "", companyID: UUID? = nil) {
        self.title = title
        self.companyID = companyID
    }

    enum CodingKeys: String, CodingKey {
        case id, title, companyID, contactID, stage, amount, probability, expectedClose, notes, created, updated
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        companyID = c.value(.companyID, default: nil)
        title = c.value(.title, default: "")
        contactID = c.value(.contactID, default: nil)
        stage = c.value(.stage, default: .new)
        amount = c.value(.amount, default: nil)
        probability = c.value(.probability, default: stage.defaultProbability)
        expectedClose = c.value(.expectedClose, default: nil)
        notes = c.value(.notes, default: "")
        created = c.value(.created, default: .now)
        updated = c.value(.updated, default: .now)
    }

    /// Importo pesato con la probabilità.
    public var weightedAmount: Decimal? { amount.map { $0 * Decimal(probability) / 100 } }
}

public enum ActivityKind: String, Codable, Sendable, CaseIterable, Identifiable {
    case note, call, email, meeting, task

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .note: "Nota"
        case .call: "Chiamata"
        case .email: "Email"
        case .meeting: "Riunione"
        case .task: "Da fare"
        }
    }

    public var symbol: String {
        switch self {
        case .note: "note.text"
        case .call: "phone"
        case .email: "envelope"
        case .meeting: "person.2"
        case .task: "checklist"
        }
    }
}

/// Una nota o un'attività (chiamata, email, riunione, cosa da fare).
public struct Activity: Codable, Sendable, Identifiable, Hashable {
    public var id = UUID()
    public var kind = ActivityKind.note
    public var text = ""
    public var date = Date.now
    /// Solo per le cose da fare.
    public var due: Date?
    public var isDone = false
    public var companyID: UUID?
    public var contactID: UUID?
    public var dealID: UUID?
    public var created = Date.now
    public var updated = Date.now

    public init(kind: ActivityKind = .note, text: String = "", companyID: UUID? = nil) {
        self.kind = kind
        self.text = text
        self.companyID = companyID
    }

    enum CodingKeys: String, CodingKey {
        case id, kind, text, date, due, isDone, companyID, contactID, dealID, created, updated
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        kind = c.value(.kind, default: .note)
        text = c.value(.text, default: "")
        date = c.value(.date, default: .now)
        due = c.value(.due, default: nil)
        isDone = c.value(.isDone, default: false)
        companyID = c.value(.companyID, default: nil)
        contactID = c.value(.contactID, default: nil)
        dealID = c.value(.dealID, default: nil)
        created = c.value(.created, default: .now)
        updated = c.value(.updated, default: .now)
    }

    /// Una cosa da fare non fatta, scaduta prima di oggi.
    public func isOverdue(now: Date = .now, calendar: Calendar = .current) -> Bool {
        guard kind == .task, !isDone, let due else { return false }
        return due < calendar.startOfDay(for: now)
    }
}

/// Una versione di un documento: l'originale, quella anonimizzata, le risposte dell'AI (con i segnaposto). Il file di
/// ogni versione si conserva intero, cifrato (`documenti/<id>`).
public struct DocumentVersion: Codable, Sendable, Identifiable, Hashable {
    public enum Kind: String, Codable, Sendable {
        case original, anonymized, aiAnswer
    }

    /// Anche il nome del file cifrato che la contiene (`documenti/<id>`).
    public var id = UUID()
    public var kind: Kind
    public var created = Date.now
    /// Il file da cui viene (originale e risposte importate).
    public var fileName = ""
    /// Il formato, se è diverso da quello del documento (una risposta dell'AI incollata come testo).
    public var format: DocumentFormat?
    /// «Nascosti: 3 nomi, 1 IBAN».
    public var summary = ""

    public init(kind: Kind, fileName: String = "", format: DocumentFormat? = nil, summary: String = "") {
        self.kind = kind
        self.fileName = fileName
        self.format = format
        self.summary = summary
    }

    enum CodingKeys: String, CodingKey {
        case id, kind, created, fileName, format, summary
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        kind = try c.decode(Kind.self, forKey: .kind)
        created = c.value(.created, default: .now)
        fileName = c.value(.fileName, default: "")
        format = c.value(.format, default: nil)
        summary = c.value(.summary, default: "")
    }

    var blobName: String { "documenti/\(id.uuidString)" }
}

/// Un documento del cliente, con le sue versioni.
public struct CRMDocument: Codable, Sendable, Identifiable, Hashable {
    public var id = UUID()
    public var title = ""
    public var format = DocumentFormat.plainText
    public var companyID: UUID?
    public var versions: [DocumentVersion] = []
    public var created = Date.now
    public var updated = Date.now

    public init(title: String, format: DocumentFormat, companyID: UUID?) {
        self.title = title
        self.format = format
        self.companyID = companyID
    }

    enum CodingKeys: String, CodingKey {
        case id, title, format, kind, companyID, versions, created, updated
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        title = c.value(.title, default: "")
        // Fino alla versione 0.2 c'erano solo testo e Markdown («kind»).
        let legacy: TextDocument.Kind = c.value(.kind, default: .plainText)
        format = c.value(.format, default: legacy == .markdown ? .markdown : .plainText)
        companyID = c.value(.companyID, default: nil)
        versions = c.value(.versions, default: [])
        created = c.value(.created, default: .now)
        updated = c.value(.updated, default: .now)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encode(format, forKey: .format)
        try c.encodeIfPresent(companyID, forKey: .companyID)
        try c.encode(versions, forKey: .versions)
        try c.encode(created, forKey: .created)
        try c.encode(updated, forKey: .updated)
    }

    public var original: DocumentVersion? { versions.first { $0.kind == .original } }
    public var anonymized: DocumentVersion? { versions.last { $0.kind == .anonymized } }
    public var answers: [DocumentVersion] { versions.filter { $0.kind == .aiAnswer } }

    /// Il formato di una versione.
    public func format(of version: DocumentVersion) -> DocumentFormat { version.format ?? format }
}
