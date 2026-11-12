import AnonymizerKit
import SwiftUI

// MARK: - Copia di sicurezza: creare e ripristinare

/// Crea una copia di tutto, protetta da una password.
struct BackupExportSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var confirmation = ""
    @State private var working = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var strength: (score: Int, label: String) { Backup.strength(of: password) }
    private var mismatch: Bool { !confirmation.isEmpty && confirmation != password }
    private var canCreate: Bool { password.count >= Backup.minimumPasswordLength && password == confirmation && !working }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                SheetTitle(title: "Crea una copia di sicurezza", symbol: "externaldrive")
                Text("Dentro ci sono tutti i progetti, con documenti, CRM, dizionari e conversazioni (\(model.totals?.description ?? "…")), cifrati con la password che scegli adesso. Con la copia e la password riavrai tutto anche su un altro Mac.")
                    .foregroundStyle(Tema.secondary)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                FormSection {
                    FormRow {
                        Text("Password").frame(width: 150, alignment: .leading)
                        SecureField("", text: $password).styledField().focused($focused).onSubmit { Task { await create() } }
                    }
                    FormRow {
                        Text("Ripeti la password").frame(width: 150, alignment: .leading)
                        SecureField("", text: $confirmation).styledField().onSubmit { Task { await create() } }
                    }
                    FormRow {
                        ThinProgressBar(value: Double(strength.score) / 3, width: 300,
                                        tint: strength.score == 0 ? Tema.red : strength.score == 1 ? Tema.orange : Tema.green)
                        Spacer(minLength: 0)
                        Text(password.isEmpty ? "Almeno \(Backup.minimumPasswordLength) caratteri" : strength.label)
                            .font(Tema.caption)
                            .foregroundStyle(Tema.secondary)
                            .frame(width: 150, alignment: .leading)
                    }
                    if mismatch {
                        FormRow {
                            Text("Le due password non coincidono.").foregroundStyle(Tema.orange).font(Tema.caption)
                        }
                    }
                }
                .padding(.bottom, -4)
                WarningLine(text: "Se perdi la password la copia non si apre più, e nessuno la può recuperare. Salvala, per esempio, nell'app Password.")
                if let error {
                    Text(error).foregroundStyle(Tema.red).font(Tema.callout).textSelection(.enabled)
                }
            }
            .font(Tema.body)
            .padding(20)
            SheetActions {
                if working { BusyLine(text: "Cifro la copia…") }
            } trailing: {
                Button("Annulla") { dismiss() }
                    .buttonStyle(.flat)
                    .keyboardShortcut(.cancelAction)
                    .disabled(working)
                Button("Crea e salva…") { Task { await create() } }
                    .buttonStyle(.primary)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canCreate)
            }
        }
        .frame(width: 540)
        .background(Tema.surface)
        .onAppear { focused = true }
    }

    private func create() async {
        guard canCreate else { return }
        working = true
        defer { working = false }
        do {
            if try await model.exportBackup(password: password) { dismiss() }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Apre una copia con la password e, a richiesta, sostituisce i dati di questo Mac.
struct BackupRestoreSheet: View {
    let url: URL
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var contents: Backup.Contents?
    @State private var working = false
    @State private var error: String?
    @State private var restored = false
    @State private var aside: URL?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                SheetTitle(title: "Ripristina una copia di sicurezza", symbol: "archivebox")
                Text(url.lastPathComponent).foregroundStyle(Tema.secondary).textSelection(.enabled)
                if restored {
                    Label("Ripristino completato: dizionario, CRM e documenti sono quelli della copia.", systemImage: "checkmark.circle")
                        .foregroundStyle(Tema.green)
                        .fixedSize(horizontal: false, vertical: true)
                    if let aside {
                        Text("I dati di prima sono in «\(aside.lastPathComponent)».").foregroundStyle(Tema.secondary)
                    }
                } else if let contents {
                    Card {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Copia del \(Format.dateTime(contents.summary.created))").fontWeight(.medium)
                            Text(contents.summary.description).foregroundStyle(Tema.secondary)
                        }
                    }
                    WarningLine(text: "I dati di questo Mac (\(model.isVaultReady ? (model.totals?.description ?? "…") : "non apribili")) verranno sostituiti. Non si cancellano: finiscono in una cartella «Sostituiti il …» accanto al dizionario.")
                } else {
                    Text("Scrivi la password con cui hai creato la copia. Finché non confermi, i dati di questo Mac non cambiano.")
                        .foregroundStyle(Tema.secondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                    SecureField("Password della copia", text: $password)
                        .styledField()
                        .focused($focused)
                        .onSubmit { Task { await open() } }
                }
                if let error {
                    Text(error).foregroundStyle(Tema.red).font(Tema.callout).textSelection(.enabled)
                }
            }
            .font(Tema.body)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            SheetActions { leadingActions } trailing: { trailingActions }
        }
        .frame(width: 540)
        .background(Tema.surface)
        .onAppear { focused = true }
    }

    @ViewBuilder private var leadingActions: some View {
        if restored {
            if let aside {
                Button("Mostra nel Finder") { NSWorkspace.shared.activateFileViewerSelecting([aside]) }.buttonStyle(.flat)
            }
        } else if working {
            BusyLine(text: contents == nil ? "Apro la copia…" : "Ripristino…")
        }
    }

    @ViewBuilder private var trailingActions: some View {
        if restored {
            Button("Chiudi") { dismiss() }
                .buttonStyle(.primary)
                .keyboardShortcut(.defaultAction)
        } else if let contents {
            Button("Annulla") { dismiss() }
                .buttonStyle(.flat)
                .keyboardShortcut(.cancelAction)
                .disabled(working)
            Button("Sostituisci i dati di questo Mac") { Task { await restore(contents) } }
                .buttonStyle(.flatDestructive)
                .disabled(working)
        } else {
            Button("Annulla") { dismiss() }
                .buttonStyle(.flat)
                .keyboardShortcut(.cancelAction)
                .disabled(working)
            Button("Apri la copia") { Task { await open() } }
                .buttonStyle(.primary)
                .keyboardShortcut(.defaultAction)
                .disabled(password.isEmpty || working)
        }
    }

    private func open() async {
        guard !password.isEmpty, !working else { return }
        working = true
        defer { working = false }
        do {
            contents = try await model.openBackup(at: url, password: password)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func restore(_ contents: Backup.Contents) async {
        working = true
        defer { working = false }
        do {
            aside = try await model.restore(contents)
            restored = true
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Un avviso arancione con il triangolo, nel testo di un foglio.
private struct WarningLine: View {
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "exclamationmark.triangle")
            Text(text).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
        }
        .font(Tema.callout)
        .foregroundStyle(Tema.orange)
    }
}

/// «Cifro la copia…» con la rotellina, a sinistra nella riga dei pulsanti.
private struct BusyLine: View {
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(text).foregroundStyle(Tema.secondary)
        }
        .font(Tema.body)
    }
}

