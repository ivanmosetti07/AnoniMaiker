import AnonymizerKit
import AppKit
import SwiftUI

struct ContentView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSheets.self) private var sheets
    @AppStorage("chat.larghezza") private var chatWidth = 380.0

    var body: some View {
        @Bindable var model = model
        @Bindable var sheets = sheets
        // La chat è una colonna fatta a mano accanto a tutto il resto, non un `.inspector`: accanto ad alcune
        // schermate la colonna di AppKit entrava in un ciclo di layout che chiudeva l'app. Le larghezze sono date a
        // mano: la barra laterale e la chat hanno la loro e il contenuto prende quello che avanza.
        GeometryReader { proxy in
            let chat = chatSpace
            HStack(spacing: 0) {
                Sidebar()
                    .frame(width: Sidebar.width)
                Rectangle().fill(Tema.border).frame(width: 1)
                VStack(spacing: 0) {
                    DataBanner()
                    ZStack(alignment: .topTrailing) {
                        Group {
                            if model.hasProject {
                                detail
                            } else {
                                ProjectsView()
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        if model.hasProject { chatToggle }
                    }
                }
                .frame(width: max(proxy.size.width - chat - Sidebar.width - 1, 0))
                .background(Tema.bg)
                if chat > 0 {
                    ChatColumn(width: $chatWidth)
                        .frame(width: chat)
                        .transition(.move(edge: .trailing))
                }
            }
        }
        .ignoresSafeArea()
        .background(Tema.bg)
        // Le azioni stanno nelle barre delle viste: la barra della finestra non serve.
        .toolbar(.hidden, for: .windowToolbar)
        // Con la chat aperta la finestra si allarga: il contenuto non scende mai sotto il suo minimo.
        .frame(minWidth: 880 + chatSpace)
        .animation(.easeOut(duration: 0.2), value: model.showsChat)
        .alert("Attenzione", isPresented: Binding(get: { model.alert != nil }, set: { if !$0 { model.alert = nil } })) {
            Button("OK") {}
        } message: {
            Text(model.alert ?? "")
        }
        .sheet(isPresented: $model.showsGuide) { GuideView() }
        // Ogni foglio su una vista sua: troppi `.sheet` sulla stessa vista non si aprono tutti.
        .background { Color.clear.sheet(isPresented: Bindable(model.updates).isPresented) { UpdateSheet() } }
        .background { Color.clear.sheet(isPresented: $sheets.showsSettings) { SettingsView() } }
        .background { Color.clear.sheet(isPresented: $sheets.showsAbout) { AboutSheet() } }
        .sheet(item: $model.backupStep) { step in
            switch step {
            case .export: BackupExportSheet()
            case .restore(let url): BackupRestoreSheet(url: url)
            }
        }
    }

    /// Lo spazio della chat a destra (0 se è chiusa).
    private var chatSpace: Double { model.showsChat && model.hasProject ? ChatColumn.clamped(chatWidth) + 1 : 0 }

    /// Il pulsante della chat, sopra l'angolo in alto a destra di ogni vista (le barre gli lasciano lo spazio).
    private var chatToggle: some View {
        Button {
            model.showsChat.toggle()
        } label: {
            BarIcon(title: model.showsChat ? "Nascondi la chat" : "Chat con GPT", symbol: "bubble.left.and.text.bubble.right")
        }
        .buttonStyle(.plainIcon(on: model.showsChat))
        .keyboardShortcut("j")
        .help("\(model.showsChat ? "Nascondi la chat" : "Chat con GPT") · Chat con GPT sui documenti del progetto (⌘J)")
        .padding(.top, 10)
        .padding(.trailing, 12)
    }

    @ViewBuilder private var detail: some View {
        @Bindable var model = model
        switch model.section {
        case .anonymize: WorkspaceView(space: model.anonymizeSpace).id("anonymize")
        case .reveal: WorkspaceView(space: model.revealSpace).id("reveal")
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

/// Il banner quando i dati cifrati non si aprono (per esempio su un Mac nuovo).
struct DataBanner: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if case .failed(let reason) = model.vaultState {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.shield").foregroundStyle(Tema.red)
                Text(reason).foregroundStyle(Tema.text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Button("Ripristina una copia…") { model.startRestore() }
                    .buttonStyle(.flat)
            }
            .font(Tema.callout)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Tema.red.opacity(0.1))
        }
    }
}

/// La barra laterale: il progetto aperto (e il menu per cambiarlo), le sue sezioni, lo stato e le impostazioni.
struct Sidebar: View {
    @Environment(AppModel.self) private var model
    @Environment(AppSheets.self) private var sheets

    static let width: CGFloat = 240

    var body: some View {
        VStack(spacing: 0) {
            Image("Logotipo")
                .resizable()
                .scaledToFit()
                .frame(height: 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 18)
                // Sopra restano i pulsanti della finestra (chiudi, riduci, ingrandisci).
                .padding(.top, 40)
                .padding(.bottom, 10)
                .accessibilityLabel("AnoniMaiker")
            ProjectSwitcher()
                .padding(.horizontal, 10)
                .padding(.bottom, 6)
            ScrollView {
                VStack(spacing: 0) {
                    if model.hasProject {
                        SidebarSectionHeader(title: "Lavora")
                        row(.anonymize)
                        row(.reveal)
                        row(.documents, count: model.crm.documents.count)
                        SidebarSectionHeader(title: "CRM del progetto")
                        row(.people, count: model.crm.contacts.count)
                        row(.companies, count: model.crm.companies.count)
                        row(.deals, count: model.crm.deals.count { $0.stage.isOpen })
                        row(.activities, count: model.crm.openTasks.count, alert: model.crm.openTasks.contains { $0.isOverdue() })
                        SidebarSectionHeader(title: "Archivio")
                        row(.dictionary, count: model.vault.count)
                    } else {
                        Text("Apri un progetto o creane uno nuovo: dentro trovi anonimizzatore, riconvertitore, documenti e CRM.")
                            .font(Tema.callout)
                            .foregroundStyle(Tema.secondary)
                            .lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 6)
                    }
                }
                .padding(.bottom, 6)
            }
            .scrollIndicators(.never)
            Rectangle().fill(Tema.border).frame(height: 1)
            StatusFooter()
            Button {
                sheets.showsSettings = true
            } label: {
                Label("Impostazioni", systemImage: "gearshape")
                    .padding(.horizontal, 5)
            }
            .buttonStyle(.plainIcon)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .padding(.bottom, 10)
            .help("Impostazioni di AnoniMaiker (⌘,)")
        }
        .background(Tema.sidebar)
    }

    private func row(_ section: AppSection, count: Int = 0, alert: Bool = false) -> some View {
        SidebarRow(title: section.title, symbol: section.symbol, isSelected: model.section == section) {
            model.section = section
        } trailing: {
            if count > 0 {
                Text("\(count)")
                    .font(.system(size: 12, weight: alert ? .semibold : .regular))
                    .monospacedDigit()
                    .foregroundStyle(alert ? Tema.red : Tema.secondary)
            }
        }
    }
}

