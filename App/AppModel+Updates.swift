import AnonymizerKit
import AppKit
import Foundation
import Observation

// MARK: - Aggiornamenti
//
// All'avvio (e poi una volta al giorno) l'app chiede a GitHub l'ultima release. Se è più nuova mostra le novità; con un
// clic scarica il DMG, ne controlla la firma, sostituisce l'app e la riapre. I dati non si toccano.

@Observable
final class UpdateState {
    enum Phase: Equatable {
        case idle
        case checking
        case upToDate
        case available(AppRelease)
        case downloading(AppRelease, Double)
        case installing(AppRelease)
        case failed(String, AppRelease?)
    }

    var phase: Phase = .idle
    var isPresented = false
    var automatic: Bool {
        didSet { UserDefaults.standard.set(automatic, forKey: Self.automaticKey) }
    }
    var lastCheck: Date? {
        didSet { UserDefaults.standard.set(lastCheck, forKey: Self.lastCheckKey) }
    }
    @ObservationIgnored var task: Task<Void, Never>?

    static let automaticKey = "aggiornamenti.automatici"
    static let lastCheckKey = "aggiornamenti.ultimoControllo"
    static let skippedKey = "aggiornamenti.saltata"

    init() {
        automatic = UserDefaults.standard.object(forKey: Self.automaticKey) as? Bool ?? true
        lastCheck = UserDefaults.standard.object(forKey: Self.lastCheckKey) as? Date
    }

    var skippedVersion: String? {
        get { UserDefaults.standard.string(forKey: Self.skippedKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.skippedKey) }
    }

    var isBusy: Bool {
        switch phase {
        case .checking, .downloading, .installing: true
        default: false
        }
    }
}

extension AppModel {
    /// Il controllo automatico: subito se l'ultimo ha più di un giorno, poi ogni giorno.
    func startUpdateChecks() {
        Task {
            while !Task.isCancelled {
                if updates.automatic, Date.now.timeIntervalSince(updates.lastCheck ?? .distantPast) > 24 * 3600 {
                    await checkForUpdates(userInitiated: false)
                }
                try? await Task.sleep(for: .seconds(3 * 3600))
            }
        }
    }

    /// Chiede a GitHub l'ultima versione. Dal menu mostra sempre l'esito; in automatico solo se c'è una novità.
    func checkForUpdates(userInitiated: Bool) async {
        guard !updates.isBusy else {
            if userInitiated { updates.isPresented = true }
            return
        }
        if userInitiated {
            updates.phase = .checking
            updates.isPresented = true
        }
        do {
            let release = try await Updates.latest()
            updates.lastCheck = .now
            if let release, Updates.isNewer(release.version, than: Self.appVersion) {
                if userInitiated || release.version != updates.skippedVersion {
                    updates.phase = .available(release)
                    updates.isPresented = true
                    appLog.notice("Aggiornamento disponibile: \(release.version, privacy: .public)")
                } else if !userInitiated {
                    updates.phase = .idle
                }
            } else {
                updates.phase = userInitiated ? .upToDate : .idle
            }
        } catch {
            appLog.error("Controllo aggiornamenti: \(error.localizedDescription, privacy: .public)")
            updates.phase = userInitiated ? .failed(error.localizedDescription, nil) : .idle
        }
    }

    func skip(_ release: AppRelease) {
        updates.skippedVersion = release.version
        updates.phase = .idle
        updates.isPresented = false
    }

    /// Scarica, controlla e installa; poi l'app si chiude e lo script la riapre aggiornata.
    func install(_ release: AppRelease) {
        guard !updates.isBusy else { return }
        let target = Bundle.main.bundleURL
        do {
            try UpdateInstaller.checkReplaceable(target)
        } catch {
            updates.phase = .failed(error.localizedDescription, release)
            return
        }
        let bundleID = Bundle.main.bundleIdentifier ?? ""
        let updates = updates
        updates.phase = .downloading(release, 0)
        updates.task = Task {
            do {
                let dmg = try await UpdateInstaller.download(release) { value in
                    Task { @MainActor in
                        if case .downloading = updates.phase { updates.phase = .downloading(release, value) }
                    }
                }
                updates.phase = .installing(release)
                let app = try await UpdateInstaller.extractApp(from: dmg, bundleIdentifier: bundleID, version: release.version)
                try UpdateInstaller.replace(target, with: app)
                appLog.notice("Installo la versione \(release.version, privacy: .public) e riavvio")
                NSApp.terminate(nil)
            } catch is CancellationError {
                updates.phase = .available(release)
            } catch {
                appLog.error("Aggiornamento non riuscito: \(error.localizedDescription, privacy: .public)")
                updates.phase = .failed(error.localizedDescription, release)
            }
            updates.task = nil
        }
    }

    func cancelUpdate() {
        updates.task?.cancel()
    }

    func openReleasePage(_ release: AppRelease?) {
        NSWorkspace.shared.open(release?.page ?? Updates.releasesPage)
    }
}
