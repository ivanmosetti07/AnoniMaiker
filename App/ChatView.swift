import AnonymizerKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: - La chat con GPT, a destra
//
// Un pannello che si apre accanto a ogni sezione (⌘J) e lavora sul progetto aperto: GPT vede l'elenco dei suoi documenti,
// li legge quando servono (sempre anonimizzati) e propone modifiche o documenti nuovi, che si applicano con un clic.
// L'utente vede sempre i dati veri; sotto ogni messaggio c'è «cosa è partito» con i segnaposto.
// L'aspetto è quello di `windows/src/renderer/chat/chat.css`.

struct ChatPanel: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            ChatHeader()
            ChatDivider()
            CodexBanner()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if let conversation = model.chat.selected {
                            ForEach(conversation.messages) { message in
                                MessageView(message: message)
                                    .id(message.id)
                            }
                        } else {
                            EmptyChat()
                        }
                        StatusRow()
                        Color.clear.frame(height: 1).id("fondo")
                    }
                    .padding(12)
                }
                .onChange(of: model.chat.selected?.messages.count) { scrollToBottom(proxy) }
                .onChange(of: model.chat.phase) { scrollToBottom(proxy) }
                .onChange(of: model.chat.selectedID) { scrollToBottom(proxy) }
                .onChange(of: model.chat.error) { scrollToBottom(proxy) }
                .onChange(of: model.chat.pending.count) { scrollToBottom(proxy) }
            }
            ChatDivider()
            Composer()
        }
        .font(Tema.body)
        .foregroundStyle(Tema.text)
        .background(Tema.bg)
        .task {
            if model.chat.codexStatus == nil { await model.refreshCodexStatus() }
        }
    }

    /// In fondo, dopo che la conversazione nuova ha preso le sue misure.
    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(60))
            proxy.scrollTo("fondo", anchor: .bottom)
        }
    }
}

/// La linea sottile fra le parti del pannello.
private struct ChatDivider: View {
    var body: some View {
        Rectangle().fill(Tema.border).frame(height: 1)
    }
}

/// In cima: la conversazione aperta e il menu per cambiarla, una nuova, esportare o cancellare.
private struct ChatHeader: View {
    @Environment(AppModel.self) private var model
    @State private var deleting: ChatConversation?

