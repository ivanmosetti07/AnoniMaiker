import AnonymizerKit
import SwiftUI

// MARK: - La guida (onboarding)
//
// Si apre da sola al primo avvio e poi da Aiuto › Guida di AnoniMaiker. Pochi passi: cosa fa l'app, perché è privata,
// la copia di sicurezza (da fare subito), il primo cliente, il primo file, la chat con GPT.

enum GuideAction {
    case backup, addClient, anonymize, chat
}

struct GuideView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var page = 0

    private static let pages = 7

    var body: some View {
        VStack(spacing: 0) {
            Group {
                switch page {
                case 0: welcome
                case 1: privacy
                case 2: backup
                case 3: clients
                case 4: anonymize
                case 5: chat
                default: ready
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.horizontal, 36)
            .padding(.top, 30)
            .id(page)
            .transition(.opacity)

            Divider()
            HStack {
                Button("Salta la guida") { close() }
                    .buttonStyle(.link)
                    .opacity(page == Self.pages - 1 ? 0 : 1)
                Spacer()
                HStack(spacing: 6) {
                    ForEach(0..<Self.pages, id: \.self) { index in
                        Circle()
                            .fill(index == page ? Color.accentColor : Color.secondary.opacity(0.3))
                            .frame(width: 7, height: 7)
                    }
                }
                Spacer()
                if page > 0 {
                    Button("Indietro") { withAnimation { page -= 1 } }
                }
                if page < Self.pages - 1 {
                    Button("Avanti") { withAnimation { page += 1 } }
                        .keyboardShortcut(.defaultAction)
                } else {
                    Button("Inizia") { close() }
                        .keyboardShortcut(.defaultAction)
                }
            }
            .padding(16)
        }
        .frame(width: 640, height: 520)
        .task { if model.chat.codexStatus == nil { await model.refreshCodexStatus() } }
    }

    private func close(then action: GuideAction? = nil) {
        model.finishGuide(then: action)
        dismiss()
    }

    // MARK: Pagine

    private var welcome: some View {
        VStack(spacing: 18) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 88, height: 88)
            Image("Logotipo")
                .resizable()
                .scaledToFit()
                .frame(height: 30)
                .accessibilityLabel("AnoniMaiker")
            Text("Usa l'intelligenza artificiale sui documenti dei tuoi clienti senza darle i dati veri.")
                .font(.title3)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            flow
                .padding(.top, 10)
            MaikerHubSignature()
                .padding(.top, 14)
        }
    }

    /// Dati veri → segnaposto → AI → dati veri.
    private var flow: some View {
        HStack(spacing: 10) {
            step("Mario Rossi\nIBAN IT60…", caption: "Il tuo testo", color: .secondary)
            arrow
            step("[FULLNAME_1]\nIBAN [IBAN_1]", caption: "Cosa vede l'AI", color: .orange)
            arrow
            step("Gentile\nMario Rossi…", caption: "La risposta", color: .green)
        }
    }

    private func step(_ text: String, caption: String, color: Color) -> some View {
        VStack(spacing: 6) {
            Text(text)
                .font(.callout.monospaced())
                .multilineTextAlignment(.center)
                .frame(width: 150, height: 58)
                .background(color.opacity(0.12), in: .rect(cornerRadius: 8))
            Text(caption).font(.caption).foregroundStyle(.secondary)
        }
    }

    private var arrow: some View {
        Image(systemName: "arrow.right").foregroundStyle(.tertiary).padding(.bottom, 20)
    }

    private var privacy: some View {
        page(title: "Tutto resta sul tuo Mac", symbol: "lock.shield") {
            point("cpu", "Il motore di anonimizzazione è dentro l'app", "Riconosce nomi, aziende, codici fiscali, IBAN, email, telefoni, indirizzi, documenti e targhe senza mandare niente in rete.")
            point("character.book.closed", "Un dizionario cifrato", "Ogni dato ha sempre lo stesso segnaposto, così qualsiasi file anonimizzato si riconverte. Il dizionario è cifrato con una chiave protetta dalla Secure Enclave del Mac.")
            point("eye.slash", "Tu decidi cosa nascondere", "Di serie: dati personali e aziende. Importi, date e città restano in chiaro perché servono all'AI. Si cambia in Impostazioni › Cosa nascondere.")
        }
    }

    private var backup: some View {
        page(title: "Prima di tutto: la copia di sicurezza", symbol: "externaldrive.badge.checkmark") {
            point("exclamationmark.triangle", "Senza copia, su un Mac nuovo i dati non si riaprono", "La chiave dei dati è legata a questo Mac. Se lo cambi, lo resetti o si rompe, dizionario, clienti e chat si recuperano solo da una copia di sicurezza.")
            point("key", "Protetta da una password che scegli tu", "Almeno 10 caratteri. Conservala bene: senza password la copia non si apre, nemmeno per noi.")
            point("clock.arrow.circlepath", "Rifalla ogni tanto", "Da File › Crea copia di sicurezza… (⇧⌘B). In basso a sinistra vedi la data dell'ultima.")
            Button("Crea la copia di sicurezza") { close(then: .backup) }
                .controlSize(.large)
                .disabled(!model.isVaultReady)
                .padding(.top, 4)
        }
    }

    private var clients: some View {
        page(title: "I tuoi clienti nel CRM", symbol: "building.2") {
            point("building.2", "Aziende e contatti", "Inserisci ragione sociale, partita IVA e referenti: l'app li nasconde anche dove il motore non li riconoscerebbe.")
            point("doc.on.doc", "Documenti del cliente", "Archivia contratti, preventivi ed Excel: per ognuno tieni l'originale, la versione anonimizzata e le risposte dell'AI.")
            point("eurosign.circle", "Trattative, note e attività", "Con fase, importo, scadenze. La scheda del cliente si può dare all'AI già anonimizzata.")
            Button("Aggiungi il primo cliente") { close(then: .addClient) }
                .controlSize(.large)
                .padding(.top, 4)
        }
    }

    private var anonymize: some View {
        page(title: "Anonimizzare e riconvertire", symbol: "arrow.left.arrow.right") {
            point("1.circle", "Anonimizza", "Incolla un testo o trascina un file (Testo, Markdown, CSV, Excel, Word, PDF) nel banco «Anonimizza». Scegli il cliente, se c'è.")
            point("2.circle", "Usa l'AI che preferisci", "Copia o salva il risultato con i segnaposto e dallo a ChatGPT, Claude o altri. Formattazione e celle restano come nell'originale.")
            point("3.circle", "Riconverti", "Incolla la risposta (o il file che ti restituisce) nel banco «Riconverti»: i segnaposto tornano i dati veri.")
            Button("Prova adesso") { close(then: .anonymize) }
                .controlSize(.large)
                .padding(.top, 4)
        }
    }

    private var chat: some View {
        page(title: "Chat con GPT (facoltativa)", symbol: "bubble.left.and.text.bubble.right") {
            point("person.badge.key", "Con il tuo abbonamento ChatGPT", "La chat usa Codex, la riga di comando di OpenAI: niente chiavi da inserire nell'app. Domanda e allegati partono già anonimizzati, la risposta torna con i dati veri.")
            VStack(alignment: .leading, spacing: 8) {
                codexStatus
                command("npm install -g @openai/codex", note: "installa Codex (serve Node.js: nodejs.org)")
                command("codex login", note: "accedi con il tuo account ChatGPT")
            }
            .padding(.leading, 40)
            Button("Apri la chat") { close(then: .chat) }
                .controlSize(.large)
                .padding(.top, 4)
        }
    }

    @ViewBuilder private var codexStatus: some View {
        HStack {
            switch model.chat.codexStatus {
            case nil:
                ProgressView().controlSize(.small)
                Text("Controllo Codex…")
            case .ready:
                Label("Codex è pronto: puoi già usare la chat", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
            case .notLoggedIn:
                Label("Codex è installato ma manca l'accesso", systemImage: "person.crop.circle.badge.exclamationmark").foregroundStyle(.orange)
            case .notInstalled:
                Label("Codex non è installato", systemImage: "xmark.circle").foregroundStyle(.orange)
            }
            Button("Controlla di nuovo") { Task { await model.refreshCodexStatus() } }
                .buttonStyle(.link)
        }
        .font(.callout)
    }

    private func command(_ text: String, note: String) -> some View {
        HStack(spacing: 8) {
            Text(text)
                .font(.callout.monospaced())
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.secondary.opacity(0.12), in: .rect(cornerRadius: 5))
                .textSelection(.enabled)
            Button("Copia", systemImage: "doc.on.doc") { model.copy(text) }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .help("Copia il comando, poi incollalo nel Terminale")
            Text(note).font(.caption).foregroundStyle(.secondary)
        }
    }

    private var ready: some View {
        page(title: "Sei pronto", symbol: "checkmark.seal") {
            point("questionmark.circle", "Questa guida resta a portata di mano", "La riapri da Aiuto › Guida di AnoniMaiker.")
            point("arrow.down.circle", "Aggiornamenti automatici", "Quando esce una nuova versione l'app te lo dice e la installa con un clic. Si regola in Impostazioni › Aggiornamenti.")
            point("hand.raised", "Un controllo finale è sempre tuo", "Il motore è molto accurato ma non infallibile: prima di mandare un testo importante dai un'occhiata ai segnaposto evidenziati.")
            point("ladybug", "Idee o problemi?", "Scrivili su GitHub: Aiuto › Segnala un problema.")
        }
    }

    // MARK: Pezzi

    private func page<Content: View>(title: String, symbol: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(title, systemImage: symbol)
                .font(.title2)
                .fontWeight(.semibold)
                .labelStyle(.titleAndIcon)
            content()
        }
    }

    private func point(_ symbol: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(Color.accentColor)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).fontWeight(.semibold)
                Text(text).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

