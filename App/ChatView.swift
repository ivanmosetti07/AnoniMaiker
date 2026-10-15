import AnonymizerKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Chat con GPT
//
// A sinistra le conversazioni, a destra quella aperta. L'utente vede sempre i dati veri; sotto ogni messaggio si può
// aprire «cosa è partito» (o «com'è arrivata»), cioè il testo con i segnaposto, l'unico che lascia il Mac.

struct ChatView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HSplitView {
            ConversationList()
                .frame(minWidth: 190, idealWidth: 230, maxWidth: 320)
            ConversationPane()
                .frame(minWidth: 440, maxWidth: .infinity)
        }
        .toolbar { toolbar }
        .task {
            if model.chat.codexStatus == nil { await model.refreshCodexStatus() }
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        let chat = model.chat
        ToolbarItemGroup(placement: .primaryAction) {
            Picker("Cliente", selection: Binding(get: { chat.clientID }, set: { value in Task { await model.setChatClient(value) } })) {
                Text("Nessun cliente").tag(UUID?.none)
                ForEach(model.companyChoices) { company in
                    Text(company.name).tag(Optional(company.id))
                }
            }
            .pickerStyle(.menu)
            .disabled(chat.isBusy)
            .help("Lega i dati della conversazione a un cliente del CRM: si nascondono anche quelli che il CRM conosce di lui")
            Button("Nuova conversazione", systemImage: "square.and.pencil") { model.newConversation() }
                .keyboardShortcut("n")
                .disabled(chat.isBusy || chat.selectedID == nil)
                .help("Nuova conversazione (⌘N)")
            Button("Esporta…", systemImage: "square.and.arrow.up") {
                if let conversation = chat.selected { model.exportConversation(conversation) }
            }
            .disabled(chat.selected?.messages.isEmpty ?? true)
            .help("Salva la conversazione in Markdown, con i dati veri")
        }
    }
}

/// L'elenco delle conversazioni, dalla più recente.
private struct ConversationList: View {
    @Environment(AppModel.self) private var model
    @State private var deleting: ChatConversation?

    var body: some View {
        let chat = model.chat
        List(selection: Binding(get: { chat.selectedID }, set: { model.select($0) })) {
            ForEach(chat.conversations) { conversation in
                VStack(alignment: .leading, spacing: 2) {
                    Text(conversation.displayTitle)
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        if let company = model.crm.company(conversation.clientID) {
                            Text(company.name).lineLimit(1)
                            Text("·")
                        }
                        Text(Format.date(conversation.updated))
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
                .tag(conversation.id)
                .contextMenu {
                    Button("Esporta…") { model.exportConversation(conversation) }
                    Divider()
                    Button("Elimina…", role: .destructive) { deleting = conversation }
                }
            }
        }
        .overlay {
            if chat.conversations.isEmpty {
                Text("Nessuna conversazione")
                    .foregroundStyle(.tertiary)
            }
        }
        .confirmationDialog("Eliminare la conversazione?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            presenting: deleting) { conversation in
            Button("Elimina", role: .destructive) { Task { await model.deleteConversation(conversation.id) } }
        } message: { conversation in
            Text("«\(conversation.displayTitle)» si cancella da questo Mac. Il dizionario non cambia.")
        }
    }
}

/// La conversazione aperta, con la casella per scrivere.
private struct ConversationPane: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let chat = model.chat
        VStack(spacing: 0) {
            CodexBanner()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if let conversation = chat.selected {
                            ForEach(conversation.messages) { message in
                                MessageView(message: message, clientID: conversation.clientID)
                                    .id(message.id)
                            }
                        } else {
                            EmptyChat()
                        }
                        StatusRow()
                            .id("fondo")
                    }
                    .padding(18)
                }
                .onChange(of: chat.selected?.messages.count) { proxy.scrollTo("fondo", anchor: .bottom) }
                .onChange(of: chat.phase) { proxy.scrollTo("fondo", anchor: .bottom) }
                .onChange(of: chat.selectedID) { proxy.scrollTo("fondo", anchor: .bottom) }
            }
            Divider()
            Composer()
        }
    }
}

