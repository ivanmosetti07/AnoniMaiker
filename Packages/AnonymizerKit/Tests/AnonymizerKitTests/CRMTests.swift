import Foundation
import Testing
@testable import AnonymizerKit

/// Il CRM: salvataggio cifrato, cancellazioni a cascata, documenti con le loro versioni, scheda del cliente, dati noti.
@Suite struct CRMTests {
    private func temporaryFolder() -> (SecureFolder, URL) {
        let directory = FileManager.default.temporaryDirectory.appending(path: "anonimizzatore-prove-\(UUID().uuidString)")
        return (SecureFolder(directory: directory, protection: .file), directory)
    }

    private func sample() -> (CRMDatabase, Company, Contact, Deal) {
        var database = CRMDatabase()
        var company = Company(name: "Edilnord S.r.l.", status: .client)
        company.vatNumber = "12345678903"
        company.taxCode = "12345678903"
        company.email = "info@edilnord.it"
        company.phone = "02 1234567"
        company.street = "via Garibaldi 24"
        company.zipCode = "20121"
        company.city = "Milano"
        company.province = "MI"
        var contact = Contact(firstName: "Mario", lastName: "Rossi", companyID: company.id)
        contact.role = "Direttore acquisti"
        contact.email = "mario.rossi@edilnord.it"
        contact.mobile = "333 123 4567"
        var deal = Deal(title: "Nuovo sito web", companyID: company.id)
        deal.stage = .proposal
        deal.probability = 50
        deal.amount = Decimal(string: "12500")
        deal.contactID = contact.id
        deal.expectedClose = DateComponents(calendar: .current, year: 2026, month: 11, day: 30).date
        var call = Activity(kind: .call, text: "Chiesto lo sconto sul primo anno", companyID: company.id)
        call.contactID = contact.id
        call.date = DateComponents(calendar: .current, year: 2026, month: 10, day: 12).date!
        var task = Activity(kind: .task, text: "Inviare il preventivo firmato", companyID: company.id)
        task.due = DateComponents(calendar: .current, year: 2026, month: 10, day: 1).date
        database.save(company)
        database.save(contact)
        database.save(deal)
        database.save(call)
        database.save(task)
        return (database, company, contact, deal)
    }

    @Test func savesEncryptedAndReopens() async throws {
        let (folder, directory) = temporaryFolder()
        defer { try? FileManager.default.removeItem(at: directory) }
        let (database, company, _, _) = sample()
        try await CRMStore(folder: folder).update { $0 = database }
        let sealed = try Data(contentsOf: directory.appending(path: "crm.sigillato"))
        #expect(sealed.range(of: Data("Edilnord".utf8)) == nil)
        let reopened = try await CRMStore(folder: SecureFolder(directory: directory, protection: .file)).snapshot()
        #expect(reopened == database && reopened.company(company.id)?.name == "Edilnord S.r.l.")
    }

    /// Un CRM salvato da una versione più vecchia (senza alcuni campi) si apre lo stesso.
    @Test func olderDataStillOpens() throws {
        let id = UUID()
        let json = #"{"version":1,"companies":[{"id":"\#(id.uuidString)","name":"Vecchia S.r.l."}]}"#
        let database = try JSONDecoder().decode(CRMDatabase.self, from: Data(json.utf8))
        #expect(database.company(id)?.name == "Vecchia S.r.l." && database.company(id)?.status == .prospect && database.contacts.isEmpty)
    }

    @Test func deletingACompanyTakesItsDataAway() async throws {
        let (folder, directory) = temporaryFolder()
        defer { try? FileManager.default.removeItem(at: directory) }
        var (database, company, _, _) = sample()
        let other = Company(name: "Altra S.p.A.")
        database.save(other)
        database.save(Contact(firstName: "Anna", lastName: "Neri", companyID: other.id))
        let store = CRMStore(folder: folder)
        let filled = database
        try await store.update { $0 = filled }
        _ = try await store.addDocument(title: "Nota", text: TextDocument(text: "x", kind: .plainText), fileName: "nota.txt", companyID: company.id)
        #expect(folder.sealedNames().count == 2)
        #expect(database.removalCounts(of: company.id) == (1, 1, 2, 0))

        let after = try await store.deleteCompany(company.id)
        #expect(after.companies.map(\.name) == ["Altra S.p.A."] && after.contacts.map(\.fullName) == ["Anna Neri"])
        #expect(after.deals.isEmpty && after.activities.isEmpty && after.documents.isEmpty)
        #expect(folder.sealedNames() == ["crm"])
    }

