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

    private var strength: (score: Int, label: String) { Backup.strength(of: password) }
    private var mismatch: Bool { !confirmation.isEmpty && confirmation != password }
    private var canCreate: Bool { password.count >= Backup.minimumPasswordLength && password == confirmation && !working }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Crea una copia di sicurezza", systemImage: "externaldrive.badge.checkmark")
                .font(.title2.weight(.semibold))
            Text("Dentro ci sono il dizionario, il CRM e i documenti (\(BackupSummary(vault: model.vault, crm: model.crm, appVersion: "").description)), cifrati con la password che scegli adesso. Con la copia e la password riavrai tutto anche su un altro Mac.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Form {
                SecureField("Password", text: $password)
                SecureField("Ripeti la password", text: $confirmation)
                HStack {
                    ProgressView(value: Double(strength.score), total: 3)
                        .tint(strength.score == 0 ? .red : strength.score == 1 ? .orange : .green)
                    Text(password.isEmpty ? "Almeno \(Backup.minimumPasswordLength) caratteri" : strength.label)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 150, alignment: .leading)
                }
                if mismatch {
                    Text("Le due password non coincidono.").foregroundStyle(.orange).font(.caption)
                }
            }
            .formStyle(.grouped)
            .frame(height: 170)
            Label("Se perdi la password la copia non si apre più, e nessuno la può recuperare. Salvala, per esempio, nell'app Password.",
                  systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
            if let error {
                Text(error).foregroundStyle(.red).font(.callout)
            }
            HStack {
                if working { ProgressView().controlSize(.small); Text("Cifro la copia…").foregroundStyle(.secondary) }
                Spacer()
                Button("Annulla") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Crea e salva…") { Task { await create() } }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canCreate)
            }
        }
        .padding(24)
        .frame(width: 540)
    }

    private func create() async {
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

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Ripristina una copia di sicurezza", systemImage: "externaldrive.badge.timemachine")
                .font(.title2.weight(.semibold))
            Text(url.lastPathComponent).foregroundStyle(.secondary)
            if restored {
                finished
            } else if let contents {
                confirm(contents)
            } else {
                passwordStep
            }
            if let error {
                Text(error).foregroundStyle(.red).font(.callout)
            }
        }
        .padding(24)
        .frame(width: 540)
    }

    private var passwordStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Scrivi la password con cui hai creato la copia. Finché non confermi, i dati di questo Mac non cambiano.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            SecureField("Password della copia", text: $password)
                .textFieldStyle(.roundedBorder)
                .onSubmit { Task { await open() } }
            HStack {
                if working { ProgressView().controlSize(.small); Text("Apro la copia…").foregroundStyle(.secondary) }
                Spacer()
                Button("Annulla") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Apri la copia") { Task { await open() } }
                    .keyboardShortcut(.defaultAction)
                    .disabled(password.isEmpty || working)
            }
        }
    }

    private func confirm(_ contents: Backup.Contents) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            GroupBox {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Copia del \(Format.dateTime(contents.summary.created))").fontWeight(.medium)
                    Text(contents.summary.description).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(4)
            }
            let current = BackupSummary(vault: model.vault, crm: model.crm, appVersion: "")
            Label("I dati di questo Mac (\(model.isVaultReady ? current.description : "non apribili")) verranno sostituiti. Non si cancellano: finiscono in una cartella «Sostituiti il …» accanto al dizionario.",
                  systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                if working { ProgressView().controlSize(.small); Text("Ripristino…").foregroundStyle(.secondary) }
                Spacer()
                Button("Annulla") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Sostituisci i dati di questo Mac", role: .destructive) { Task { await restore(contents) } }
                    .disabled(working)
            }
        }
    }

    private var finished: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Ripristino completato: dizionario, CRM e documenti sono quelli della copia.", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
            if let aside {
                Text("I dati di prima sono in «\(aside.lastPathComponent)».").foregroundStyle(.secondary)
            }
            HStack {
                if let aside {
                    Button("Mostra nel Finder") { NSWorkspace.shared.activateFileViewerSelecting([aside]) }
                }
                Spacer()
                Button("Chiudi") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
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

/// Le Impostazioni › Copia di sicurezza.
struct BackupSettings: View {
    @Environment(AppModel.self) private var model
    @State private var step: AppModel.BackupStep?

    var body: some View {
        Form {
            Section {
                LabeledContent("Ultima copia", value: model.lastBackup.map(Format.dateTime) ?? "Mai fatta")
                LabeledContent("Contenuto", value: BackupSummary(vault: model.vault, crm: model.crm, appVersion: "").description)
            } footer: {
                Text("Il dizionario è legato alla Secure Enclave di questo Mac: su un Mac nuovo i dati si riaprono solo da una copia di sicurezza. Fanne una dopo ogni giornata di lavoro importante.")
                    .foregroundStyle(.secondary)
            }
            Section {
                HStack {
                    Button("Crea copia di sicurezza…") { step = .export }
                        .disabled(!model.isVaultReady)
                    Button("Ripristina da una copia…") {
                        let panel = NSOpenPanel()
                        panel.allowedContentTypes = [AppModel.backupType]
                        panel.message = "Scegli una copia di sicurezza di AnoniMaiker"
                        if panel.runModal() == .OK, let url = panel.url { step = .restore(url) }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .sheet(item: $step) { step in
            switch step {
            case .export: BackupExportSheet()
            case .restore(let url): BackupRestoreSheet(url: url)
            }
        }
    }
}
