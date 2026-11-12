#if DEBUG
import AnonymizerKit
import AppKit
import SwiftUI

// MARK: - Prove dell'interfaccia senza mouse (solo nella build di sviluppo)
//
// `ANONIMAIKER_PROVA=copione.json` (con `ANONIMAIKER_DATI` su una cartella temporanea) esegue dei passi e salva le
// schermate della finestra, come il copione della versione Windows. Un passo è un oggetto JSON con una sola azione più
// `attesa` (millisecondi dopo l'azione) facoltativa, per esempio:
//   [{"progetto": "Prova"}, {"datiDemo": true}, {"sezione": "companies"}, {"schermata": "/tmp/aziende.png"}]
// Alla fine l'app si chiude. Le schermate di un foglio aperto finiscono accanto, con «-foglio» nel nome.

@MainActor
enum ProvaScript {
    static func runIfRequested(_ model: AppModel) async {
        guard let path = ProcessInfo.processInfo.environment["ANONIMAIKER_PROVA"], !path.isEmpty,
              let data = FileManager.default.contents(atPath: path),
              let steps = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
        try? await Task.sleep(for: .seconds(1))
        for step in steps {
            await perform(step, model: model)
            let wait = (step["attesa"] as? Int) ?? 400
            try? await Task.sleep(for: .milliseconds(wait))
        }
        NSApp.terminate(nil)
    }

    private static func perform(_ step: [String: Any], model: AppModel) async {
        if let name = step["progetto"] as? String {
            if let existing = model.projects.first(where: { $0.name == name }) {
                model.selectProject(existing.id)
            } else {
                await model.createProject(named: name)
            }
            model.showsGuide = false
        }
        if let value = step["sezione"] as? String, let section = AppSection(rawValue: value) {
            model.companiesPath = []
            model.documentsPath = []
            model.section = section
        }
        if let tema = step["tema"] as? String {
            NSApp.appearance = tema == "scuro" ? NSAppearance(named: .darkAqua) : tema == "chiaro" ? NSAppearance(named: .aqua) : nil
        }
        if let size = step["finestra"] as? [Int], size.count == 2, let window = mainWindow {
            window.setContentSize(NSSize(width: size[0], height: size[1]))
        }
        if step["motore"] != nil {
            for _ in 0..<240 where model.engineState == .loading { try? await Task.sleep(for: .milliseconds(250)) }
        }
        if let text = step["testo"] as? String {
            let space = (step["banco"] as? String) == "reveal" ? model.revealSpace : model.anonymizeSpace
            space.input = text
        }
        if let which = step["esegui"] as? String {
            let space = which == "reveal" ? model.revealSpace : model.anonymizeSpace
            model.run(space)
            for _ in 0..<240 where space.isRunning { try? await Task.sleep(for: .milliseconds(250)) }
        }
        if step["riconvertiRisultato"] != nil {
            model.revealSpace.input = model.anonymizeSpace.output
        }
        if let path = step["apri"] as? String {
            let space = (step["banco"] as? String) == "reveal" ? model.revealSpace : model.anonymizeSpace
            model.open(URL(filePath: path), into: space)
            for _ in 0..<240 where space.isRunning { try? await Task.sleep(for: .milliseconds(250)) }
        }
        if let demo = step["datiDemo"] { if (demo as? String) == "windows" { await demoCRMWindows(model) } else { await demoCRM(model) } }
        if let paths = step["aggiungiDocumenti"] as? [String] {
            let company = (step["azienda"] as? String).flatMap { name in model.crm.companies.first { $0.name == name }?.id }
            await model.addDocuments(paths.map { URL(filePath: $0) }, to: company)
            for _ in 0..<240 where !model.busyDocuments.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
        }
        if let name = step["azienda"] as? String, step["aggiungiDocumenti"] == nil,
           let company = model.crm.companies.first(where: { $0.name == name }) {
            model.section = .companies
            model.openCompany(company.id)
        }
        if let title = step["documento"] as? String, let document = model.crm.documents.first(where: { $0.title == title }) {
            model.openDocument(document.id)
        }
        if let open = step["chat"] as? Bool { model.showsChat = open }
        if step["chatDemo"] != nil { demoChat(model) }
        if step["guida"] != nil { model.showsGuide = true }
        if step["copia"] != nil { model.startExport() }
        if step["aggiornamenti"] != nil { model.updates.isPresented = true }
        if step["chiudiFogli"] != nil {
            ProvaComandi.shared.chiudi += 1
            try? await Task.sleep(for: .milliseconds(300))
            model.showsGuide = false
            model.backupStep = nil
            model.updates.isPresented = false
            if let window = mainWindow, let sheet = window.attachedSheet { window.endSheet(sheet) }
        }
        // Cornice: impostazioni, «Informazioni su», elenco dei progetti, stato degli aggiornamenti.
        if let page = step["impostazioni"] as? String {
            AppSheets.shared.settingsTab = SettingsTab(rawValue: page) ?? .categories
            AppSheets.shared.showsSettings = true
        }
        if step["informazioni"] != nil { AppSheets.shared.showsAbout = true }
        if step["tuttiProgetti"] != nil { model.showProjects() }
        if let state = step["statoAggiornamenti"] as? String {
            let release = AppRelease(version: "0.16", title: "AnoniMaiker 0.16",
                                     notes: "## Novità\n- Aspetto uguale alla versione Windows\n- Impostazioni in una finestra sopra l'app\n\n## Correzioni\n- Varie",
                                     page: Updates.projectPage, dmg: Updates.projectPage, dmgSize: 412_000_000, signature: nil, published: .now)
            model.updates.phase = switch state {
            case "aggiornata": .upToDate
            case "scarico": .downloading(release, 0.42)
            case "errore": .failed("Il download si è interrotto.", release)
            default: .available(release)
            }
            model.updates.isPresented = true
        }
        if step["chiudiFogli"] != nil {
            AppSheets.shared.showsSettings = false
            AppSheets.shared.showsAbout = false
        }
        if let message = step["avviso"] as? String { model.alert = message }
        await performChat(step, model: model) // stati della chat (blocco in fondo)
        performCRM(step)
        if let path = step["schermata"] as? String { capture(to: path) }
    }

