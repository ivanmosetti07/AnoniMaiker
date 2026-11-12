import AnonymizerKit
import AppKit
import SwiftUI

@main
struct AnonimizzatoreApp: App {
    @NSApplicationDelegateAdaptor private var delegate: AppDelegate
    @State private var model = AppModel()
    @State private var sheets = AppSheets.shared

    var body: some Scene {
        Window("AnoniMaiker", id: "principale") {
            ContentView()
                .environment(model)
                .environment(sheets)
                .task {
                    await model.start()
                    #if DEBUG
                    await ProvaScript.runIfRequested(model)
                    #endif
                }
                .frame(minHeight: 540)
        }
        // Niente barra del titolo: il logo sta in cima alla barra laterale, come su Windows.
        .windowStyle(.hiddenTitleBar)
        // Senza la barra del titolo la finestra si sposta trascinando le zone vuote.
        .windowBackgroundDragBehavior(.enabled)
        .defaultSize(width: 1200, height: 760)
        .commands {
            // Una finestra sola: niente «Nuova finestra».
            CommandGroup(replacing: .newItem) {
                Button("Nuovo progetto…") {
                    model.showProjects()
                    model.requestsNewProject = true
                }
                .keyboardShortcut("n")
                .disabled(!model.isVaultReady)
                Button("Tutti i progetti") { model.showProjects() }
                    .keyboardShortcut("p", modifiers: [.command, .shift])
            }
            CommandGroup(replacing: .appInfo) {
                Button("Informazioni su AnoniMaiker") { sheets.showsAbout = true }
            }
            CommandGroup(after: .appInfo) {
                Button("Controlla aggiornamenti…") { Task { await model.checkForUpdates(userInitiated: true) } }
            }
            // Le impostazioni sono una finestra sopra la finestra, come su Windows.
            CommandGroup(replacing: .appSettings) {
                Button("Impostazioni…") { sheets.showsSettings = true }
                    .keyboardShortcut(",")
            }
            CommandGroup(replacing: .help) {
                Button("Guida di AnoniMaiker") { model.showsGuide = true }
                    .keyboardShortcut("?", modifiers: .command)
                Divider()
                Link("Pagina del progetto su GitHub", destination: Updates.projectPage)
                Link("Segnala un problema", destination: Updates.issuesPage)
            }
            CommandGroup(after: .saveItem) {
                Divider()
                Button("Crea copia di sicurezza…") { model.startExport() }
                    .keyboardShortcut("b", modifiers: [.command, .shift])
                    .disabled(!model.isVaultReady)
                Button("Ripristina da una copia di sicurezza…") { model.startRestore() }
            }
        }
    }
}

/// Chiudere la finestra chiude l'app: il motore libera la memoria.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

/// Le finestre sopra la finestra aperte dal menu dell'app: impostazioni e «Informazioni su».
@MainActor @Observable
final class AppSheets {
    static let shared = AppSheets()

    var showsSettings = false
    var showsAbout = false
    /// La pagina delle impostazioni aperta.
    var settingsTab: SettingsTab = .categories
}

/// «Informazioni su»: simbolo, versione, MaikerHub e collegamento al progetto.
struct AboutSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 6) {
                Image("Simbolo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 72, height: 72)
                    .accessibilityHidden(true)
                Text("AnoniMaiker").font(Tema.title2).padding(.top, 6)
                Text("Versione \(AppModel.appVersion)").font(Tema.caption).foregroundStyle(Tema.secondary).textSelection(.enabled)
                VStack(spacing: 2) {
                    Text("Un prodotto \(Text("MaikerHub").fontWeight(.semibold).foregroundStyle(Color(hex: 0xFF914D)))")
                    Text("Anonimizzazione sul Mac, CRM e chat con GPT.")
                    Text("Software libero, licenza GNU GPL v3.")
                }
                .font(Tema.caption)
                .foregroundStyle(Tema.secondary)
                .multilineTextAlignment(.center)
                .padding(.top, 10)
                Button("Pagina del progetto") { NSWorkspace.shared.open(Updates.projectPage) }
                    .buttonStyle(.accentLink)
                    .font(Tema.caption)
                    .padding(.top, 10)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 30)
            .padding(.top, 26)
            .padding(.bottom, 22)
            SheetActions {
                Button("OK") { dismiss() }
                    .buttonStyle(.primary)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .frame(width: 380)
        .background(Tema.surface)
    }
}
