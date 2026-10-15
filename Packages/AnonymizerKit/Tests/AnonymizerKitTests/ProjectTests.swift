import Foundation
import Testing
@testable import AnonymizerKit

/// I progetti: migrazione dai dati di prima, archivi separati, CRM che si riempie dai documenti, chat sui documenti.
@Suite struct ProjectTests {
    private func folder() -> (SecureFolder, URL) {
        let directory = FileManager.default.temporaryDirectory.appending(path: "anonimizzatore-progetti-\(UUID().uuidString)")
        return (SecureFolder(directory: directory, protection: .file), directory)
    }

    /// I dati di prima: ogni cliente diventa un progetto con le sue cose; il resto va in «Generale».
    @Test func legacyDataBecomesProjects() async throws {
        let (folder, directory) = folder()
        defer { try? FileManager.default.removeItem(at: directory) }
        var edilnord = Company()
        edilnord.name = "Edilnord S.r.l."
        var alfa = Company()
        alfa.name = "Studio Alfa"
        var crm = CRMDatabase()
        crm.save(edilnord)
        crm.save(alfa)
        crm.save(Contact(firstName: "Mario", lastName: "Rossi", companyID: edilnord.id))
        crm.save(Contact(firstName: "Anna", lastName: "Neri"))
        crm.save(Deal(title: "Ristrutturazione", companyID: edilnord.id))
        try folder.write(JSONEncoder().encode(crm), to: CRMStore.fileName)
        var vault = Vault()
        vault.placeholder(label: "FULLNAME", value: "Mario Rossi", client: edilnord.id)
        vault.placeholder(label: "FULLNAME", value: "Luca Verdi")
        vault.placeholder(label: "ORG", value: "Studio Alfa", client: alfa.id)
        try folder.write(JSONEncoder().encode(vault), to: VaultStore.fileName)
        let chat = ChatConversation(clientID: edilnord.id, messages: [ChatMessage(role: .user, text: "Ciao", sent: "Ciao")])
        try folder.write(JSONEncoder().encode([chat]), to: ChatStore.fileName)

        let store = ProjectStore(folder: folder)
        let projects = try await store.open()
        #expect(Set(projects.map(\.name)) == ["Edilnord S.r.l.", "Studio Alfa", "Generale"])
        let edilnordSpace = store.space(projects.first { $0.name == "Edilnord S.r.l." }!.id)
        let edilnordCRM = try await edilnordSpace.crm.snapshot()
        #expect(edilnordCRM.contacts.map(\.fullName) == ["Mario Rossi"])
        #expect(edilnordCRM.deals.count == 1)
        let edilnordVault = try await edilnordSpace.vault.snapshot()
        #expect(edilnordVault.entries.map(\.placeholder) == ["[FULLNAME_1]"])
        #expect(try await edilnordSpace.chat.open().count == 1)
        // Un numero già dato non torna libero: la prossima persona di Edilnord è [FULLNAME_3].
        let next = try await edilnordSpace.vault.update { $0.placeholder(label: "FULLNAME", value: "Giulia Bianchi").placeholder }
        #expect(next == "[FULLNAME_3]")

        let general = store.space(projects.first { $0.name == "Generale" }!.id)
        #expect(try await general.crm.snapshot().contacts.map(\.fullName) == ["Anna Neri"])
        #expect(try await general.vault.snapshot().entries.map(\.value) == ["Luca Verdi"])
        // I file di prima non ci sono più, e riaprendo non si migra due volte.
        #expect(try folder.read(CRMStore.fileName) == nil)
        #expect(try await ProjectStore(folder: SecureFolder(directory: directory, protection: .file)).open().count == 3)
    }

    @Test func projectsAreSeparateAndDeletable() async throws {
        let (folder, directory) = folder()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = ProjectStore(folder: folder)
        #expect(try await store.open().isEmpty)
        let first = try await store.create(name: "  Evento Roma  ")
        let second = try await store.create(name: "")
        #expect(first.name == "Evento Roma" && second.name == "Nuovo progetto")
        _ = try await store.space(first.id).vault.update { $0.placeholder(label: "FULLNAME", value: "Mario Rossi") }
        #expect(try await store.space(second.id).vault.snapshot().isEmpty)
        // Lo stesso archivio per lo stesso progetto (due archivi sullo stesso file perderebbero modifiche).
        #expect(store.space(first.id) === store.space(first.id))

        let added = try await store.space(first.id).crm.addDocument(title: "Nota", text: TextDocument(text: "x", kind: .plainText),
                                                                   fileName: "nota.txt", companyID: nil)
        let blob = added.document.versions[0].blobName
        #expect(try folder.read(blob) != nil)
        let left = try await store.delete(first.id)
        #expect(left.map(\.id) == [second.id])
        #expect(try folder.read(blob) == nil)
        #expect(try folder.read(ProjectSpace.fileName(first.id, "dizionario")) == nil)
        #expect(try await store.rename(second.id, to: "Fiera Milano").first?.name == "Fiera Milano")
    }