    private static var mainWindow: NSWindow? {
        NSApp.windows.first { $0.isVisible && $0.canBecomeMain && $0.sheetParent == nil }
    }

    /// La finestra principale e l'eventuale foglio aperto sopra.
    private static func capture(to path: String) {
        guard let window = mainWindow else { return }
        write(window, to: path)
        if let sheet = window.attachedSheet ?? NSApp.windows.first(where: { $0.isVisible && $0.sheetParent == window }) {
            write(sheet, to: path.replacingOccurrences(of: ".png", with: "-foglio.png"))
        }
    }

    private static func write(_ window: NSWindow, to path: String) {
        guard let view = window.contentView?.superview ?? window.contentView,
              let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: URL(filePath: path))
    }

    // MARK: Dati inventati

    private static func demoCRM(_ model: AppModel) async {
        var edilnord = Company(name: "Edilnord S.r.l.", status: .client)
        edilnord.sector = "Costruzioni"
        edilnord.city = "Milano"
        edilnord.vatNumber = "01234567897"
        edilnord.email = "info@edilnord.it"
        edilnord.phone = "02 1234567"
        edilnord.notes = "Cliente dal 2021. Preferisce essere contattato al mattino."
        var alfa = Company(name: "Alfa Consulting", status: .prospect)
        alfa.city = "Torino"
        alfa.sector = "Consulenza"
        await model.save(edilnord)
        await model.save(alfa)
        var mario = Contact(firstName: "Mario", lastName: "Rossi", companyID: edilnord.id)
        mario.role = "Direttore acquisti"
        mario.email = "mario.rossi@edilnord.it"
        mario.phone = "347 123 4567"
        await model.save(mario)
        var giulia = Contact(firstName: "Giulia", lastName: "Bianchi", companyID: edilnord.id)
        giulia.role = "Amministrazione"
        giulia.email = "giulia.bianchi@edilnord.it"
        await model.save(giulia)
        var deal = Deal(title: "Ristrutturazione uffici", companyID: edilnord.id)
        deal.amount = 12500
        deal.stage = .proposal
        await model.save(deal)
        var small = Deal(title: "Consulenza sicurezza", companyID: alfa.id)
        small.amount = 4800
        small.stage = .qualified
        await model.save(small)
        var call = Activity(kind: .task, text: "Richiamare per il preventivo", companyID: edilnord.id)
        call.due = Calendar.current.date(byAdding: .day, value: -2, to: .now)
        await model.save(call)
        await model.save(Activity(kind: .note, text: "Incontro positivo, vogliono partire a marzo.", companyID: edilnord.id))
    }

    // MARK: Viste del CRM (schede, fogli di modifica, filtri)
    //
    // `scheda` (overview/documents/activities/deals) nella scheda dell'azienda; `editor` (azienda/contatto/trattativa/
    // attivita) apre il foglio di modifica dalla scheda aperta; `filtro` (tutte) nelle trattative e nelle attività;
    // `versione` (originale/anonimizzato) nel documento aperto; `dossier` (anonimizzata/originale) la scheda anonimizzata.

    private static func performCRM(_ step: [String: Any]) {
        let comandi = ProvaComandi.shared
        if let value = step["scheda"] as? String { comandi.scheda = value }
        if let value = step["editor"] as? String { comandi.editor = value }
        if let value = step["filtro"] as? String { comandi.filtro = value }
        if let value = step["versione"] as? String { comandi.versione = value }
        if let value = step["dossier"] as? String { comandi.dossier = value }
    }

    /// Gli stessi dati inventati del copione di Windows, per confrontare le schermate.
    private static func demoCRMWindows(_ model: AppModel) async {
        let day = { (n: Int) in Calendar.current.date(byAdding: .day, value: n, to: .now)! }
        var c1 = Company(name: "Edilnord S.r.l.", status: .client)
        c1.sector = "Costruzioni"; c1.vatNumber = "01234567897"; c1.iban = "IT60X0542811101000000123456"
        c1.email = "info@edilnord.it"; c1.pec = "edilnord@pec.it"; c1.phone = "02 1234567"; c1.website = "www.edilnord.it"
        c1.street = "via Garibaldi 24"; c1.zipCode = "20121"; c1.city = "Milano"; c1.province = "MI"
        c1.notes = "Cliente dal 2021. Preferisce essere contattato al mattino."
        var c2 = Company(name: "Ottica Sole", status: .prospect)
        c2.sector = "Commercio"; c2.city = "Torino"; c2.vatNumber = "12345678901"
        var c3 = Company(name: "Tipografia Rapida", status: .supplier)
        c3.sector = "Stampa"; c3.city = "Bergamo"
        for company in [c1, c2, c3] { await model.save(company) }
        var p1 = Contact(firstName: "Mario", lastName: "Rossi", companyID: c1.id)
        p1.role = "Direttore acquisti"; p1.email = "mario.rossi@edilnord.it"; p1.mobile = "347 123 4567"
        var p2 = Contact(firstName: "Giulia", lastName: "Bianchi", companyID: c1.id)
        p2.role = "Amministrazione"; p2.email = "giulia.bianchi@edilnord.it"; p2.phone = "02 8765432"
        var p3 = Contact(firstName: "Anna", lastName: "Neri", companyID: c2.id)
        p3.role = "Titolare"; p3.email = "anna@otticasole"
        for contact in [p1, p2, p3] { await model.save(contact) }
        var d1 = Deal(title: "Nuovo sito web", companyID: c1.id)
        d1.contactID = p1.id; d1.stage = .proposal; d1.amount = 12500; d1.probability = 50; d1.expectedClose = day(20)
        var d2 = Deal(title: "Manutenzione annuale", companyID: c1.id)
        d2.contactID = p2.id; d2.stage = .won; d2.amount = 3000; d2.probability = 100
        var d3 = Deal(title: "Campagna social", companyID: c2.id)
        d3.contactID = p3.id; d3.stage = .negotiation; d3.amount = 4800; d3.probability = 75; d3.expectedClose = day(7)
        var d4 = Deal(title: "Brochure", companyID: c3.id)
        d4.stage = .lost; d4.amount = 900; d4.probability = 0
        for deal in [d1, d2, d3, d4] { await model.save(deal) }
        func activity(_ kind: ActivityKind, _ text: String, _ company: UUID, contact: UUID? = nil, date: Int, due: Int? = nil, done: Bool = false) -> Activity {
            var activity = Activity(kind: kind, text: text, companyID: company)
            activity.contactID = contact; activity.date = day(date); activity.due = due.map(day); activity.isDone = done
            return activity
        }
        await model.save(activity(.task, "Mandare il preventivo firmato", c1.id, contact: p1.id, date: -6, due: -3))
        await model.save(activity(.task, "Richiamare per la campagna", c2.id, contact: p3.id, date: -1, due: 2))
        await model.save(activity(.call, "Chiamata con Mario: vuole il sito entro marzo.", c1.id, contact: p1.id, date: -2))
        await model.save(activity(.note, "Il logo nuovo arriva la settimana prossima.", c1.id, date: -4))
        await model.save(activity(.task, "Fatturare la manutenzione", c1.id, date: -10, due: -8, done: true))
    }

    private static func demoChat(_ model: AppModel) {
        let question = ChatMessage(role: .user, text: "Riassumi il preventivo per Mario Rossi.", sent: "Riassumi il preventivo per [FULLNAME_1].")
        let text = """
        ### Riepilogo
        Il preventivo per **Mario Rossi** riguarda la *ristrutturazione degli uffici*:

        - importo: 12.500 €
        - inizio lavori: marzo
        - da confermare il catering

        > Nota: gli orari del pomeriggio vanno ricontrollati.

        ```
        09:30  Accoglienza
        10:00  Apertura lavori
        ```
        """
        var answer = ChatMessage(role: .assistant, text: text, sent: text.replacingOccurrences(of: "Mario Rossi", with: "[FULLNAME_1]"))
        answer.summary = "1 dato vero rimesso"
        let conversation = ChatConversation(title: "Riassumi il preventivo", messages: [question, answer])
        model.chat.conversations = [conversation]
        model.chat.selectedID = conversation.id
        model.showsChat = true
    }
}
// MARK: - Stati della chat (per le schermate del pannello)
//
// `chatCompleta` (conversazione come quella di Windows: Markdown, allegato, proposte), `codex` (nonInstallato,
// nonCollegato, pronto, collegamento), `erroreCollegamento` (testo o null), `fase` (anonimizzo, attesa, lettura o null),
// `erroreChat` (testo o null; aggiunge una domanda senza risposta), `allegatiInAttesa` (true/false), `bozza` (testo),
// `senzaConversazione`.