    var body: some View {
        let chat = model.chat
        HStack(spacing: 6) {
            Menu {
                Button("Nuova conversazione", systemImage: "square.and.pencil") { model.newConversation() }
                if !chat.conversations.isEmpty { Divider() }
                ForEach(chat.conversations) { conversation in
                    Button {
                        model.select(conversation.id)
                    } label: {
                        if conversation.id == chat.selectedID { Label(conversation.displayTitle, systemImage: "checkmark") } else { Text(conversation.displayTitle) }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(chat.selected?.displayTitle ?? "Nuova conversazione")
                        .font(Tema.headline)
                        .foregroundStyle(Tema.text)
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(Tema.secondary)
                }
                .contentShape(.rect)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .disabled(chat.isBusy)
            .layoutPriority(-1)
            Spacer(minLength: 4)
            ChatModelMenu()
            Button {
                model.newConversation()
            } label: {
                BarIcon(title: "Nuova conversazione", symbol: "square.and.pencil")
            }
            .buttonStyle(.plainIcon)
            .disabled(chat.isBusy || chat.selectedID == nil)
            .help("Nuova conversazione")
            Menu {
                Button("Esporta in Markdown…") { if let conversation = chat.selected { model.exportConversation(conversation) } }
                    .disabled(chat.selected?.messages.isEmpty ?? true)
                Divider()
                Button("Elimina la conversazione…", role: .destructive) { deleting = chat.selected }
                    .disabled(chat.selected == nil)
            } label: {
                BarIcon(title: "Altro", symbol: "ellipsis")
            }
            .menuStyle(.button)
            .buttonStyle(.plainIcon)
            .menuIndicator(.hidden)
            .fixedSize()
            .disabled(chat.isBusy)
            .help("Altro")
        }
        .padding(.leading, 12)
        .padding(.trailing, 8)
        .padding(.vertical, 6)
        .frame(minHeight: 44)
        .background(Tema.bar)
        .confirmationDialog("Eliminare la conversazione?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            presenting: deleting) { conversation in
            Button("Elimina", role: .destructive) { Task { await model.deleteConversation(conversation.id) } }
        } message: { conversation in
            Text("«\(conversation.displayTitle)» si cancella da questo Mac. Documenti e dizionario non cambiano.")
        }
    }
}

/// Il modello in uso, con il menu per cambiarlo (solo terra, luna e sol dalla versione 6).
private struct ChatModelMenu: View {
    @Environment(AppModel.self) private var model
    @AppStorage(AppModel.chatEffortKey) private var effort = ""
    @State private var hovering = false

    var body: some View {
        let _ = model.chat.modelRevision
        let current = model.chatModel
        if !model.chat.models.isEmpty {
            Menu {
                Picker("Modello", selection: Binding(get: { current?.slug ?? "" }, set: { model.chooseChatModel($0) })) {
                    ForEach(model.chat.models) { item in
                        Text(item.name).tag(item.slug)
                    }
                }
                .pickerStyle(.inline)
                if let current, !current.efforts.isEmpty {
                    Picker("Ragionamento", selection: $effort) {
                        Text("Predefinito").tag("")
                        ForEach(current.efforts, id: \.self) { level in
                            Text(CodexClient.effortTitle(level)).tag(level)
                        }
                    }
                }
            } label: {
                Text(current?.name ?? "Modello")
                    .font(Tema.caption)
                    .foregroundStyle(Tema.text)
                    .lineLimit(1)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(hovering ? Tema.hover : Tema.selected, in: .capsule)
                    .overlay(Capsule().strokeBorder(hovering ? Tema.border : .clear))
                    .contentShape(.capsule)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .disabled(model.chat.isBusy)
            .onHover { hovering = $0 && !model.chat.isBusy }
            .help("Il modello di GPT per questa chat")
        }
    }
}

/// Manca il collegamento a ChatGPT: si collega da qui.
private struct CodexBanner: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let missing = switch model.chat.codexStatus {
        case .notInstalled, .notLoggedIn: true
        default: false
        }
        if missing || model.chat.connection != nil {
            ChatGPTConnectView(compact: true)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Tema.accentSoft)
                .overlay(alignment: .bottom) { ChatDivider() }
        }
    }
}

private struct EmptyChat: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 26, weight: .light))
                .foregroundStyle(Tema.secondary)
                .frame(height: 30)
            Text("Chiedi a GPT sul progetto")
                .font(.system(size: 14, weight: .semibold))
            Text("GPT vede l'elenco dei documenti di «\(model.currentProject?.name ?? "")», li legge quando servono e può proporre modifiche o documenti nuovi: li applichi tu con un clic. Prima di partire tutto passa dal motore di anonimizzazione sul Mac: a GPT arrivano solo segnaposto come [FULLNAME_1].")
                .font(Tema.callout)
                .foregroundStyle(Tema.secondary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(["Riassumi i documenti del progetto", "Scrivi una mail di conferma ai partecipanti", "Correggi gli orari nel programma"], id: \.self) { idea in
                    Button {
                        model.chat.draft = idea
                    } label: {
                        Label(idea, systemImage: "sparkle").font(Tema.callout)
                    }
                    .buttonStyle(.accentLink)
                }
            }
            .padding(.top, 4)
        }
        .padding(.top, 20)
    }
}

/// Mentre si lavora, o dopo un errore.
private struct StatusRow: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let chat = model.chat
        if let phase = chat.phase {
            HStack(spacing: 8) {
                ProgressView().controlSize(.mini)
                Text(text(for: phase)).foregroundStyle(Tema.secondary)
                Button("Annulla") { model.cancelChat() }
                    .buttonStyle(.accentLink)
            }
            .font(Tema.callout)
        } else if let error = chat.error {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "exclamationmark.triangle").foregroundStyle(Tema.orange)
                Text(error).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                if chat.selected?.messages.last?.role == .user {
                    Button("Riprova") { model.retryChat() }
                        .buttonStyle(.flatSmall)
                }
            }
            .font(Tema.callout)
        }
    }

    private func text(for phase: ChatState.Phase) -> String {
        switch phase {
        case .anonymizing: "Anonimizzo la domanda sul Mac…"
        case .waiting: "GPT sta scrivendo…"
        case .reading(let titles): "Leggo " + titles.map { "«\($0)»" }.joined(separator: ", ") + " (anonimizzati)…"
        }
    }
}