/// Le Impostazioni › Copia di sicurezza.
struct BackupSettings: View {
    @Environment(AppModel.self) private var model
    @State private var step: AppModel.BackupStep?

    var body: some View {
        FormSection(footer: "Il dizionario è legato alla Secure Enclave di questo Mac: su un Mac nuovo i dati si riaprono solo da una copia di sicurezza. Fanne una dopo ogni giornata di lavoro importante.") {
            LabeledRow(label: "Ultima copia", value: model.lastBackup.map(Format.dateTime) ?? "Mai fatta")
            LabeledRow(label: "Contenuto", value: model.totals?.description ?? "…")
        }
        .task { _ = await model.allProjectsSummary() }
        FormSection {
            FormRow {
                Button("Crea copia di sicurezza…") { step = .export }
                    .buttonStyle(.flat)
                    .disabled(!model.isVaultReady)
                Button("Ripristina da una copia…") {
                    let panel = NSOpenPanel()
                    panel.allowedContentTypes = [AppModel.backupType]
                    panel.message = "Scegli una copia di sicurezza di AnoniMaiker"
                    if panel.runModal() == .OK, let url = panel.url { step = .restore(url) }
                }
                .buttonStyle(.flat)
            }
        }
        // Sopra le impostazioni: un foglio sul foglio.
        .sheet(item: $step) { step in
            switch step {
            case .export: BackupExportSheet()
            case .restore(let url): BackupRestoreSheet(url: url)
            }
        }
    }
}
