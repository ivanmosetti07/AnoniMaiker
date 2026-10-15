import Foundation

// MARK: - Tutti i dati del CRM
//
// Un archivio solo, in memoria e su disco (cifrato). Le cancellazioni portano via quello che dipende dal dato:
// un'azienda si porta via i suoi contatti, trattative, attività e documenti.

public struct CRMDatabase: Codable, Sendable, Equatable {
    public static let currentVersion = 1

    public var companies: [Company] = []
    public var contacts: [Contact] = []
    public var deals: [Deal] = []
    public var activities: [Activity] = []
    public var documents: [CRMDocument] = []

    public init() {}

    enum CodingKeys: String, CodingKey {
        case version, companies, contacts, deals, activities, documents
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let version = c.value(.version, default: 1)
        guard version <= Self.currentVersion else {
            throw DecodingError.dataCorruptedError(forKey: .version, in: c, debugDescription: "CRM di una versione più recente dell'app (\(version))")
        }
        companies = c.value(.companies, default: [])
        contacts = c.value(.contacts, default: [])
        deals = c.value(.deals, default: [])
        activities = c.value(.activities, default: [])
        documents = c.value(.documents, default: [])
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(Self.currentVersion, forKey: .version)
        try c.encode(companies, forKey: .companies)
        try c.encode(contacts, forKey: .contacts)
        try c.encode(deals, forKey: .deals)
        try c.encode(activities, forKey: .activities)
        try c.encode(documents, forKey: .documents)
    }

    public var isEmpty: Bool {
        companies.isEmpty && contacts.isEmpty && deals.isEmpty && activities.isEmpty && documents.isEmpty
    }

    // MARK: Lettura

    public func company(_ id: UUID?) -> Company? { id.flatMap { id in companies.first { $0.id == id } } }
    public func contact(_ id: UUID?) -> Contact? { id.flatMap { id in contacts.first { $0.id == id } } }
    public func deal(_ id: UUID?) -> Deal? { id.flatMap { id in deals.first { $0.id == id } } }
    public func document(_ id: UUID?) -> CRMDocument? { id.flatMap { id in documents.first { $0.id == id } } }

    /// Le aziende in ordine alfabetico.
    public var sortedCompanies: [Company] {
        companies.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    public func contacts(of companyID: UUID) -> [Contact] {
        contacts.filter { $0.companyID == companyID }.sorted { $0.fullName.localizedStandardCompare($1.fullName) == .orderedAscending }
    }

    public func deals(of companyID: UUID) -> [Deal] {
        deals.filter { $0.companyID == companyID }.sorted { $0.updated > $1.updated }
    }

    /// Note e attività dell'azienda, dalla più recente.
    public func activities(of companyID: UUID) -> [Activity] {
        activities.filter { $0.companyID == companyID }.sorted { $0.date > $1.date }
    }

    public func documents(of companyID: UUID) -> [CRMDocument] {
        documents.filter { $0.companyID == companyID }.sorted { $0.updated > $1.updated }
    }

    /// Le cose da fare non ancora fatte, dalla scadenza più vicina (quelle senza scadenza in fondo).
    public var openTasks: [Activity] {
        activities.filter { $0.kind == .task && !$0.isDone }.sorted { ($0.due ?? .distantFuture) < ($1.due ?? .distantFuture) }
    }

    // MARK: Modifiche

    public mutating func save(_ company: Company, now: Date = .now) {
        var company = company
        company.updated = now
        upsert(company, in: &companies)
    }

    public mutating func save(_ contact: Contact, now: Date = .now) {
        var contact = contact
        contact.updated = now
        upsert(contact, in: &contacts)
    }

    public mutating func save(_ deal: Deal, now: Date = .now) {
        var deal = deal
        deal.updated = now
        upsert(deal, in: &deals)
    }

    public mutating func save(_ activity: Activity, now: Date = .now) {
        var activity = activity
        activity.updated = now
        upsert(activity, in: &activities)
    }

    public mutating func save(_ document: CRMDocument, now: Date = .now) {
        var document = document
        document.updated = now
        upsert(document, in: &documents)
    }

    private func upsert<T: Identifiable>(_ item: T, in list: inout [T]) where T.ID == UUID {
        if let index = list.firstIndex(where: { $0.id == item.id }) { list[index] = item } else { list.append(item) }
    }

    public mutating func deleteContact(_ id: UUID) {
        contacts.removeAll { $0.id == id }
        for index in deals.indices where deals[index].contactID == id { deals[index].contactID = nil }
        for index in activities.indices where activities[index].contactID == id { activities[index].contactID = nil }
    }

    public mutating func deleteDeal(_ id: UUID) {
        deals.removeAll { $0.id == id }
        for index in activities.indices where activities[index].dealID == id { activities[index].dealID = nil }
    }

    public mutating func deleteActivity(_ id: UUID) {
        activities.removeAll { $0.id == id }
    }

    /// Toglie un documento; restituisce i file cifrati delle sue versioni, da cancellare.
    public mutating func deleteDocument(_ id: UUID) -> [String] {
        guard let index = documents.firstIndex(where: { $0.id == id }) else { return [] }
        let blobs = documents[index].versions.map(\.blobName)
        documents.remove(at: index)
        return blobs
    }

    /// Quanto si porterebbe via la cancellazione di un'azienda.
    public func removalCounts(of companyID: UUID) -> (contacts: Int, deals: Int, activities: Int, documents: Int) {
        (contacts.count { $0.companyID == companyID }, deals.count { $0.companyID == companyID },
         activities.count { $0.companyID == companyID }, documents.count { $0.companyID == companyID })
    }

    /// Toglie un'azienda con contatti, trattative, attività e documenti; restituisce i file cifrati da cancellare.
    public mutating func deleteCompany(_ id: UUID) -> [String] {
        companies.removeAll { $0.id == id }
        let contactIDs = Set(contacts.filter { $0.companyID == id }.map(\.id))
        for contactID in contactIDs { deleteContact(contactID) }
        let dealIDs = Set(deals.filter { $0.companyID == id }.map(\.id))
        for dealID in dealIDs { deleteDeal(dealID) }
        activities.removeAll { $0.companyID == id }
        var blobs: [String] = []
        for document in documents where document.companyID == id { blobs += document.versions.map(\.blobName) }
        documents.removeAll { $0.companyID == id }
        return blobs
    }
}