/// Un messaggio: i dati veri, gli allegati, i documenti letti, le proposte, e a richiesta la forma con i segnaposto.
private struct MessageView: View {
    @Environment(AppModel.self) private var model
    let message: ChatMessage
    @State private var showsSent = false
    @State private var savedNote = false

    private var isUser: Bool { message.role == .user }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(isUser ? "Tu" : "GPT").fontWeight(.semibold)
                Text(Format.dateTime(message.date)).foregroundStyle(Tema.secondary)
            }
            .font(Tema.caption)
            if !message.readDocuments.isEmpty {
                Label("Ha letto: " + message.readDocuments.map { "«\($0)»" }.joined(separator: ", "), systemImage: "doc.text.magnifyingglass")
                    .font(Tema.caption)
                    .foregroundStyle(Tema.secondary)
            }
            if !message.text.isEmpty {
                if isUser {
                    Text(message.text)
                        .lineSpacing(3)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ChatMarkdownView(text: message.text)
                }
            }
            if !message.attachments.isEmpty {
                FlowAttachments(names: message.attachments.map(\.name))
            }
            ForEach(message.proposals) { proposal in
                ProposalCard(proposal: proposal, messageID: message.id)
            }
            footer
            if showsSent {
                SentText(message: message)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isUser ? Tema.accent.opacity(0.10) : Color.gray.opacity(0.08), in: .rect(cornerRadius: 10))
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if !message.summary.isEmpty {
                Label(isUser ? "Nascosti: \(message.summary)" : message.summary, systemImage: isUser ? "eye.slash" : "arrow.uturn.backward")
                    .lineLimit(1)
                    .help(isUser ? "Nascosti: \(message.summary)" : message.summary)
            } else if isUser {
                Label("Nessun dato da nascondere", systemImage: "eye")
            }
            if !message.unknown.isEmpty {
                Image(systemName: "questionmark.circle")
                    .foregroundStyle(Tema.orange)
                    .help("Segnaposto sconosciuti: \(message.unknown.joined(separator: ", ")) (restano come sono)")
            }
            Spacer(minLength: 0)
            Button(showsSent ? "Nascondi" : (isUser ? "Cosa è partito" : "Com'è arrivata")) { showsSent.toggle() }
                .buttonStyle(.accentLink)
            if !isUser {
                Button {
                    model.copy(message.text)
                } label: {
                    FooterIcon(symbol: "doc.on.doc")
                }
                .buttonStyle(PlainIconButtonStyle(padding: 3))
                .help("Copia la risposta con i dati veri")
                Button {
                    Task {
                        await model.saveAsNote(message)
                        savedNote = true
                    }
                } label: {
                    FooterIcon(symbol: savedNote ? "checkmark" : "square.and.pencil")
                }
                .buttonStyle(PlainIconButtonStyle(padding: 3))
                .disabled(savedNote)
                .help(savedNote ? "Salvata" : "Salva la risposta fra le note del progetto")
            }
        }
        .font(Tema.caption)
        .foregroundStyle(Tema.secondary)
        .frame(minHeight: 22)
    }
}

/// Le icone piccole in fondo a un messaggio.
private struct FooterIcon: View {
    let symbol: String

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 12))
            .foregroundStyle(Tema.secondary)
            .frame(width: 14, height: 14)
    }
}

/// Una proposta di GPT: il testo già riconvertito, da applicare (nuova versione o documento nuovo) o scartare.
private struct ProposalCard: View {
    @Environment(AppModel.self) private var model
    let proposal: ChatProposal
    let messageID: UUID
    @State private var expanded = false

