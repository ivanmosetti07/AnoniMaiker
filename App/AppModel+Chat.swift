import AnonymizerKit
import AppKit
import Foundation
import Observation

// MARK: - La chat con GPT, nel pannello a destra
//
// Ogni progetto ha le sue conversazioni. Domanda e allegati passano dal motore di anonimizzazione prima di partire; GPT
// vede l'elenco dei documenti del progetto (titoli anonimizzati), chiede di leggerli e propone modifiche o documenti
// nuovi, che diventano versioni solo con la conferma. La risposta torna con i dati veri. GPT è quello
// dell'abbonamento ChatGPT dell'utente, via Codex.

/// Un allegato pronto per la prossima domanda (non ancora anonimizzato).
struct PendingAttachment: Identifiable {
    let id = UUID()
    let symbol: String
    let input: ChatInput

    var name: String { input.name }
}

@Observable
final class ChatState {
    enum Phase: Equatable {
        case anonymizing
        case waiting
        /// GPT ha chiesto dei documenti: si leggono (anonimizzati).
        case reading([String])
    }

    var conversations: [ChatConversation] = []
    var selectedID: UUID?
    var draft = ""
    var pending: [PendingAttachment] = []
    var phase: Phase?
    /// L'ultimo errore, mostrato sotto la conversazione.
    var error: String?
    var codexStatus: CodexClient.Status?
    /// Mentre si collega l'account ChatGPT.
    var connection: ChatGPTConnection?
    var connectionError: String?
    @ObservationIgnored var connectionTask: Task<Void, Never>?
    @ObservationIgnored var task: Task<Void, Never>?

    var selected: ChatConversation? { conversations.first { $0.id == selectedID } }
    var isBusy: Bool { phase != nil }

    var hasDraft: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pending.isEmpty }
}

extension AppModel {
    static let chatModelKey = "chat.modello"
    static let chatEffortKey = "chat.ragionamento"

    var codexClient: CodexClient {
        let defaults = UserDefaults.standard
        return CodexClient(model: defaults.string(forKey: Self.chatModelKey),
                           effort: defaults.string(forKey: Self.chatEffortKey).flatMap(CodexClient.Effort.init(rawValue:)))
    }

    func refreshCodexStatus() async {
        chat.codexStatus = await CodexClient.status()
    }

    // MARK: Conversazioni

    func newConversation() {
        guard !chat.isBusy else { return }
        chat.selectedID = nil
        chat.error = nil
    }

    func select(_ conversationID: UUID?) {
        guard !chat.isBusy else { return }
        chat.selectedID = conversationID
        chat.error = nil
    }

    func deleteConversation(_ id: UUID) async {
        await perform { chat.conversations = try await chatStore.delete(id) }
        if chat.selectedID == id { chat.selectedID = nil }
    }

    private func saveConversation(_ conversation: ChatConversation) async {
        await perform { chat.conversations = try await chatStore.save(conversation) }
    }

    // MARK: Allegati

