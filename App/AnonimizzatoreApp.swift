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
                Button("Informazioni su AnoniMaiker") { AboutPanel.show() }
            }
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

/// «Informazioni su»: versione, MaikerHub e collegamenti al progetto.
enum AboutPanel {
    static func show() {
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        let base: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.secondaryLabelColor,
                                                    .paragraphStyle: style]
        let credits = NSMutableAttributedString(string: "Un prodotto ", attributes: base)
        credits.append(NSAttributedString(string: "MaikerHub", attributes: base.merging([
            .font: NSFont.systemFont(ofSize: 11, weight: .semibold),
            .foregroundColor: NSColor(srgbRed: 1, green: 0x91 / 255, blue: 0x4D / 255, alpha: 1),
        ]) { $1 }))
        credits.append(NSAttributedString(string: "\nAnonimizzazione sul Mac, CRM e chat con GPT.\nOpen source, licenza MIT.\n\n", attributes: base))
        credits.append(NSAttributedString(string: "Pagina del progetto", attributes: base.merging([.link: Updates.projectPage]) { $1 }))
        NSApp.orderFrontStandardAboutPanel(options: [.credits: credits])
        NSApp.activate()
    }
}
