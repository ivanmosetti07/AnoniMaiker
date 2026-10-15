import Foundation

// MARK: - Il CRM del progetto si riempie dai documenti
//
// Dopo l'anonimizzazione, il testo con i segnaposto dice dove sono persone e aziende. Si legge riga per riga (in una
// tabella una riga è una riga del foglio): ogni nome diventa una persona, ogni azienda un'azienda. Se su una riga c'è
// una sola persona, email, telefono e codice fiscale della riga sono suoi, e così l'azienda se è una sola. Nome e
// cognome in due colonne vicine («Mario» «Rossi») sono una persona sola. Chi c'è già non si duplica: si completano
// solo i campi vuoti.

public struct CRMExtractionReport: Sendable, Equatable {
    public var newPeople = 0
    public var newCompanies = 0
    public var updatedPeople = 0

    public init() {}

    public var isEmpty: Bool { newPeople == 0 && newCompanies == 0 && updatedPeople == 0 }

    /// «12 persone e 3 aziende nuove nel CRM»
    public var summary: String {
        var parts: [String] = []
        if newPeople > 0 { parts.append(newPeople == 1 ? "1 persona" : "\(newPeople) persone") }
        if newCompanies > 0 { parts.append(newCompanies == 1 ? "1 azienda" : "\(newCompanies) aziende") }
        var text = parts.isEmpty ? "" : parts.joined(separator: " e ") + (newPeople + newCompanies == 1 ? " nuova" : " nuove") + " nel CRM"
        if updatedPeople > 0 {
            text += (text.isEmpty ? "" : ", ") + (updatedPeople == 1 ? "1 persona completata" : "\(updatedPeople) persone completate")
        }
        return text
    }
}

public enum CRMExtraction {
    private static let placeholder = try! NSRegularExpression(pattern: #"\[([A-Z_]+)_(\d+)\]"#)

    /// Aggiunge al CRM persone e aziende trovate nel testo anonimizzato `anonymized`. `source` è il nome del documento.
    @discardableResult
    public static func apply(_ anonymized: String, vault: Vault, source: String, to database: inout CRMDatabase,
                             now: Date = .now) -> CRMExtractionReport {
        var report = CRMExtractionReport()
        var companiesByName = Dictionary(database.companies.map { (key(Masking.withoutLegalForm($0.name)), $0.id) },
                                         uniquingKeysWith: { first, _ in first })
        var peopleByName = Dictionary(database.contacts.map { (key($0.fullName), $0.id) }, uniquingKeysWith: { first, _ in first })
        let note = "Trovato in «\(source)»."

        for line in anonymized.split(whereSeparator: \.isNewline) {
            let text = String(line)
            let found = values(in: text, vault: vault)
            guard !found.isEmpty else { continue }

            // Aziende della riga.
            var lineCompanies: [UUID] = []
            for value in found where value.label == "ORG" {
                let name = value.value
                let k = key(Masking.withoutLegalForm(name))
                guard !k.isEmpty, !Masking.isPlace(label: "ORG", value: name) else { continue }
                if let id = companiesByName[k] {
                    lineCompanies.append(id)
                } else {
                    var company = Company()
                    company.name = name
                    company.notes = note.replacingOccurrences(of: "Trovato", with: "Trovata")
                    database.save(company, now: now)
                    companiesByName[k] = company.id
                    lineCompanies.append(company.id)
                    report.newCompanies += 1
                }
            }

            // Persone della riga: nome e cognome in due celle vicine diventano una persona sola.
            let names = found.filter { $0.label == "FULLNAME" }.map(\.value)
            var people: [String] = []
            if names.count == 2, names.allSatisfy({ $0.split(separator: " ").count == 1 }) {
                people = [names.joined(separator: " ")]
            } else {
                people = names.filter { $0.split(separator: " ").count >= 2 }
            }
            people = people.filter { !Masking.isPlace(label: "FULLNAME", value: $0) }
            let single = people.count == 1
            for name in people {
                let k = key(name)
                var contact: Contact
                var isNew = false
                if let id = peopleByName[k], let existing = database.contact(id) {
                    contact = existing
                } else {
                    let parts = name.split(separator: " ", maxSplits: 1).map(String.init)
                    contact = Contact(firstName: parts[0], lastName: parts.count > 1 ? parts[1] : "")
                    contact.notes = note
                    isNew = true
                }
                var changed = false
                if single {
                    func fill(_ field: WritableKeyPath<Contact, String>, _ label: String) {
                        guard contact[keyPath: field].isEmpty, let value = found.first(where: { $0.label == label })?.value else { return }
                        contact[keyPath: field] = value
                        changed = true
                    }
                    fill(\.email, "EMAIL")
                    fill(\.phone, "TELEPHONENUM")
                    fill(\.taxCode, "CF")
                    if contact.companyID == nil, lineCompanies.count == 1 {
                        contact.companyID = lineCompanies[0]
                        changed = true
                    }
                }
                guard isNew || changed else { continue }
                database.save(contact, now: now)
                peopleByName[k] = contact.id
                if isNew { report.newPeople += 1 } else { report.updatedPeople += 1 }
            }
        }
        return report
    }

    /// I valori veri dei segnaposto di una riga, nell'ordine.
    static func values(in line: String, vault: Vault) -> [(label: String, value: String)] {
        let ns = line as NSString
        return placeholder.matches(in: line, range: NSRange(location: 0, length: ns.length)).compactMap { match in
            let token = ns.substring(with: match.range)
            guard let entry = vault.entry(token) else { return nil }
            return (entry.label, entry.value)
        }
    }

    private static func key(_ name: String) -> String { Vault.normalized(name) }
}