    func attachFiles() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = FilePanels.documentTypes
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.message = "Allega uno o più file: si anonimizzano prima di partire"
        panel.prompt = "Allega"
        guard panel.runModal() == .OK else { return }
        attach(panel.urls)
    }

    func attach(_ urls: [URL]) {
        for url in urls {
            guard let format = DocumentFormat.of(url) else {
                chat.error = DocumentFormat.FormatError.unsupported(url.pathExtension.lowercased()).localizedDescription
                continue
            }
            do {
                let data = try Data(contentsOf: url)
                chat.pending.append(PendingAttachment(symbol: format.symbol, input: .file(name: url.lastPathComponent, data: data, format: format,
                                                                                          fileExtension: url.pathExtension)))
            } catch {
                chat.error = error.localizedDescription
            }
        }
    }

    /// La scheda di un'azienda del progetto (anagrafica, persone, trattative, note, documenti).
    func attachDossier(_ companyID: UUID) {
        guard let company = crm.company(companyID), let markdown = ClientDossier.markdown(for: companyID, in: crm) else { return }
        chat.pending.append(PendingAttachment(symbol: "person.text.rectangle", input: .text(name: "Scheda di \(company.name)", text: markdown)))
    }

    /// Un documento del progetto: parte l'originale, anonimizzato adesso con il dizionario del progetto.
    func attach(_ document: CRMDocument) async {
        guard let original = document.original else { return }
        do {
            let data = try await crmStore.data(of: original)
            let format = document.format(of: original)
            let fileExtension = original.fileName.isEmpty ? format.defaultExtension : (original.fileName as NSString).pathExtension
            chat.pending.append(PendingAttachment(symbol: format.symbol, input: .file(name: document.title + "." + fileExtension, data: data,
                                                                                      format: format, fileExtension: fileExtension)))
        } catch {
            chat.error = error.localizedDescription
        }
    }

    func removePending(_ id: UUID) {
        chat.pending.removeAll { $0.id == id }
    }

    // MARK: Domanda e risposta

    var canSendChat: Bool {
        chat.hasDraft && !chat.isBusy && isVaultReady && engine != nil && engineState != .missing
    }

    /// Anonimizza la domanda con i suoi allegati, la salva e la manda a GPT.
    func sendChat() {
        guard canSendChat, let engine else { return }
        var conversation = chat.selected ?? ChatConversation()
        let text = chat.draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let inputs = chat.pending.map(\.input)
        let known = crm.knownValues()
        let anonymizer = Anonymizer(engine: engine, store: store)
        let settings = settings
        chat.error = nil
        chat.phase = .anonymizing
        chat.task = Task {
            defer { finishChat() }
            do {
                let message = try await anonymizer.chatMessage(text, inputs: inputs, settings: settings, known: known)
                try Task.checkCancellation()
                conversation.messages.append(message)
                conversation.updated = .now
                chat.conversations = try await chatStore.save(conversation)
                chat.selectedID = conversation.id
                chat.draft = ""
                chat.pending = []
                await refreshVault()
                try await ask(conversation)
            } catch is CancellationError {
            } catch {
                chatFailed(error)
            }
        }
    }

    /// Rimanda l'ultima domanda rimasta senza risposta (già anonimizzata).
    func retryChat() {
        guard let conversation = chat.selected, conversation.messages.last?.role == .user, !chat.isBusy else { return }
        chat.error = nil
        chat.phase = .waiting
        chat.task = Task {
            defer { finishChat() }
            do {
                try await ask(conversation)
            } catch is CancellationError {
            } catch {
                chatFailed(error)
            }
        }
    }

    func cancelChat() {
        chat.task?.cancel()
    }

    /// Manda a GPT la conversazione con l'elenco dei documenti del progetto. Se GPT chiede dei documenti, gli si mandano
    /// (anonimizzati) e continua, per qualche giro. Le proposte diventano schede da applicare; la risposta si salva
    /// riconvertita.
    private func ask(_ conversation: ChatConversation) async throws {
        guard let question = conversation.messages.last, question.role == .user else { return }
        chat.phase = .waiting
        let catalog = try await agentCatalog()
        let instructions = ProjectAgent.instructions(project: catalog.projectName, documents: catalog.documents)
        var steps: [String] = []
        var readIDs: [UUID] = []
        var reply = ""
        for round in 0..<ProjectAgent.maxRounds {
            let transcript = ChatShield.transcript(history: Array(conversation.messages.dropLast()), next: question,
                                                   project: instructions, steps: steps)
            reply = try await codexClient.send(transcript)
            try Task.checkCancellation()
            let wanted = ProjectAgent.parse(reply).reads.compactMap { ref in catalog.documents.first { $0.ref == ref } }
                .filter { !readIDs.contains($0.id) }
            guard !wanted.isEmpty, round < ProjectAgent.maxRounds - 1 else { break }
            chat.phase = .reading(wanted.compactMap { crm.document($0.id)?.title })
            var items: [(document: AgentDocument, text: String)] = []
            for document in wanted {
                items.append((document, try await anonymizedText(of: document.id)))
                readIDs.append(document.id)
            }
            steps.append("Assistente: " + reply)
            steps.append("Documenti richiesti:\n" + ProjectAgent.documentsBlock(items))
            chat.phase = .waiting
        }
        let parsed = ProjectAgent.parse(reply)
        let proposals = parsed.proposals.compactMap { item -> ChatProposal? in
            guard let ref = item.ref else { return ChatProposal(documentID: nil, sentTitle: item.title, content: item.content) }
            guard let document = catalog.documents.first(where: { $0.ref == ref }) else { return nil }
            return ChatProposal(documentID: document.id, sentTitle: document.title, content: item.content)
        }
        var answer = ChatShield.reveal(parsed.text, vault: try await store.snapshot())
        // Nella conversazione che si rimanda a GPT bastano i titoli delle proposte, non i documenti interi.
        let noted = proposals.map { $0.isNewDocument ? "[proposto il documento nuovo «\($0.sentTitle)»]" : "[proposta una modifica a «\($0.sentTitle)»]" }
        answer.sent = ([parsed.text] + noted).filter { !$0.isEmpty }.joined(separator: "\n")
        answer.proposals = proposals
        answer.readDocuments = readIDs.compactMap { crm.document($0)?.title }
        // La conversazione può essere cambiata intanto: si aggiunge la risposta a quella salvata.
        var current = chat.conversations.first { $0.id == conversation.id } ?? conversation
        current.messages.append(answer)
        current.updated = .now
        chat.conversations = try await chatStore.save(current)
    }

    /// I documenti del progetto per GPT: riferimenti D1, D2… e titoli anonimizzati (anche il nome del progetto).
    private func agentCatalog() async throws -> (projectName: String, documents: [AgentDocument]) {
        let documents = crm.documents.sorted { $0.updated > $1.updated }
        guard let engine else { throw EngineError.notInstalled }
        let anonymizer = Anonymizer(engine: engine, store: store)
        let names = [currentProject?.name ?? "Progetto"] + documents.map(\.title)
        let joined = try await anonymizer.anonymize(names.joined(separator: "\n"), settings: settings, known: crm.knownValues(), matching: .loose).text
        var titles = joined.components(separatedBy: "\n")
        if titles.count != names.count { titles = ["Progetto"] + documents.indices.map { "Documento \($0 + 1)" } }
        let catalog = documents.enumerated().map { index, document in
            AgentDocument(ref: "D\(index + 1)", id: document.id, title: titles[index + 1], format: document.format)
        }
        return (titles[0], catalog)
    }

    /// Il testo anonimizzato più recente di un documento (l'ultima versione con i segnaposto); se il documento non è
    /// ancora stato anonimizzato, lo si anonimizza adesso.
    func anonymizedText(of documentID: UUID) async throws -> String {
        guard var document = crm.document(documentID) else { return "" }
        if document.versions.allSatisfy({ $0.kind == .original }) {
            await anonymizeDocument(documentID)
            guard let refreshed = crm.document(documentID) else { return "" }
            document = refreshed
        }
        guard let version = document.versions.filter({ $0.kind != .original }).max(by: { $0.created < $1.created }) else { return "" }
        let format = document.format(of: version)
        let data = try await crmStore.data(of: version)
        return try await FileReveal.preview(data, format: format, fileExtension: (version.fileName as NSString).pathExtension).plainText
    }

    // MARK: Le proposte di GPT

    /// Applica una proposta: una modifica diventa una nuova versione del documento, un documento nuovo entra nel progetto.
    func apply(_ proposal: ChatProposal, in messageID: UUID) async {
        guard var conversation = chat.selected, proposal.status == .pending else { return }
        await perform {
            let current = try await store.snapshot()
            if let documentID = proposal.documentID, let document = crm.document(documentID) {
                let kind: TextDocument.Kind = document.format == .plainText ? .plainText : .markdown
                crm = try await crmStore.addAnswer(TextDocument(text: proposal.content, kind: kind), fileName: "",
                                                   summary: "Modifica proposta dalla chat", for: documentID)
            } else {
                let title = Revealer.reveal(proposal.sentTitle, vault: current).text
                let content = Revealer.reveal(proposal.content, vault: current).text
                let added = try await crmStore.addDocument(title: title, text: TextDocument(text: content, kind: .markdown),
                                                           fileName: title + ".md", companyID: nil)
                crm = try await crmStore.setAnonymized(TextDocument(text: proposal.content, kind: .markdown),
                                                       summary: "Scritto dalla chat", for: added.document.id)
            }
            conversation = mark(proposal.id, in: messageID, of: conversation, as: .applied)
            chat.conversations = try await chatStore.save(conversation)
            await touchCurrentProject()
        }
    }

    func discard(_ proposal: ChatProposal, in messageID: UUID) async {
        guard let conversation = chat.selected else { return }
        await perform { chat.conversations = try await chatStore.save(mark(proposal.id, in: messageID, of: conversation, as: .discarded)) }
    }

    private func mark(_ proposalID: UUID, in messageID: UUID, of conversation: ChatConversation, as status: ChatProposal.Status) -> ChatConversation {
        var conversation = conversation
        guard let m = conversation.messages.firstIndex(where: { $0.id == messageID }),
              let p = conversation.messages[m].proposals.firstIndex(where: { $0.id == proposalID }) else { return conversation }
        conversation.messages[m].proposals[p].status = status
        return conversation
    }

    /// Il documento creato da una proposta applicata (per aprirlo).
    func document(for proposal: ChatProposal) -> CRMDocument? {
        if let id = proposal.documentID { return crm.document(id) }
        let title = Revealer.reveal(proposal.sentTitle, vault: vault).text
        return crm.documents.filter { $0.title == title }.max { $0.created < $1.created }
    }

    private func chatFailed(_ error: Error) {
        chat.error = error.localizedDescription
        if let codexError = error as? CodexClient.CodexError, codexError == .notInstalled || codexError == .notLoggedIn {
            Task { await refreshCodexStatus() }
        }
    }

    private func finishChat() {
        chat.task = nil
        chat.phase = nil
    }

    // MARK: Le risposte nel CRM

    /// Una risposta di GPT (con i dati veri) diventa una nota del progetto.
    func saveAsNote(_ message: ChatMessage) async {
        await save(Activity(kind: .note, text: message.text, companyID: nil))
    }

    /// La conversazione in Markdown, con i dati veri.
    func exportConversation(_ conversation: ChatConversation) {
        var lines = ["# \(conversation.displayTitle)", ""]
        for message in conversation.messages {
            lines.append(message.role == .user ? "**Tu** · \(Format.dateTime(message.date))" : "**GPT** · \(Format.dateTime(message.date))")
            lines.append("")
            lines.append(message.text)
            if !message.attachments.isEmpty {
                lines.append("")
                lines.append("Allegati: " + message.attachments.map(\.name).joined(separator: ", "))
            }
            lines.append("")
        }
        do {
            try FilePanels.save(Data(lines.joined(separator: "\n").utf8), suggestedName: conversation.displayTitle.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-") + ".md", in: nil)
        } catch {
            alert = error.localizedDescription
        }
    }
}