    /// Persone e aziende dei documenti entrano da sole nel CRM del progetto.
    @Test func crmFillsItselfFromDocuments() {
        var vault = Vault()
        let mario = vault.placeholder(label: "FULLNAME", value: "Mario Rossi").placeholder
        let email = vault.placeholder(label: "EMAIL", value: "mario@rossi.it").placeholder
        let phone = vault.placeholder(label: "TELEPHONENUM", value: "+39 333 123 4567").placeholder
        let org = vault.placeholder(label: "ORG", value: "Edilnord S.r.l.").placeholder
        let anna = vault.placeholder(label: "FULLNAME", value: "Anna").placeholder
        let neri = vault.placeholder(label: "FULLNAME", value: "Neri").placeholder
        let luca = vault.placeholder(label: "FULLNAME", value: "Luca Verdi").placeholder
        let giulia = vault.placeholder(label: "FULLNAME", value: "Giulia Bianchi").placeholder
        let hotel = vault.placeholder(label: "ORG", value: "Hotel").placeholder
        let text = """
        Nome\tEmail\tTelefono\tAzienda
        \(mario)\t\(email)\t\(phone)\t\(org)
        \(anna)\t\(neri)\t\t
        Riunione con \(luca) e \(giulia) in \(hotel).
        \(mario) conferma.
        """
        var database = CRMDatabase()
        var existing = Contact(firstName: "Luca", lastName: "Verdi")
        existing.email = "luca@verdi.it"
        database.save(existing)
        let report = CRMExtraction.apply(text, vault: vault, source: "Partecipanti.xlsx", to: &database)
        #expect(Set(database.contacts.map(\.fullName)) == ["Mario Rossi", "Anna Neri", "Luca Verdi", "Giulia Bianchi"])
        #expect(database.companies.map(\.name) == ["Edilnord S.r.l."])
        let rossi = database.contacts.first { $0.fullName == "Mario Rossi" }!
        #expect(rossi.email == "mario@rossi.it" && rossi.phone == "+39 333 123 4567")
        #expect(rossi.companyID == database.companies[0].id)
        #expect(rossi.notes == "Trovato in «Partecipanti.xlsx».")
        // Due persone sulla stessa riga: email e telefoni non si attribuiscono; chi c'era già non si duplica.
        #expect(database.contacts.first { $0.fullName == "Luca Verdi" }!.email == "luca@verdi.it")
        #expect(report.newPeople == 3 && report.newCompanies == 1)
        #expect(report.summary == "3 persone e 1 azienda nuove nel CRM")
        // Una seconda volta non aggiunge niente.
        #expect(CRMExtraction.apply(text, vault: vault, source: "x", to: &database).isEmpty)
    }

    @Test func agentRepliesAreRead() {
        let reply = """
        Mi servono i documenti.
        LEGGI D2
        **LEGGI D3, D5**
        """
        let reads = ProjectAgent.parse(reply)
        #expect(reads.reads == ["D2", "D3", "D5"])
        #expect(reads.text == "Mi servono i documenti.")

        let proposal = """
        Ho corretto la data.
        <<<MODIFICA d2>>>
        Gentile [FULLNAME_1],
        la riunione è il 3 ottobre.
        <<<FINE>>>
        E ti propongo una lettera:
        <<<NUOVO Lettera per [ORG_1]>>>
        Spett.le [ORG_1]
        <<<FINE>>>
        """
        let parsed = ProjectAgent.parse(proposal)
        #expect(parsed.reads.isEmpty)
        #expect(parsed.proposals.count == 2)
        #expect(parsed.proposals[0].ref == "D2" && parsed.proposals[0].content == "Gentile [FULLNAME_1],\nla riunione è il 3 ottobre.")
        #expect(parsed.proposals[1].ref == nil && parsed.proposals[1].title == "Lettera per [ORG_1]")
        #expect(parsed.text == "Ho corretto la data.\n\nE ti propongo una lettera:")

        let documents = [AgentDocument(ref: "D1", id: UUID(), title: "Contratto [ORG_1]", format: .docx)]
        let instructions = ProjectAgent.instructions(project: "Evento", documents: documents)
        #expect(instructions.contains("- D1: «Contratto [ORG_1]» (Word)"))
        let question = ChatMessage(role: .user, text: "Riassumi", sent: "Riassumi")
        let transcript = ChatShield.transcript(history: [], next: question, project: instructions, steps: ["Assistente: LEGGI D1"])
        #expect(transcript.range(of: "Lavori nel progetto")!.lowerBound < transcript.range(of: "Richiesta:")!.lowerBound)
        #expect(transcript.hasSuffix("Non usare strumenti e non modificare file."))
        let long = ProjectAgent.documentsBlock([(documents[0], String(repeating: "a", count: ProjectAgent.maxDocumentLength + 10))])
        #expect(long.contains("documento tagliato"))
    }
}