    var body: some View {
        let title = Revealer.reveal(proposal.sentTitle, vault: model.vault).text
        let content = Revealer.reveal(proposal.content, vault: model.vault).text
        VStack(alignment: .leading, spacing: 8) {
            Label(proposal.isNewDocument ? "Nuovo documento «\(title)»" : "Modifica a «\(title)»",
                  systemImage: proposal.isNewDocument ? "doc.badge.plus" : "list.clipboard")
                .font(Tema.headline)
                .fixedSize(horizontal: false, vertical: true)
            Text(expanded ? content : String(content.prefix(600)) + (content.count > 600 ? "…" : ""))
                .font(Tema.callout)
                .lineSpacing(3)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Tema.surface.opacity(0.92), in: .rect(cornerRadius: 6))
            HStack(spacing: 8) {
                if content.count > 600 {
                    Button(expanded ? "Mostra meno" : "Mostra tutto") { expanded.toggle() }
                        .buttonStyle(.accentLink)
                        .font(Tema.caption)
                }
                Spacer()
                switch proposal.status {
                case .pending:
                    Button("Scarta") { Task { await model.discard(proposal, in: messageID) } }
                        .buttonStyle(.flat)
                    Button(proposal.isNewDocument ? "Aggiungi al progetto" : "Applica come nuova versione") {
                        Task { await model.apply(proposal, in: messageID) }
                    }
                    .buttonStyle(.primary)
                case .applied:
                    Label("Applicata", systemImage: "checkmark.circle").foregroundStyle(Tema.green).font(Tema.caption)
                    if let document = model.document(for: proposal) {
                        Button("Apri il documento") { model.openDocument(document.id) }
                            .buttonStyle(.accentLink)
                            .font(Tema.caption)
                    }
                case .discarded:
                    Label("Scartata", systemImage: "xmark.circle").foregroundStyle(Tema.secondary).font(Tema.caption)
                }
            }
        }
        .padding(10)
        .background(Tema.accent.opacity(0.06), in: .rect(cornerRadius: Tema.radius))
        .overlay(RoundedRectangle(cornerRadius: Tema.radius).strokeBorder(Tema.accent.opacity(0.35)))
    }
}

/// Il testo con i segnaposto, così com'è partito o arrivato.
private struct SentText: View {
    let message: ChatMessage
    private static let limit = 6000

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(ChatText.placeholders(message.sent))
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(message.attachments) { attachment in
                VStack(alignment: .leading, spacing: 4) {
                    Text("Allegato «\(attachment.sentName)»" + (attachment.summary.isEmpty ? "" : " · nascosti: \(attachment.summary)"))
                        .font(Tema.caption)
                        .foregroundStyle(Tema.secondary)
                    let text = attachment.sentText.count > Self.limit ? String(attachment.sentText.prefix(Self.limit)) + "\n…" : attachment.sentText
                    Text(ChatText.placeholders(text))
                        .font(Tema.mono)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .textSelection(.enabled)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tema.surface, in: .rect(cornerRadius: Tema.radius))
        .overlay(RoundedRectangle(cornerRadius: Tema.radius).strokeBorder(Tema.border))
    }
}

