import AnonymizerKit
import SwiftUI

/// La finestra degli aggiornamenti: controllo, novità, download, errori.
struct UpdateSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 16) { content }
                .font(Tema.body)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            if hasActions {
                SheetActions { leadingActions } trailing: { trailingActions }
            }
        }
        .frame(width: 520)
        .background(Tema.surface)
    }

    private var hasActions: Bool {
        if case .installing = model.updates.phase { return false }
        return true
    }

    @ViewBuilder private var content: some View {
        switch model.updates.phase {
        case .idle, .checking:
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text("Controllo se c'è una nuova versione…")
            }
        case .upToDate:
            header("AnoniMaiker è aggiornata", detail: "Hai l'ultima versione, la \(AppModel.appVersion).", symbol: "checkmark.seal", color: Tema.green)
        case .available(let release):
            header("È disponibile AnoniMaiker \(release.version)", detail: "Hai la versione \(AppModel.appVersion). " + sizeText(release),
                   symbol: "arrow.down.circle", color: Tema.accent)
            notes(release)
            Text("I tuoi dati restano dove sono: si sostituisce solo l'app, che poi si riapre da sola.")
                .font(Tema.callout)
                .foregroundStyle(Tema.secondary)
        case .downloading(let release, let progress):
            header("Scarico AnoniMaiker \(release.version)…", detail: sizeText(release), symbol: "arrow.down.circle", color: Tema.accent)
            ThinProgressBar(value: progress, width: 480)
        case .installing(let release, let step):
            header("Installo AnoniMaiker \(release.version)…", detail: step, symbol: "gearshape.2", color: Tema.accent)
            ProgressView().controlSize(.small)
        case .failed(let message, _):
            header("Aggiornamento non riuscito", detail: message, symbol: "exclamationmark.triangle", color: Tema.orange)
        }
    }

    @ViewBuilder private var leadingActions: some View {
        switch model.updates.phase {
        case .available(let release):
            Button("Salta questa versione") { model.skip(release) }.buttonStyle(.flat)
        case .failed(_, let release):
            Button("Pagina di download") { model.openReleasePage(release) }.buttonStyle(.flat)
        default:
            EmptyView()
        }
    }

    @ViewBuilder private var trailingActions: some View {
        switch model.updates.phase {
        case .idle, .checking:
            Button("Chiudi") { dismiss() }.buttonStyle(.flat).keyboardShortcut(.cancelAction)
        case .upToDate:
            Button("OK") { dismiss() }.buttonStyle(.primary).keyboardShortcut(.defaultAction)
        case .available(let release):
            Button("Più tardi") { dismiss() }.buttonStyle(.flat).keyboardShortcut(.cancelAction)
            Button("Installa e riavvia") { model.install(release) }.buttonStyle(.primary).keyboardShortcut(.defaultAction)
        case .downloading:
            Button("Annulla") { model.cancelUpdate() }.buttonStyle(.flat).keyboardShortcut(.cancelAction)
        case .installing:
            EmptyView()
        case .failed(_, let release):
            Button("Chiudi") { dismiss() }.buttonStyle(.flat).keyboardShortcut(.cancelAction)
            if let release {
                Button("Riprova") { model.install(release) }.buttonStyle(.primary).keyboardShortcut(.defaultAction)
            }
        }
    }

    private func sizeText(_ release: AppRelease) -> String {
        "Download di \(release.dmgSize.formatted(.byteCount(style: .file)))."
    }

    private func header(_ title: String, detail: String, symbol: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(color)
                .frame(width: 34)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(Tema.title2)
                Text(detail).foregroundStyle(Tema.secondary).lineSpacing(3).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder private func notes(_ release: AppRelease) -> some View {
        if !release.notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ScrollView {
                Text(ChatText.markdown(Self.readableNotes(release.notes)))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .lineSpacing(3)
                    .padding(10)
            }
            .frame(maxHeight: 220)
            .background(Tema.bg, in: .rect(cornerRadius: Tema.radius))
            .overlay(RoundedRectangle(cornerRadius: Tema.radius).strokeBorder(Tema.border))
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
}

/// Impostazioni › Aggiornamenti.
struct UpdateSettings: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var updates = model.updates
        FormSection(footer: "Gli aggiornamenti arrivano dalle release del progetto su GitHub. L'app installa solo DMG firmati con la chiave del progetto; i tuoi dati non si toccano.") {
            LabeledRow(label: "Versione installata", value: AppModel.appVersion)
            FormRow {
                Toggle("Controlla automaticamente ogni giorno", isOn: $updates.automatic).toggleStyle(.accentCheckbox)
            }
            LabeledRow(label: "Ultimo controllo", value: updates.lastCheck.map { Format.dateTime($0) } ?? "mai")
            FormRow {
                Button("Controlla adesso") { Task { await model.checkForUpdates(userInitiated: true) } }
                    .buttonStyle(.flat)
                    .disabled(updates.isBusy)
            }
        }
        FormSection {
            FormRow { link("Pagina del progetto", Updates.projectPage) }
            FormRow { link("Tutte le versioni e le novità", Updates.releasesPage) }
            FormRow { link("Segnala un problema", Updates.issuesPage) }
        }
    }

    private func link(_ title: String, _ url: URL) -> some View {
        Button(title) { NSWorkspace.shared.open(url) }.buttonStyle(.accentLink)
    }
}