/// In cima alla barra laterale: il progetto aperto, con il menu per cambiarlo, crearne uno o tornare all'elenco.
struct ProjectSwitcher: View {
    @Environment(AppModel.self) private var model
    @State private var naming: ProjectNaming?
    @State private var hovering = false

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
                    .font(.system(size: 15))
                    .foregroundStyle(Tema.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.currentProject?.name ?? "Nessun progetto aperto")
                        .font(Tema.headline)
                        .foregroundStyle(Tema.text)
                        .lineLimit(1)
                    Text(model.hasProject ? "Progetto" : "Scegli o crea un progetto")
                        .font(Tema.caption)
                        .foregroundStyle(Tema.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11))
                    .foregroundStyle(Tema.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(Color.gray.opacity(hovering ? 0.16 : 0.10), in: .rect(cornerRadius: Tema.radius))
            .contentShape(.rect)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .onHover { hovering = $0 && model.isVaultReady }
        .disabled(!model.isVaultReady)
        .opacity(model.isVaultReady ? 1 : 0.5)
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
        .font(Tema.caption)
        .labelStyle(StatusLabelStyle())
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
    }

    @ViewBuilder private var engineLine: some View {
        switch model.engineState {
        case .loading:
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("Preparo il motore…").foregroundStyle(Tema.secondary)
            }
        case .ready:
            Label {
                Text("Motore pronto, sul Mac").foregroundStyle(Tema.secondary)
            } icon: {
                Image(systemName: "checkmark.circle").foregroundStyle(Tema.green)
            }
        case .missing:
            Label("Motore assente", systemImage: "exclamationmark.triangle")
                .foregroundStyle(Tema.orange)
        case .failed(let reason):
            Label("Motore non avviato", systemImage: "exclamationmark.triangle")
                .foregroundStyle(Tema.orange)
                .help(reason)
        }
    }

    @ViewBuilder private var vaultLine: some View {
        switch model.vaultState {
        case .opening:
            Label("Apro i dati…", systemImage: "lock")
                .foregroundStyle(Tema.secondary)
        case .ready(let protection):
            Label(protection == .secureEnclave ? "Dati cifrati · Secure Enclave" : "Dati cifrati", systemImage: "lock")
                .foregroundStyle(Tema.secondary)
                .help("Chiave custodita da: \(protection.description)")
        case .failed(let reason):
            Label("Dati non aperti", systemImage: "exclamationmark.shield")
                .foregroundStyle(Tema.red)
                .help(reason)
        }
    }

    @ViewBuilder private var backupLine: some View {
        let hasData = !model.vault.isEmpty || !model.crm.isEmpty
        Button {
            model.startExport()
        } label: {
            if let last = model.lastBackup {
                Label("Copia: \(Format.date(last))", systemImage: "externaldrive")
                    .foregroundStyle(Tema.secondary)
            } else {
                Label("Nessuna copia di sicurezza", systemImage: "externaldrive.badge.exclamationmark")
                    .foregroundStyle(hasData ? Tema.orange : Tema.secondary)
            }
        }
        .buttonStyle(.plain)
        .disabled(!model.isVaultReady)
        .help("Crea una copia di sicurezza protetta da password")
    }
}

/// Icona 13 e testo a 6 punti, come le righe di stato di Windows.
private struct StatusLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon.font(.system(size: 12)).frame(width: 14)
            configuration.title.lineLimit(1)
        }
    }
}

/// La colonna della chat a destra, larga quanto si vuole trascinando il bordo.
private struct ChatColumn: View {
    @Binding var width: Double
    @State private var dragStart: Double?

    static func clamped(_ width: Double) -> Double { min(max(width, 300), 640) }

    var body: some View {
        HStack(spacing: 0) {
            Rectangle()
                .fill(Tema.border)
                .frame(width: 1)
                .overlay {
                    Color.clear
                        .frame(width: 8)
                        .contentShape(Rectangle())
                        .onHover { inside in if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
                        .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                            .onChanged { value in
                                let start = dragStart ?? width
                                dragStart = start
                                width = Self.clamped(start - value.translation.width)
                            }
                            .onEnded { _ in dragStart = nil })
                }
            ChatPanel()
                .frame(width: Self.clamped(width))
                .frame(maxHeight: .infinity)
                .background(Tema.surface)
        }
    }
}
