import AnonymizerKit
import SwiftUI

/// La finestra degli aggiornamenti: controllo, novità, download, errori.
struct UpdateSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            content
        }
        .padding(24)
        .frame(width: 520)
    }

    @ViewBuilder private var content: some View {
        switch model.updates.phase {
        case .idle, .checking:
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text("Controllo se c'è una nuova versione…")
            }
            buttons { Button("Chiudi") { dismiss() }.keyboardShortcut(.cancelAction) }
        case .upToDate:
            header("AnoniMaiker è aggiornata", detail: "Hai l'ultima versione, la \(AppModel.appVersion).", symbol: "checkmark.seal.fill", color: .green)
            buttons { Button("OK") { dismiss() }.keyboardShortcut(.defaultAction) }
        case .available(let release):
            header("È disponibile AnoniMaiker \(release.version)", detail: "Hai la versione \(AppModel.appVersion). " + sizeText(release),
                   symbol: "arrow.down.circle.fill", color: .accentColor)
            notes(release)
            Text("I tuoi dati restano dove sono: si sostituisce solo l'app, che poi si riapre da sola.")
                .font(.callout)
                .foregroundStyle(.secondary)
            buttons {
                Button("Salta questa versione") { model.skip(release) }
                Spacer()
                Button("Più tardi") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Installa e riavvia") { model.install(release) }.keyboardShortcut(.defaultAction)
            }
        case .downloading(let release, let progress):
            header("Scarico AnoniMaiker \(release.version)…", detail: sizeText(release), symbol: "arrow.down.circle", color: .accentColor)
            ProgressView(value: progress)
            buttons { Button("Annulla") { model.cancelUpdate() }.keyboardShortcut(.cancelAction) }
        case .installing(let release):
            header("Installo AnoniMaiker \(release.version)…", detail: "Controllo la firma, poi l'app si chiude e si riapre aggiornata.",
                   symbol: "gearshape.2", color: .accentColor)
            ProgressView()
        case .failed(let message, let release):
            header("Aggiornamento non riuscito", detail: message, symbol: "exclamationmark.triangle.fill", color: .orange)
            buttons {
                Button("Pagina di download") { model.openReleasePage(release) }
                Spacer()
                Button("Chiudi") { dismiss() }.keyboardShortcut(.cancelAction)
                if let release {
                    Button("Riprova") { model.install(release) }.keyboardShortcut(.defaultAction)
                }
            }
        }
    }

    private func sizeText(_ release: AppRelease) -> String {
        "Download di \(release.dmgSize.formatted(.byteCount(style: .file)))."
    }

    private func header(_ title: String, detail: String, symbol: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 34))
                .foregroundStyle(color)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.title3).fontWeight(.semibold)
                Text(detail).foregroundStyle(.secondary).textSelection(.enabled)
            }
        }
    }

    @ViewBuilder private func notes(_ release: AppRelease) -> some View {
        if !release.notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ScrollView {
                Text(ChatText.markdown(Self.readableNotes(release.notes)))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding(10)
            }
            .frame(maxHeight: 220)
            .background(.background.opacity(0.6), in: .rect(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
        }
    }

    /// Le note della release sono Markdown di GitHub: i titoli («## Novità») diventano grassetto, i trattini puntini.
    static func readableNotes(_ notes: String) -> String {
        notes.components(separatedBy: .newlines).map { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("#") {
                let title = trimmed.drop { $0 == "#" }.trimmingCharacters(in: .whitespaces)
                return title.isEmpty ? "" : "**\(title)**"
            }
            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") { return "• " + trimmed.dropFirst(2) }
            return line
        }.joined(separator: "\n")
    }

    private func buttons<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack { Spacer(minLength: 0); content() }
    }
}

/// Impostazioni › Aggiornamenti.
struct UpdateSettings: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var updates = model.updates
        Form {
            Section {
                LabeledContent("Versione installata", value: AppModel.appVersion)
                Toggle("Controlla automaticamente ogni giorno", isOn: $updates.automatic)
                LabeledContent("Ultimo controllo") {
                    Text(updates.lastCheck.map { Format.dateTime($0) } ?? "mai")
                }
                Button("Controlla adesso") { Task { await model.checkForUpdates(userInitiated: true) } }
                    .disabled(updates.isBusy)
            } footer: {
                Text("Gli aggiornamenti arrivano dalle release del progetto su GitHub. L'app installa solo DMG firmati con la chiave del progetto; i tuoi dati non si toccano.")
                    .foregroundStyle(.secondary)
            }
            Section {
                Link("Pagina del progetto", destination: Updates.projectPage)
                Link("Tutte le versioni e le novità", destination: Updates.releasesPage)
                Link("Segnala un problema", destination: Updates.issuesPage)
            }
        }
        .formStyle(.grouped)
    }
}
