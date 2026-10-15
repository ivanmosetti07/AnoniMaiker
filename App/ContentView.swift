import AnonymizerKit
import SwiftUI

struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        NavigationSplitView {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 220, ideal: 240)
        } detail: {
            VStack(spacing: 0) {
                DataBanner()
                if model.hasProject {
                    detail
                } else {
                    ProjectsView()
                }
            }
            .sheet(isPresented: Bindable(model.updates).isPresented) { UpdateSheet() }
        }
        .inspector(isPresented: $model.showsChat) {
            ChatPanel()
                .inspectorColumnWidth(min: 320, ideal: 400, max: 640)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(model.showsChat ? "Nascondi la chat" : "Chat con GPT", systemImage: "bubble.left.and.text.bubble.right") {
                    model.showsChat.toggle()
                }
                .keyboardShortcut("j")
                .disabled(!model.hasProject)
                .help("Chat con GPT sui documenti del progetto (⌘J)")
            }
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
        case .documents:
            NavigationStack(path: $model.documentsPath) {
                DocumentsView()
                    .navigationDestination(for: CRMRoute.self) { route in destination(route) }
            }
        case .companies:
            NavigationStack(path: $model.companiesPath) {
                CompaniesView()
                    .navigationDestination(for: CRMRoute.self) { route in destination(route) }
            }
        case .people: ContactsView()
        case .deals: DealsView()
        case .activities: ActivitiesView()
        case .dictionary: DictionaryView()
        }
    }

    @ViewBuilder private func destination(_ route: CRMRoute) -> some View {
        switch route {
        case .company(let id): CompanyDetailView(companyID: id)
        case .document(let id): DocumentDetailView(documentID: id)
        }
    }
}

/// La barra laterale: il progetto aperto (e il menu per cambiarlo), le sue sezioni, lo stato e le impostazioni.
struct Sidebar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            Image("Logotipo")
                .resizable()
                .scaledToFit()
                .frame(height: 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 18)
                .padding(.top, 4)
                .padding(.bottom, 10)
                .accessibilityLabel("AnoniMaiker")
            ProjectSwitcher()
                .padding(.horizontal, 10)
                .padding(.bottom, 6)
            if model.hasProject {
                List(selection: Binding<AppSection?>(get: { model.section }, set: { if let value = $0 { model.section = value } })) {
                    Section("Lavora") {
                        row(.anonymize)
                        row(.reveal)
                        row(.documents, count: model.crm.documents.count)
                    }
                    Section("CRM del progetto") {
                        row(.people, count: model.crm.contacts.count)
                        row(.companies, count: model.crm.companies.count)
                        row(.deals, count: model.crm.deals.count { $0.stage.isOpen })
                        row(.activities, count: model.crm.openTasks.count, alert: model.crm.openTasks.contains { $0.isOverdue() })
                    }
                    Section("Archivio") {
                        row(.dictionary, count: model.vault.count)
                    }
                }
            } else {
                List {
                    Text("Apri un progetto o creane uno nuovo: dentro trovi anonimizzatore, riconvertitore, documenti e CRM.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .listRowSeparator(.hidden)
                }
            }
            Divider()
            StatusFooter()
            SettingsLink {
                Label("Impostazioni", systemImage: "gearshape")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 12)
            .padding(.bottom, 12)
            .help("Impostazioni di AnoniMaiker (⌘,)")
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

/// In cima alla barra laterale: il progetto aperto, con il menu per cambiarlo, crearne uno o tornare all'elenco.
struct ProjectSwitcher: View {
    @Environment(AppModel.self) private var model
    @State private var naming: ProjectNaming?

    var body: some View {
        Menu {
            ForEach(model.projects) { project in
                Button {
                    model.selectProject(project.id)
                } label: {
                    if project.id == model.currentProjectID { Label(project.name, systemImage: "checkmark") } else { Text(project.name) }
                }
            }
            if !model.projects.isEmpty { Divider() }
            Button("Nuovo progetto…", systemImage: "plus") { naming = .create }
            if let project = model.currentProject {
                Button("Rinomina «\(project.name)»…", systemImage: "pencil") { naming = .rename(project) }
            }
            Divider()
            Button("Tutti i progetti", systemImage: "square.grid.2x2") { model.showProjects() }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "folder.fill")
                    .foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.currentProject?.name ?? "Nessun progetto aperto")
                        .fontWeight(.semibold)
                        .lineLimit(1)
                    Text(model.hasProject ? "Progetto" : "Scegli o crea un progetto")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(.secondary.opacity(0.10), in: .rect(cornerRadius: 8))
            .contentShape(.rect)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .disabled(!model.isVaultReady)
        .sheet(item: $naming) { ProjectNameSheet(naming: $0) }
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