extension ProvaScript {
    fileprivate static func performChat(_ step: [String: Any], model: AppModel) async {
        if step["chatCompleta"] != nil { fullChat(model) }
        if let value = step["codex"] as? String {
            // Prima il controllo vero (che legge anche i modelli), poi lo stato voluto.
            if model.chat.models.isEmpty { await model.refreshCodexStatus() }
            model.chat.connection = nil
            switch value {
            case "nonInstallato": model.chat.codexStatus = .notInstalled
            case "nonCollegato": model.chat.codexStatus = .notLoggedIn
            case "collegamento":
                model.chat.codexStatus = .notLoggedIn
                model.chat.connection = .waitingForBrowser(URL(string: "https://auth.openai.com/x"))
            default: model.chat.codexStatus = .ready("Logged in")
            }
        }
        if step.keys.contains("erroreCollegamento") { model.chat.connectionError = step["erroreCollegamento"] as? String }
        if step.keys.contains("fase") {
            switch step["fase"] as? String {
            case "anonimizzo": model.chat.phase = .anonymizing
            case "attesa": model.chat.phase = .waiting
            case "lettura": model.chat.phase = .reading(["Programma evento", "Mail di conferma"])
            default: model.chat.phase = nil
            }
        }
        if step.keys.contains("erroreChat") {
            let error = step["erroreChat"] as? String
            if error != nil, let index = model.chat.conversations.firstIndex(where: { $0.id == model.chat.selectedID }),
               model.chat.conversations[index].messages.last?.role != .user {
                model.chat.conversations[index].messages.append(ChatMessage(role: .user, text: "E il catering?", sent: "E il catering?"))
            }
            model.chat.error = error
        }
        if let pending = step["allegatiInAttesa"] as? Bool {
            model.chat.pending = pending ? [
                PendingAttachment(symbol: "doc.text.fill", input: .text(name: "Preventivo catering.docx", text: "Preventivo")),
                PendingAttachment(symbol: "person.text.rectangle", input: .text(name: "Scheda di Rossi Eventi Srl", text: "Scheda")),
            ] : []
        }
        if let draft = step["bozza"] as? String { model.chat.draft = draft }
        if step["senzaConversazione"] != nil { model.chat.selectedID = nil }
    }

