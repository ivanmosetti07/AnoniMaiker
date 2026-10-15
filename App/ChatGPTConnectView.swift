import AnonymizerKit
import SwiftUI

/// Il proprio account ChatGPT: collegato o no, e il pulsante per collegarlo (o scollegarlo) senza usare il Terminale.
struct ChatGPTConnectView: View {
    @Environment(AppModel.self) private var model
    @State private var confirmsDisconnect = false
    /// Nella chat: solo quando manca il collegamento, in una riga.
    var compact = false

    var body: some View {
        let chat = model.chat
        VStack(alignment: .leading, spacing: 8) {
            if let connection = chat.connection {
                progress(connection)
            } else {
                switch chat.codexStatus {
                case nil:
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.small)
                        Text("Controllo il collegamento a ChatGPT…").foregroundStyle(.secondary)
                    }
                case .ready:
                    HStack {
                        Label("Collegato al tuo account ChatGPT", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Spacer()
                        if !compact {
                            Button("Scollega…") { confirmsDisconnect = true }
                        }
                    }
                case .notInstalled, .notLoggedIn:
                    connect
                }
            }
            if let error = chat.connectionError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .task { if model.chat.codexStatus == nil { await model.refreshCodexStatus() } }
        .confirmationDialog("Scollegare il tuo account ChatGPT?", isPresented: $confirmsDisconnect) {
            Button("Scollega", role: .destructive) { Task { await model.disconnectChatGPT() } }
        } message: {
            Text("La chat non potrà più usare GPT finché non colleghi di nuovo un account. Conversazioni e dati restano sul Mac.")
        }
    }

    private var connect: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(compact ? "Collega il tuo account ChatGPT per usare la chat" : "Nessun account ChatGPT collegato")
                    .fontWeight(.semibold)
                Text("Serve un tuo abbonamento ChatGPT. L'accesso si fa sul sito di OpenAI: l'app non vede la tua password.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button("Collega il tuo account ChatGPT") { model.connectChatGPT() }
                .buttonStyle(.borderedProminent)
                .disabled(!model.isVaultReady)
        }
    }

    @ViewBuilder private func progress(_ connection: ChatGPTConnection) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            ProgressView().controlSize(.small)
            VStack(alignment: .leading, spacing: 4) {
                switch connection {
                case .installing:
                    Text("Preparo il collegamento a ChatGPT (una volta sola, circa un minuto)…")
                case .waitingForBrowser(let url):
                    Text("Si è aperto il browser: accedi con il tuo account ChatGPT e conferma.")
                    if let url {
                        Link("Il browser non si è aperto? Apri la pagina di accesso", destination: url)
                            .font(.callout)
                    }
                }
            }
            Spacer()
            Button("Annulla") { model.cancelChatGPTConnection() }
        }
    }
}
