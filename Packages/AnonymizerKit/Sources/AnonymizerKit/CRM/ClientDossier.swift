import Foundation

// MARK: - La scheda del cliente, da anonimizzare
//
// Il CRM racconta un cliente in Markdown (anagrafica, contatti, trattative, ultime note e cose da fare, documenti):
// è il testo che si anonimizza e si dà all'AI per preparare un'offerta, una mail, un riepilogo.

public enum ClientDossier {
    static let locale = Locale(identifier: "it_IT")

    static func date(_ date: Date) -> String {
        date.formatted(.dateTime.day(.twoDigits).month(.twoDigits).year().locale(locale))
    }

    /// «12.500,00 €», con spazi normali (il formato di sistema usa spazi non separabili).
    public static func amount(_ value: Decimal) -> String {
        value.formatted(.currency(code: "EUR").locale(locale))
            .replacingOccurrences(of: "\u{00A0}", with: " ").replacingOccurrences(of: "\u{202F}", with: " ")
    }

    /// La scheda in Markdown; nil se l'azienda non c'è.
    public static func markdown(for companyID: UUID, in database: CRMDatabase, now: Date = .now, recentActivities: Int = 10) -> String? {
        guard let company = database.company(companyID) else { return nil }
        var lines = ["# \(company.name)", ""]
        let headline = [company.status.title, company.sector].filter { !$0.isEmpty }.joined(separator: " · ")
        if !headline.isEmpty { lines += [headline, ""] }

        var details: [String] = []
        func add(_ title: String, _ value: String) {
            let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty { details.append("- \(title): \(value)") }
        }
        add("Partita IVA", company.vatNumber)
        add("Codice fiscale", company.taxCode)
        add("Sede", company.address)
        add("Email", company.email)
        add("PEC", company.pec)
        add("Telefono", company.phone)
        add("Sito", company.website)
        add("IBAN", company.iban)
        if !details.isEmpty { lines += details + [""] }
        if !company.notes.isEmpty { lines += ["## Note sul cliente", "", company.notes, ""] }

        let contacts = database.contacts(of: companyID)
        if !contacts.isEmpty {
            lines += ["## Contatti", ""]
            for contact in contacts {
                let parts = [contact.fullName, contact.role, contact.email, contact.phone, contact.mobile].filter { !$0.isEmpty }
                lines.append("- " + parts.joined(separator: " — "))
            }
            lines.append("")
        }

        let deals = database.deals(of: companyID)
        let open = deals.filter(\.stage.isOpen)
        if !open.isEmpty {
            lines += ["## Trattative aperte", ""]
            for deal in open { lines.append("- " + dealLine(deal, in: database)) }
            lines.append("")
        }
        let closed = deals.filter { !$0.stage.isOpen }
        if !closed.isEmpty {
            lines += ["## Trattative chiuse", ""]
            for deal in closed.prefix(5) { lines.append("- " + dealLine(deal, in: database)) }
            lines.append("")
        }

        let tasks = database.activities(of: companyID).filter { $0.kind == .task && !$0.isDone }
        if !tasks.isEmpty {
            lines += ["## Cose da fare", ""]
            for task in tasks.sorted(by: { ($0.due ?? .distantFuture) < ($1.due ?? .distantFuture) }) {
                let due = task.due.map { " (entro il \(date($0))\(task.isOverdue(now: now) ? ", scaduta" : ""))" } ?? ""
                lines.append("- \(task.text)\(due)")
            }
            lines.append("")
        }

        let history = database.activities(of: companyID).filter { $0.kind != .task }.prefix(recentActivities)
        if !history.isEmpty {
            lines += ["## Ultime note e attività", ""]
            for activity in history {
                let who = database.contact(activity.contactID).map { " con \($0.fullName)" } ?? ""
                lines.append("- \(date(activity.date)) · \(activity.kind.title)\(who): \(activity.text)")
            }
            lines.append("")
        }

        let documents = database.documents(of: companyID)
        if !documents.isEmpty {
            lines += ["## Documenti", ""]
            for document in documents { lines.append("- \(document.title) (\(document.format.title), \(date(document.created)))") }
            lines.append("")
        }
        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines) + "\n"
    }

    static func dealLine(_ deal: Deal, in database: CRMDatabase) -> String {
        var parts = [deal.title.isEmpty ? "Trattativa" : deal.title, deal.stage.title]
        if let amount = deal.amount { parts.append(Self.amount(amount)) }
        if deal.stage.isOpen { parts.append("probabilità \(deal.probability)%") }
        if let close = deal.expectedClose { parts.append("chiusura prevista \(date(close))") }
        if let contact = database.contact(deal.contactID) { parts.append("referente \(contact.fullName)") }
        return parts.joined(separator: " — ")
    }
}

// MARK: - Quello che il CRM sa già essere sensibile

/// Un dato del cliente con la sua categoria: «Edilnord S.r.l.» è un'azienda, «Mario Rossi» un nome.
public struct KnownValue: Sendable, Hashable {
    public let label: String
    public let value: String

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }
}

extension CRMDatabase {
    /// I dati del cliente che il CRM conosce: prima di anonimizzare entrano nel dizionario, così si nascondono anche dove
    /// il motore non li riconosce.
    public func knownValues(for companyID: UUID) -> [KnownValue] {
        guard let company = company(companyID) else { return [] }
        var values = KnownValues()
        values.add(company)
        for contact in contacts(of: companyID) { values.add(contact) }
        return values.list
    }

    /// Tutto quello che il CRM di un progetto conosce: aziende e persone.
    public func knownValues() -> [KnownValue] {
        var values = KnownValues()
        for company in companies { values.add(company) }
        for contact in contacts { values.add(contact) }
        return values.list
    }
}

/// I dati noti, senza doppioni e senza campi vuoti.
private struct KnownValues {
    var list: [KnownValue] = []
    private var seen = Set<KnownValue>()

    mutating func add(_ label: String, _ value: String) {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        let known = KnownValue(label: label, value: value)
        if seen.insert(known).inserted { list.append(known) }
    }

    mutating func add(_ company: Company) {
        add("ORG", company.name)
        add("PIVA", company.vatNumber)
        // Il codice fiscale di una società è spesso la sua partita IVA (11 cifre).
        add(company.taxCode.filter(\.isNumber).count == 11 && company.taxCode.allSatisfy { $0.isNumber || $0 == " " } ? "PIVA" : "CF", company.taxCode)
        add("IBAN", company.iban)
        add("EMAIL", company.email)
        add("EMAIL", company.pec)
        add("TELEPHONENUM", company.phone)
        add("URL", company.website)
    }

    mutating func add(_ contact: Contact) {
        if contact.fullName.split(separator: " ").count >= 2 { add("FULLNAME", contact.fullName) }
        add("EMAIL", contact.email)
        add("TELEPHONENUM", contact.phone)
        add("TELEPHONENUM", contact.mobile)
        add("CF", contact.taxCode)
    }
}