    private static func fullChat(_ model: AppModel) {
        let now = Date.now
        let question = ChatMessage(role: .user, date: now.addingTimeInterval(-1800),
                                   text: "Riassumi i documenti del progetto e prepara il programma per Mario Rossi",
                                   sent: "Riassumi i documenti del progetto e prepara il programma per [FULLNAME_1]",
                                   attachments: [ChatAttachment(name: "Contratto Rossi.docx", sentName: "Contratto [FULLNAME_1].docx",
                                                                sentText: "Contratto fra [ORG_1] e [FULLNAME_1].\nDurata: 12 mesi.", summary: "1 nome, 1 azienda")],
                                   summary: "1 nome")
        let text = """
        ## Riepilogo
        Ho letto **il programma** e la *mail* di Mario Rossi. Ecco i punti principali:

        1. L'evento si tiene il `12 dicembre` a Milano.
        2. Referente: **Mario Rossi** (mario.rossi@example.com).
        3. Budget stimato: _12.500 €_.

        - Da confermare il catering
        - Manca la lista dei partecipanti

        > Nota: gli orari del pomeriggio vanno ricontrollati.

        ```
        09:30  Accoglienza
        10:00  Apertura lavori
        ```
        Altri dettagli su [la pagina del fornitore](https://example.com/catering). Prova di sicurezza: <script>alert(1)</script> e [link](javascript:alert(1)).
        """
        var newDocument = ChatProposal(documentID: nil, sentTitle: "Programma per Mario Rossi",
                                       content: "Programma dell'evento\n\n09:30 Accoglienza degli ospiti di Rossi Eventi Srl\n10:00 Apertura lavori con Mario Rossi\n13:00 Pranzo")
        newDocument.status = .pending
        var change = ChatProposal(documentID: UUID(), sentTitle: "Mail di conferma", content: "Gentile Mario Rossi,\nconfermiamo la sua partecipazione.")
        change.status = .applied
        let answer = ChatMessage(role: .assistant, date: now.addingTimeInterval(-1740), text: text,
                                 sent: "## Riepilogo\nHo letto **il programma** e la *mail* di [FULLNAME_1]. [PHONE_9] non lo conosco.",
                                 summary: "2 dati veri rimessi", unknown: ["[PHONE_9]"], proposals: [newDocument, change],
                                 readDocuments: ["Programma evento", "Mail di conferma"])
        let conversation = ChatConversation(title: "Riassumi i documenti del progetto e prepara il programma", messages: [question, answer])
        model.chat.conversations = [conversation, ChatConversation(title: "Mail ai partecipanti")]
        model.chat.selectedID = conversation.id
        model.chat.error = nil
        model.chat.phase = nil
        model.showsChat = true
    }
}

/// I comandi del copione per le viste del CRM: la vista che li riceve li esegue e li rimette a nil.
@MainActor @Observable
final class ProvaComandi {
    static let shared = ProvaComandi()
    var scheda: String?
    var editor: String?
    var filtro: String?
    var versione: String?
    var dossier: String?
    /// Cresce a ogni «chiudiFogli»: le viste del CRM chiudono i loro fogli.
    var chiudi = 0
}
#endif