/// Codex manca o non ha fatto l'accesso: come rimediare.
private struct CodexBanner: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        switch model.chat.codexStatus {
        case .notInstalled:
            banner("Per la chat serve Codex, la riga di comando di OpenAI che usa il tuo abbonamento ChatGPT.",
                   command: "npm install -g @openai/codex", then: "Poi fai l'accesso con «codex login».")
        case .notLoggedIn:
            banner("Codex non ha fatto l'accesso al tuo account ChatGPT.", command: "codex login",
                   then: "Si apre il browser: entra con l'account del tuo abbonamento.")
        default:
            EmptyView()
        }
    }

    private func banner(_ text: String, command: String, then: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.bubble")
                .foregroundStyle(.orange)
                .font(.title3)
            VStack(alignment: .leading, spacing: 6) {
                Text(text)
                HStack {
                    Text("Nel Terminale:")
                    Text(command)
                        .font(.body.monospaced())
                        .textSelection(.enabled)
                    Button("Copia", systemImage: "doc.on.doc") { model.copy(command) }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .help("Copia il comando")
                }
                Text(then).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Controlla di nuovo") { Task { await model.refreshCodexStatus() } }
        }
        .font(.callout)
        .padding(12)
        .background(.orange.opacity(0.08))
    }
}

private struct EmptyChat: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "bubble.left.and.text.bubble.right")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(.secondary)
            Text("Chiedi a GPT, senza dargli i dati veri")
                .font(.title3)
            Text("Scrivi una domanda e allega file, documenti del CRM o la scheda di un cliente. Prima di partire tutto passa dal motore di anonimizzazione sul Mac: a GPT arrivano solo segnaposto come [FULLNAME_1], e la risposta torna con i dati veri.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: 460)
            if let client = model.crm.company(model.chat.clientID) {
                Label("I dati saranno legati a \(client.name)", systemImage: "building.2")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }
}

/// Mentre si lavora, o dopo un errore.
private struct StatusRow: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let chat = model.chat
        if let phase = chat.phase {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(phase == .anonymizing ? "Anonimizzo la domanda e gli allegati sul Mac…" : "GPT sta scrivendo…")
                    .foregroundStyle(.secondary)
                Button("Annulla") { model.cancelChat() }
                    .buttonStyle(.link)
            }
            .font(.callout)
        } else if let error = chat.error {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                Text(error).textSelection(.enabled)
                if chat.selected?.messages.last?.role == .user {
                    Button("Riprova") { model.retryChat() }
                }
            }
            .font(.callout)
        }
    }
}

/// Un messaggio: i dati veri, gli allegati, cosa è stato nascosto, e a richiesta la forma con i segnaposto.
private struct MessageView: View {
    @Environment(AppModel.self) private var model
    let message: ChatMessage
    let clientID: UUID?
    @State private var showsSent = false
    @State private var savedNote = false

    private var isUser: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 60) }
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Text(isUser ? "Tu" : "GPT").fontWeight(.semibold)
                    Text(Format.dateTime(message.date)).foregroundStyle(.secondary)
                }
                .font(.caption)
                if !message.text.isEmpty {
                    Text(isUser ? AttributedString(message.text) : ChatText.markdown(message.text))
                        .textSelection(.enabled)
                }
                if !message.attachments.isEmpty {
                    FlowAttachments(names: message.attachments.map(\.name))
                }
                footer
                if showsSent {
                    SentText(message: message)
                }
            }
            .padding(12)
            .background(isUser ? Color.accentColor.opacity(0.10) : Color.secondary.opacity(0.08), in: .rect(cornerRadius: 10))
            if !isUser { Spacer(minLength: 60) }
        }
    }

    private var footer: some View {
        HStack(spacing: 12) {
            if !message.summary.isEmpty {
                Label(isUser ? "Nascosti: \(message.summary)" : message.summary, systemImage: isUser ? "eye.slash" : "arrow.uturn.backward")
            } else if isUser {
                Label("Nessun dato da nascondere", systemImage: "eye")
            }
            if !message.unknown.isEmpty {
                Label("Segnaposto sconosciuti: \(message.unknown.joined(separator: ", "))", systemImage: "questionmark.diamond")
                    .foregroundStyle(.orange)
                    .help("GPT ha scritto segnaposto che il dizionario non conosce: restano come sono")
            }
            Spacer(minLength: 0)
            Button(showsSent ? "Nascondi" : (isUser ? "Cosa è partito" : "Com'è arrivata")) { showsSent.toggle() }
                .buttonStyle(.link)
            if !isUser {
                Button("Copia", systemImage: "doc.on.doc") { model.copy(message.text) }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .help("Copia la risposta con i dati veri")
                if model.crm.company(clientID) != nil {
                    Button(savedNote ? "Salvata" : "Salva come nota", systemImage: savedNote ? "checkmark" : "note.text.badge.plus") {
                        Task {
                            await model.saveAsNote(message)
                            savedNote = true
                        }
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .disabled(savedNote)
                    .help("Salva la risposta come nota nella scheda del cliente")
                }
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }
}

/// Il testo con i segnaposto, così com'è partito o arrivato.
private struct SentText: View {
    let message: ChatMessage
    private static let limit = 6000

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(ChatText.placeholders(message.sent))
            ForEach(message.attachments) { attachment in
                VStack(alignment: .leading, spacing: 4) {
                    Text("Allegato «\(attachment.sentName)»" + (attachment.summary.isEmpty ? "" : " · nascosti: \(attachment.summary)"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    let text = attachment.sentText.count > Self.limit ? String(attachment.sentText.prefix(Self.limit)) + "\n…" : attachment.sentText
                    Text(ChatText.placeholders(text))
                        .font(.callout.monospaced())
                }
            }
        }
        .textSelection(.enabled)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.opacity(0.6), in: .rect(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
    }
}

private struct FlowAttachments: View {
    let names: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(names.enumerated()), id: \.offset) { _, name in
                Label(name, systemImage: "paperclip")
                    .font(.callout)
                    .lineLimit(1)
            }
        }
    }
}