extension AppModel {
    static let guideSeenKey = "guida.vista"

    /// Al primo avvio la guida si apre da sola.
    func showGuideIfNeeded() {
        if !UserDefaults.standard.bool(forKey: Self.guideSeenKey) { showsGuide = true }
    }

    func finishGuide(then action: GuideAction?) {
        UserDefaults.standard.set(true, forKey: Self.guideSeenKey)
        showsGuide = false
        guard let action else { return }
        switch action {
        case .backup:
            // Dopo la chiusura della guida: due finestre insieme non si possono aprire.
            Task {
                try? await Task.sleep(for: .milliseconds(400))
                startExport()
            }
        case .addClient:
            section = .companies
            companiesPath = []
            requestsNewCompany = true
        case .anonymize:
            section = .anonymize
        case .chat:
            section = .chat
        }
    }
}

/// «Un prodotto MaikerHub», con il logo del marchio.
struct MaikerHubSignature: View {
    var height: CGFloat = 9

    var body: some View {
        HStack(spacing: 6) {
            Text("Un prodotto")
                .font(.caption)
                .foregroundStyle(.secondary)
            Image("MaikerHub")
                .resizable()
                .scaledToFit()
                .frame(height: height)
                .accessibilityLabel("MaikerHub")
        }
    }
}