private struct FlowAttachments: View {
    let names: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(names.enumerated()), id: \.offset) { _, name in
                Label(name, systemImage: "paperclip")
                    .font(Tema.callout)
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
                            PendingChip(attachment: attachment)
                        }
                    }
                }
            }
            HStack(alignment: .bottom, spacing: 6) {
                attachMenu
                TextField("Chiedi a GPT sul progetto…", text: $chat.draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(Tema.body)
                    .lineLimit(1...8)
                    .focused($focused)
                    .onSubmit { model.sendChat() }
                    .disabled(chat.isBusy)
                    .opacity(chat.isBusy ? 0.6 : 1)
                    .padding(.vertical, 7)
                    .padding(.horizontal, 2)
                Button {
                    model.sendChat()
                } label: {
                    Image(systemName: "arrow.up")
                }
                .buttonStyle(SendButtonStyle())
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!model.canSendChat)
                .help(model.engine == nil || model.engineState == .missing ? "Senza motore di anonimizzazione la chat non parte" : "Anonimizza e invia (↩ o ⌘↩)")
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 3)
            .background(Tema.surface, in: .rect(cornerRadius: Tema.radius))
            .overlay(RoundedRectangle(cornerRadius: Tema.radius).strokeBorder(focused ? Tema.accent : Tema.border))
            .background(RoundedRectangle(cornerRadius: Tema.radius + 1).stroke(focused ? Tema.accentSoft : .clear, lineWidth: 4))
            .contentShape(.rect)
            .onTapGesture { focused = true }
            Text("I dati personali partono come segnaposto.")
                .font(Tema.caption)
                .foregroundStyle(Tema.tertiary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(dropTargeted ? Tema.accentSoft : Tema.bg)
        .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
            for provider in providers {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    if let url { Task { @MainActor in model.attach([url]) } }
                }
            }
            return true
        }
        .onAppear { focused = true }
        .onChange(of: model.chat.isBusy) { if !model.chat.isBusy { focused = true } }
    }

    private var attachMenu: some View {
        let documents = model.crm.documents.sorted { $0.updated > $1.updated }
        return Menu {
            Menu("Documento del progetto") {
                ForEach(documents) { document in
                    Button(document.title) { Task { await model.attach(document) } }
                }
            }
            .disabled(documents.isEmpty)
            Menu("Scheda di un'azienda") {
                ForEach(model.companyChoices) { company in
                    Button(company.name) { model.attachDossier(company.id) }
                }
            }
            .disabled(model.crm.companies.isEmpty)
            Divider()
            Button("File dal Mac…", systemImage: "doc") { model.attachFiles() }
        } label: {
            Image(systemName: "paperclip")
                .font(.system(size: 15))
                .foregroundStyle(Tema.secondary)
                .frame(width: 18, height: 18)
        }
        .menuStyle(.button)
        .buttonStyle(.plainIcon)
        .menuIndicator(.hidden)
        .fixedSize()
        .disabled(model.chat.isBusy)
        .help("Allega un documento del progetto, la scheda di un'azienda o un file. GPT può anche cercare da solo fra i documenti del progetto.")
    }
}

/// Un allegato in attesa: pillola grigia con il pulsantino tondo per toglierlo.
private struct PendingChip: View {
    @Environment(AppModel.self) private var model
    let attachment: PendingAttachment
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: Self.outline(attachment.symbol)).font(.system(size: 12))
            Text(attachment.name).lineLimit(1).truncationMode(.middle)
            Button {
                model.removePending(attachment.id)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 7, weight: .bold))
                    .foregroundStyle(Tema.bg)
                    .frame(width: 15, height: 15)
                    .background(hovering ? Tema.text : Tema.secondary, in: .circle)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .disabled(model.chat.isBusy)
            .opacity(model.chat.isBusy ? 0.45 : 1)
            .help("Togli")
        }
        .font(Tema.callout)
        .padding(.leading, 8)
        .padding(.trailing, 4)
        .padding(.vertical, 3)
        .frame(maxWidth: 220)
        .background(Tema.selected, in: .capsule)
    }

    /// Le icone in versione contorno, come le Lucide di Windows.
    private static func outline(_ symbol: String) -> String {
        symbol.hasSuffix(".fill") ? String(symbol.dropLast(5)) : symbol
    }
}

/// Il pulsante d'invio: tondo arancione con la freccia bianca; spento, grigio.
private struct SendButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        SendButton(configuration: configuration, isEnabled: isEnabled)
    }

    private struct SendButton: View {
        let configuration: Configuration
        let isEnabled: Bool
        @State private var hovering = false

        var body: some View {
            configuration.label
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(isEnabled ? Tema.onAccent : Tema.tertiary)
                .frame(width: 28, height: 28)
                .background(isEnabled ? (hovering || configuration.isPressed ? Tema.accentStrong : Tema.accent) : Tema.selected, in: .circle)
                .padding(1)
                .contentShape(.circle)
                .onHover { hovering = $0 && isEnabled }
        }
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