    @Test func documentsKeepTheirVersions() async throws {
        let (folder, directory) = temporaryFolder()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = CRMStore(folder: folder)
        // Un file di Windows (Windows-1252): l'originale si conserva byte per byte.
        let file = directory.appending(path: "Verbale Rossi.txt")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let bytes = "Perché Mario Rossi è d'accordo.".data(using: .windowsCP1252)!
        try bytes.write(to: file)
        let (document, _) = try await store.addDocument(from: file, companyID: nil)
        #expect(document.title == "Verbale Rossi" && document.original?.fileName == "Verbale Rossi.txt")
        let original = try await store.text(of: try #require(document.original), in: document)
        #expect(original.text == "Perché Mario Rossi è d'accordo." && original.data() == bytes)

        var anonymized = original
        anonymized.text = "Perché [FULLNAME_1] è d'accordo."
        try await store.setAnonymized(anonymized, summary: "1 nome", for: document.id)
        try await store.setAnonymized(anonymized, summary: "1 nome", for: document.id)  // sostituisce, non si accumula
        try await store.addAnswer(TextDocument(text: "Gentile [FULLNAME_1], grazie.", kind: .plainText), fileName: "risposta.txt",
                                  summary: "", for: document.id)
        var current = try #require(try await store.snapshot().document(document.id))
        #expect(current.versions.map(\.kind) == [.original, .anonymized, .aiAnswer] && folder.sealedNames().count == 4)
        let anonymizedText = try await store.text(of: try #require(current.anonymized), in: current)
        #expect(anonymizedText.text == "Perché [FULLNAME_1] è d'accordo." && anonymizedText.encoding == .windowsCP1252)

        // L'originale non si toglie; una risposta sì.
        try await store.removeVersion(try #require(current.original).id, from: document.id)
        try await store.removeVersion(try #require(current.answers.first).id, from: document.id)
        current = try #require(try await store.snapshot().document(document.id))
        #expect(current.versions.map(\.kind) == [.original, .anonymized] && folder.sealedNames().count == 3)

        try await store.deleteDocument(document.id)
        #expect(folder.sealedNames() == ["crm"])
    }

    /// I documenti salvati dalla versione 0.2 (solo testo e Markdown, con «kind») si aprono ancora.
    @Test func documentsFromTheFirstVersionsStillOpen() throws {
        let id = UUID(), version = UUID()
        let json = #"{"id":"\#(id.uuidString)","title":"Verbale","kind":"markdown","versions":[{"id":"\#(version.uuidString)","kind":"original","fileName":"v.md","encoding":4,"hasBOM":false}]}"#
        let document = try JSONDecoder().decode(CRMDocument.self, from: Data(json.utf8))
        #expect(document.format == .markdown && document.original?.id == version && document.format(of: document.original!) == .markdown)
    }

    /// Un file Excel nella scheda del cliente: l'originale resta identico; la risposta dell'AI può essere testo incollato.
    @Test func officeFilesInTheClientRecord() async throws {
        let (folder, directory) = temporaryFolder()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = CRMStore(folder: folder)
        let workbook = try TableFormatsTests.workbook()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appending(path: "Clienti 2026.xlsx")
        try workbook.write(to: file)
        let (document, _) = try await store.addDocument(from: file, companyID: nil)
        #expect(document.format == .xlsx && document.title == "Clienti 2026")
        #expect(try await store.data(of: try #require(document.original)) == workbook)
        try await store.addAnswer(TextDocument(text: "Riepilogo per [FULLNAME_1]", kind: .markdown), fileName: "", summary: "", for: document.id)
        let current = try #require(try await store.snapshot().document(document.id))
        #expect(current.format(of: try #require(current.answers.first)) == .markdown)
        // I file del vecchio Office si rifiutano, spiegando cosa fare.
        let old = directory.appending(path: "vecchio.xls")
        try Data("x".utf8).write(to: old)
        await #expect(throws: DocumentFormat.FormatError.self) { _ = try await store.addDocument(from: old, companyID: nil) }
    }

    @Test func clientDossier() throws {
        let (database, company, _, _) = sample()
        let now = DateComponents(calendar: .current, year: 2026, month: 10, day: 15).date!
        let dossier = try #require(ClientDossier.markdown(for: company.id, in: database, now: now))
        #expect(dossier.hasPrefix("# Edilnord S.r.l.\n\nCliente"))
        #expect(dossier.contains("- Partita IVA: 12345678903"))
        #expect(dossier.contains("- Sede: via Garibaldi 24, 20121 Milano (MI)"))
        #expect(dossier.contains("- Mario Rossi — Direttore acquisti — mario.rossi@edilnord.it — 333 123 4567"))
        #expect(dossier.contains("- Nuovo sito web — Preventivo inviato — 12.500,00 € — probabilità 50% — chiusura prevista 30/11/2026 — referente Mario Rossi"))
        #expect(dossier.contains("- Inviare il preventivo firmato (entro il 01/10/2026, scaduta)"))
        #expect(dossier.contains("- 12/10/2026 · Chiamata con Mario Rossi: Chiesto lo sconto sul primo anno"))
    }

    @Test func knownValuesOfAClient() {
        let (database, company, _, _) = sample()
        let known = database.knownValues(for: company.id).map { "\($0.label):\($0.value)" }
        // Partita IVA e codice fiscale uguali: una voce sola.
        #expect(known == ["ORG:Edilnord S.r.l.", "PIVA:12345678903", "EMAIL:info@edilnord.it", "TELEPHONENUM:02 1234567",
                          "FULLNAME:Mario Rossi", "EMAIL:mario.rossi@edilnord.it", "TELEPHONENUM:333 123 4567"])
    }

    /// Un cliente che esce dal CRM esce anche dal dizionario; le voci condivise con altri clienti restano.
    @Test func removingAClientFromTheDictionary() {
        var vault = Vault()
        let rossi = UUID(), bianchi = UUID()
        vault.placeholder(label: "ORG", value: "Edilnord S.r.l.", client: rossi)
        vault.placeholder(label: "FULLNAME", value: "Mario Rossi", client: rossi)
        vault.placeholder(label: "FULLNAME", value: "Mario Rossi", client: bianchi)
        #expect(vault.entries(of: rossi).count == 2)
        #expect(vault.removeClient(rossi) == 1)
        #expect(vault.value(for: "[ORG_1]") == nil && vault.entry("[FULLNAME_1]")?.clients == [bianchi])
    }

    @Test func validators() {
        #expect(Validators.isValidVATNumber("12345678903") && !Validators.isValidVATNumber("12345678901"))
        #expect(Validators.isValidTaxCode("RSSMRA85H12F205Y") && Validators.isValidTaxCode("12345678903"))
        #expect(Validators.isValidIBAN("IT60 X054 2811 1010 0000 0123 456") && !Validators.isValidIBAN("IT00X0542811101000000123456"))
        #expect(Validators.isValidEmail("a.b@c.it") && !Validators.isValidEmail("a.b@c"))
    }
}