// MARK: - Il proprio account ChatGPT

/// Collegare l'account: installare Codex (se manca) e fare l'accesso nel browser.
enum ChatGPTConnection: Equatable {
    case installing
    case waitingForBrowser(URL?)
}

extension AppModel {
    /// Ognuno collega il proprio abbonamento ChatGPT: se serve installa Codex, poi apre l'accesso di OpenAI nel browser.
    func connectChatGPT() {
        guard chat.connection == nil else { return }
        chat.error = nil
        chat.connectionError = nil
        chat.connectionTask = Task {
            defer {
                chat.connection = nil
                chat.connectionTask = nil
            }
            do {
                if CodexClient.executable() == nil {
                    chat.connection = .installing
                    try await CodexClient.install()
                }
                chat.connection = .waitingForBrowser(nil)
                let state = chat
                try await CodexClient.login { url in
                    Task { @MainActor in
                        if case .waitingForBrowser = state.connection { state.connection = .waitingForBrowser(url) }
                    }
                }
                appLog.notice("Account ChatGPT collegato")
            } catch is CancellationError {
            } catch {
                chat.connectionError = error.localizedDescription
            }
            await refreshCodexStatus()
        }
    }

    func cancelChatGPTConnection() {
        chat.connectionTask?.cancel()
    }

    /// Toglie l'account ChatGPT da questo Mac (le conversazioni restano).
    func disconnectChatGPT() async {
        do {
            try await CodexClient.logout()
        } catch {
            chat.connectionError = error.localizedDescription
        }
        await refreshCodexStatus()
    }
}
