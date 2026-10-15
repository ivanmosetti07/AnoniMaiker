import AnonymizerKit
import AppKit
import Foundation
import Observation

// MARK: - La chat con GPT
//
// Domanda e allegati passano dal motore di anonimizzazione prima di partire; la risposta torna con i dati veri. Le
// conversazioni stanno nella cartella cifrata. GPT è quello dell'abbonamento ChatGPT dell'utente, via Codex.

/// Un allegato pronto per la prossima domanda (non ancora anonimizzato).
struct PendingAttachment: Identifiable {
    let id = UUID()
    let symbol: String
    let input: ChatInput

    var name: String { input.name }
}

@Observable
final class ChatState {
    enum Phase: Equatable { case anonymizing, waiting }

    var conversations: [ChatConversation] = []
    var selectedID: UUID?
    var draft = ""
    var pending: [PendingAttachment] = []
    /// Il cliente della prossima conversazione nuova.
    var newClientID: UUID?
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

    /// Il cliente della conversazione aperta (o di quella che sta per nascere).
    var clientID: UUID? { selected.map(\.clientID) ?? newClientID }
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
        chat.newClientID = chat.selected?.clientID ?? chat.newClientID
        chat.selectedID = nil
        chat.error = nil
    }

    func select(_ conversationID: UUID?) {
        guard !chat.isBusy else { return }
        chat.selectedID = conversationID
        chat.error = nil
    }

    /// Cambia il cliente: per una conversazione già iniziata vale per le prossime domande.
    func setChatClient(_ clientID: UUID?) async {
        guard var conversation = chat.selected else {
            chat.newClientID = clientID
            return
        }
        conversation.clientID = clientID
        await saveConversation(conversation)
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

    /// La scheda del cliente (anagrafica, contatti, trattative, note, documenti).
    func attachDossier() {
        guard let clientID = chat.clientID, let company = crm.company(clientID),
              let markdown = ClientDossier.markdown(for: clientID, in: crm) else { return }
        chat.pending.append(PendingAttachment(symbol: "person.text.rectangle", input: .text(name: "Scheda di \(company.name)", text: markdown)))
    }

    /// Un documento del CRM: parte l'originale, anonimizzato adesso con il dizionario di oggi.
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
        var conversation = chat.selected ?? ChatConversation(clientID: chat.newClientID)
        let text = chat.draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let inputs = chat.pending.map(\.input)
        let client = conversation.clientID.flatMap { crm.company($0)?.id }
        let known = client.map { crm.knownValues(for: $0) } ?? []
        let anonymizer = Anonymizer(engine: engine, store: store)
        let settings = settings
        chat.error = nil
        chat.phase = .anonymizing
        chat.task = Task {
            defer { finishChat() }
            do {
                let message = try await anonymizer.chatMessage(text, inputs: inputs, settings: settings, client: client, known: known)
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

    /// Manda a GPT la conversazione (l'ultima domanda e tutto quello che c'era prima) e salva la risposta riconvertita.
    private func ask(_ conversation: ChatConversation) async throws {
        guard let question = conversation.messages.last, question.role == .user else { return }
        chat.phase = .waiting
        let transcript = ChatShield.transcript(history: Array(conversation.messages.dropLast()), next: question)
        let reply = try await codexClient.send(transcript)
        try Task.checkCancellation()
        // La conversazione può essere cambiata intanto (cliente, titolo): si aggiunge la risposta a quella salvata.
        var current = chat.conversations.first { $0.id == conversation.id } ?? conversation
        current.messages.append(ChatShield.reveal(reply, vault: try await store.snapshot()))
        current.updated = .now
        chat.conversations = try await chatStore.save(current)
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

    /// Una risposta di GPT (con i dati veri) diventa una nota nella scheda del cliente.
    func saveAsNote(_ message: ChatMessage) async {
        guard let clientID = chat.selected?.clientID, crm.company(clientID) != nil else { return }
        await save(Activity(kind: .note, text: message.text, companyID: clientID))
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
