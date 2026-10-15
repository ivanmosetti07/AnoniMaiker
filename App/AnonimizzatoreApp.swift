import AnonymizerKit
import AppKit
import SwiftUI

@main
struct AnonimizzatoreApp: App {
    @NSApplicationDelegateAdaptor private var delegate: AppDelegate
    @State private var model = AppModel()

    var body: some Scene {
        Window("AnoniMaiker", id: "principale") {
            ContentView()
                .environment(model)
                .task { await model.start() }
                .frame(minWidth: 880, minHeight: 540)
        }
        .defaultSize(width: 1200, height: 760)
        .commands {
            // Una finestra sola: niente «Nuova finestra».
            CommandGroup(replacing: .newItem) {}
            CommandGroup(after: .appInfo) {
                Button("Controlla aggiornamenti…") { Task { await model.checkForUpdates(userInitiated: true) } }
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

        Settings {
            SettingsView()
                .environment(model)
        }
    }
}

/// Chiudere la finestra chiude l'app: il motore libera la memoria.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