/// La casella in fondo: allegati in attesa, testo, invio.
private struct Composer: View {
    @Environment(AppModel.self) private var model
    @FocusState private var focused: Bool
    @State private var dropTargeted = false

    var body: some View {
        @Bindable var chat = model.chat
        VStack(alignment: .leading, spacing: 8) {
            if !chat.pending.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(chat.pending) { attachment in
                            HStack(spacing: 4) {
                                Image(systemName: attachment.symbol)
                                Text(attachment.name).lineLimit(1)
                                Button("Togli", systemImage: "xmark.circle.fill") { model.removePending(attachment.id) }
                                    .labelStyle(.iconOnly)
                                    .buttonStyle(.borderless)
                                    .disabled(chat.isBusy)
                            }
                            .font(.callout)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(.secondary.opacity(0.12), in: .capsule)
                        }
                    }
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                attachMenu
                TextField("Scrivi a GPT… (i dati personali partono come segnaposto)", text: $chat.draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...10)
                    .focused($focused)
                    .onSubmit { model.sendChat() }
                    .disabled(chat.isBusy)
                    .padding(.vertical, 6)
                Button {
                    model.sendChat()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .buttonStyle(.borderless)
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!model.canSendChat)
                .help(sendHelp)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(dropTargeted ? Color.accentColor.opacity(0.08) : Color.clear)
        .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
            for provider in providers {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    if let url { Task { @MainActor in model.attach([url]) } }
                }
            }
            return true
        }
        .onAppear { focused = true }
    }

    private var sendHelp: String {
        if model.engine == nil || model.engineState == .missing { return "Senza motore di anonimizzazione la chat non parte" }
        return "Anonimizza e invia (↩ o ⌘↩)"
    }

    private var attachMenu: some View {
        let chat = model.chat
        let documents = chat.clientID.map { model.crm.documents(of: $0) } ?? []
        return Menu {
            Button("File…", systemImage: "doc") { model.attachFiles() }
            Divider()
            Button("Scheda del cliente", systemImage: "person.text.rectangle") { model.attachDossier() }
                .disabled(model.crm.company(chat.clientID) == nil)
            Menu("Documento del cliente") {
                ForEach(documents) { document in
                    Button(document.title) { Task { await model.attach(document) } }
                }
            }
            .disabled(documents.isEmpty)
        } label: {
            Image(systemName: "paperclip")
                .font(.title3)
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .menuIndicator(.hidden)
        .fixedSize()
        .disabled(chat.isBusy)
        .help("Allega un file, la scheda del cliente o un suo documento")
    }
}

enum ChatText {
    /// Le risposte di GPT in Markdown (grassetto, corsivo, codice, collegamenti), con gli a capo.
    static func markdown(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }

    /// Il testo con i segnaposto evidenziati.
    static func placeholders(_ text: String) -> AttributedString {
        var attributed = AttributedString(text)
        for range in Revealer.placeholderRanges(in: text) {
            guard let bounds = Range(range, in: text),
                  let lower = AttributedString.Index(bounds.lowerBound, within: attributed),
                  let upper = AttributedString.Index(bounds.upperBound, within: attributed) else { continue }
            attributed[lower..<upper].backgroundColor = .yellow.opacity(0.35)
        }
        return attributed
    }
}
