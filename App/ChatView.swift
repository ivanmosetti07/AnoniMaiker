import AnonymizerKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: - La chat con GPT, a destra
//
// Un pannello che si apre accanto a ogni sezione (⌘J) e lavora sul progetto aperto: GPT vede l'elenco dei suoi documenti,
// li legge quando servono (sempre anonimizzati) e propone modifiche o documenti nuovi, che si applicano con un clic.
// L'utente vede sempre i dati veri; sotto ogni messaggio c'è «cosa è partito» con i segnaposto.

struct ChatPanel: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            ChatHeader()
            Divider()
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
                            .id("fondo")
                    }
                    .padding(12)
                }
                .onChange(of: model.chat.selected?.messages.count) { proxy.scrollTo("fondo", anchor: .bottom) }
                .onChange(of: model.chat.phase) { proxy.scrollTo("fondo", anchor: .bottom) }
                .onChange(of: model.chat.selectedID) { proxy.scrollTo("fondo", anchor: .bottom) }
            }
            Divider()
            Composer()
        }
        .task {
            if model.chat.codexStatus == nil { await model.refreshCodexStatus() }
        }
    }
}

/// In cima: la conversazione aperta e il menu per cambiarla, una nuova, esportare o cancellare.
private struct ChatHeader: View {
    @Environment(AppModel.self) private var model
    @State private var deleting: ChatConversation?

