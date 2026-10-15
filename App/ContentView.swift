import AnonymizerKit
import SwiftUI

struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationSplitView {
            List(selection: Binding<AppSection?>(get: { model.section }, set: { if let value = $0 { model.section = value } })) {
                Section("Lavora") {
                    row(.anonymize)
                    row(.reveal)
                    row(.chat)
                }
                Section("CRM") {
                    row(.companies, count: model.crm.companies.count)
                    row(.contacts, count: model.crm.contacts.count)
                    row(.deals, count: model.crm.deals.count { $0.stage.isOpen })
                    row(.activities, count: model.crm.openTasks.count, alert: model.crm.openTasks.contains { $0.isOverdue() })
                }
                Section("Archivio") {
                    row(.dictionary, count: model.vault.count)
                }
            }
            .navigationSplitViewColumnWidth(min: 210, ideal: 230)
            .safeAreaInset(edge: .top) {
                Image("Logotipo")
                    .resizable()
                    .scaledToFit()
                    .frame(height: 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 18)
                    .padding(.top, 4)
                    .padding(.bottom, 6)
                    .accessibilityLabel("AnoniMaiker")
            }
            .safeAreaInset(edge: .bottom) { StatusFooter() }
        } detail: {
            VStack(spacing: 0) {
                DataBanner()
                detail
            }
            .sheet(isPresented: Bindable(model.updates).isPresented) { UpdateSheet() }
        }
        .alert("Attenzione", isPresented: Binding(get: { model.alert != nil }, set: { if !$0 { model.alert = nil } })) {
            Button("OK") {}
        } message: {
            Text(model.alert ?? "")
        }
        .sheet(isPresented: $model.showsGuide) { GuideView() }
        .sheet(item: $model.backupStep) { step in
            switch step {
            case .export: BackupExportSheet()
            case .restore(let url): BackupRestoreSheet(url: url)
            }
        }
    }

    @ViewBuilder private var detail: some View {
        @Bindable var model = model
        switch model.section {
        case .anonymize: WorkspaceView(space: model.anonymizeSpace)
        case .reveal: WorkspaceView(space: model.revealSpace)
        case .chat: ChatView()
        case .companies:
            NavigationStack(path: $model.companiesPath) {
                CompaniesView()
                    .navigationDestination(for: CRMRoute.self) { route in
                        switch route {
                        case .company(let id): CompanyDetailView(companyID: id)
                        case .document(let id): DocumentDetailView(documentID: id)
                        }
                    }
            }
        case .contacts: ContactsView()
        case .deals: DealsView()
        case .activities: ActivitiesView()
        case .dictionary: DictionaryView()
        }
    }

    private func row(_ section: AppSection, count: Int = 0, alert: Bool = false) -> some View {
        Label {
            HStack {
                Text(section.title)
                Spacer()
                if count > 0 {
                    Text("\(count)")
                        .foregroundStyle(alert ? Color.red : Color.secondary)
                        .fontWeight(alert ? .semibold : .regular)
                        .monospacedDigit()
                }
            }
        } icon: {
            Image(systemName: section.symbol)
        }
        .tag(section)
    }
}

/// In fondo alla barra laterale: il motore, la protezione dei dati e l'ultima copia di sicurezza.
struct StatusFooter: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            engineLine
            vaultLine
            backupLine
        }
        .font(.caption)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
    }

    @ViewBuilder private var engineLine: some View {
        switch model.engineState {
        case .loading:
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("Preparo il motore…").foregroundStyle(.secondary)
            }
        case .ready:
            Label("Motore pronto, sul Mac", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.secondary)
                .symbolRenderingMode(.multicolor)
        case .missing:
            Label("Motore assente", systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        case .failed:
            Label("Motore non avviato", systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        }
    }

    @ViewBuilder private var vaultLine: some View {
        switch model.vaultState {
        case .opening:
            Label("Apro i dati…", systemImage: "lock")
                .foregroundStyle(.secondary)
        case .ready(let protection):
            Label(protection == .secureEnclave ? "Dati cifrati · Secure Enclave" : "Dati cifrati", systemImage: "lock.fill")
                .foregroundStyle(.secondary)
        case .failed:
            Label("Dati non aperti", systemImage: "lock.trianglebadge.exclamationmark")
                .foregroundStyle(.red)
        }
    }

    @ViewBuilder private var backupLine: some View {
        let hasData = !model.vault.isEmpty || !model.crm.isEmpty
        Button {
            model.startExport()
        } label: {
            if let last = model.lastBackup {
                Label("Copia: \(Format.date(last))", systemImage: "externaldrive.badge.checkmark")
                    .foregroundStyle(.secondary)
            } else {
                Label("Nessuna copia di sicurezza", systemImage: "externaldrive.badge.exclamationmark")
                    .foregroundStyle(hasData ? Color.orange : Color.secondary)
            }
        }
        .buttonStyle(.plain)
        .disabled(!model.isVaultReady)
        .help("Crea una copia di sicurezza protetta da password")
    }
}