    var body: some View {
        let chat = model.chat
        HStack(spacing: 8) {
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
                        .fontWeight(.semibold)
                        .lineLimit(1)
                    Image(systemName: "chevron.down").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .disabled(chat.isBusy)
            Spacer()
            Button("Nuova conversazione", systemImage: "square.and.pencil") { model.newConversation() }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .disabled(chat.isBusy || chat.selectedID == nil)
                .help("Nuova conversazione")
            Menu {
                Button("Esporta in Markdown…") { if let conversation = chat.selected { model.exportConversation(conversation) } }
                    .disabled(chat.selected?.messages.isEmpty ?? true)
                Divider()
                Button("Elimina la conversazione…", role: .destructive) { deleting = chat.selected }
                    .disabled(chat.selected == nil)
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .disabled(chat.isBusy)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .confirmationDialog("Eliminare la conversazione?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            presenting: deleting) { conversation in
            Button("Elimina", role: .destructive) { Task { await model.deleteConversation(conversation.id) } }
        } message: { conversation in
            Text("«\(conversation.displayTitle)» si cancella da questo Mac. Documenti e dizionario non cambiano.")
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
                .background(Color.accentColor.opacity(0.08))
        }
    }
}

private struct EmptyChat: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "bubble.left.and.text.bubble.right")
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(.secondary)
            Text("Chiedi a GPT sul progetto").font(.headline)
            Text("GPT vede l'elenco dei documenti di «\(model.currentProject?.name ?? "")», li legge quando servono e può proporre modifiche o documenti nuovi: li applichi tu con un clic. Prima di partire tutto passa dal motore di anonimizzazione sul Mac: a GPT arrivano solo segnaposto come [FULLNAME_1].")
                .font(.callout)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(["Riassumi i documenti del progetto", "Scrivi una mail di conferma ai partecipanti", "Correggi gli orari nel programma"], id: \.self) { idea in
                    Button {
                        model.chat.draft = idea
                    } label: {
                        Label(idea, systemImage: "sparkle").font(.callout)
                    }
                    .buttonStyle(.link)
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
                ProgressView().controlSize(.small)
                Text(text(for: phase)).foregroundStyle(.secondary)
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
                Text(Format.dateTime(message.date)).foregroundStyle(.secondary)
            }
            .font(.caption)
            if !message.readDocuments.isEmpty {
                Label("Ha letto: " + message.readDocuments.map { "«\($0)»" }.joined(separator: ", "), systemImage: "doc.text.magnifyingglass")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if !message.text.isEmpty {
                Text(isUser ? AttributedString(message.text) : ChatText.markdown(message.text))
                    .textSelection(.enabled)
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
        .background(isUser ? Color.accentColor.opacity(0.10) : Color.secondary.opacity(0.08), in: .rect(cornerRadius: 10))
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if !message.summary.isEmpty {
                Label(isUser ? "Nascosti: \(message.summary)" : message.summary, systemImage: isUser ? "eye.slash" : "arrow.uturn.backward")
                    .lineLimit(1)
            } else if isUser {
                Label("Nessun dato da nascondere", systemImage: "eye")
            }
            if !message.unknown.isEmpty {
                Image(systemName: "questionmark.diamond")
                    .foregroundStyle(.orange)
                    .help("Segnaposto sconosciuti: \(message.unknown.joined(separator: ", ")) (restano come sono)")
            }
            Spacer(minLength: 0)
            Button(showsSent ? "Nascondi" : (isUser ? "Cosa è partito" : "Com'è arrivata")) { showsSent.toggle() }
                .buttonStyle(.link)
            if !isUser {
                Button("Copia", systemImage: "doc.on.doc") { model.copy(message.text) }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .help("Copia la risposta con i dati veri")
                Button(savedNote ? "Salvata" : "Salva come nota", systemImage: savedNote ? "checkmark" : "note.text.badge.plus") {
                    Task {
                        await model.saveAsNote(message)
                        savedNote = true
                    }
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .disabled(savedNote)
                .help("Salva la risposta fra le note del progetto")
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
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
                  systemImage: proposal.isNewDocument ? "doc.badge.plus" : "pencil.and.list.clipboard")
                .fontWeight(.semibold)
            Text(expanded ? content : String(content.prefix(600)) + (content.count > 600 ? "…" : ""))
                .font(.callout)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(.background.opacity(0.7), in: .rect(cornerRadius: 6))
            HStack {
                if content.count > 600 {
                    Button(expanded ? "Mostra meno" : "Mostra tutto") { expanded.toggle() }
                        .buttonStyle(.link)
                        .font(.caption)
                }
                Spacer()
                switch proposal.status {
                case .pending:
                    Button("Scarta") { Task { await model.discard(proposal, in: messageID) } }
                    Button(proposal.isNewDocument ? "Aggiungi al progetto" : "Applica come nuova versione") {
                        Task { await model.apply(proposal, in: messageID) }
                    }
                    .buttonStyle(.borderedProminent)
                case .applied:
                    Label("Applicata", systemImage: "checkmark.circle.fill").foregroundStyle(.green).font(.caption)
                    if let document = model.document(for: proposal) {
                        Button("Apri il documento") { model.openDocument(document.id) }
                            .buttonStyle(.link)
                            .font(.caption)
                    }
                case .discarded:
                    Label("Scartata", systemImage: "xmark.circle").foregroundStyle(.secondary).font(.caption)
                }
            }
        }
        .padding(10)
        .background(Color.accentColor.opacity(0.06), in: .rect(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.accentColor.opacity(0.35)))
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
                TextField("Chiedi a GPT sul progetto…", text: $chat.draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...8)
                    .focused($focused)
                    .onSubmit { model.sendChat() }
                    .disabled(chat.isBusy)
                    .padding(.vertical, 6)
                Button {
                    model.sendChat()
                } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.title2)
                }
                .buttonStyle(.borderless)
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!model.canSendChat)
                .help(model.engine == nil || model.engineState == .missing ? "Senza motore di anonimizzazione la chat non parte" : "Anonimizza e invia (↩ o ⌘↩)")
            }
            Text("I dati personali partono come segnaposto.")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 12)
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
            Image(systemName: "paperclip").font(.title3)
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .menuIndicator(.hidden)
        .fixedSize()
        .disabled(model.chat.isBusy)
        .help("Allega un documento del progetto, la scheda di un'azienda o un file. GPT può anche cercare da solo fra i documenti del progetto.")
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
