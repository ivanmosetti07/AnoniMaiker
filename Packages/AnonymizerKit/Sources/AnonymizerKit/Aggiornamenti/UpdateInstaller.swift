import Foundation

// MARK: - Installare un aggiornamento
//
// 1. Scarica DMG e firma e controlla la firma.
// 2. Apre il DMG (senza mostrarlo nel Finder), copia fuori l'app e controlla identificativo, versione e firma del codice.
// 3. Un piccolo script aspetta che l'app si chiuda, mette la nuova al posto della vecchia (che torna al suo posto se
//    qualcosa va storto) e la riapre. I dati non si toccano: stanno in Application Support.

public enum UpdateInstaller {
    public enum InstallError: LocalizedError, Equatable {
        case download(String)
        case wrongApp(String)
        case notWritable(String)
        case translocated
        case failed(String)

        public var errorDescription: String? {
            switch self {
            case .download(let message): "Download non riuscito: \(message)"
            case .wrongApp(let detail): "Il DMG scaricato non contiene l'aggiornamento atteso (\(detail)): non lo installo."
            case .notWritable(let path): "Non posso sostituire l'app in «\(path)»: manca il permesso di scrittura. Apri il DMG e trascina AnoniMaiker in Applicazioni."
            case .translocated: "macOS sta eseguendo AnoniMaiker da una posizione temporanea. Spostala nella cartella Applicazioni, riaprila e riprova."
            case .failed(let message): "Aggiornamento non riuscito: \(message)"
            }
        }
    }

    /// La cartella dei file scaricati per un aggiornamento.
    static func workDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appending(path: "AnoniMaiker-aggiornamento-\(UUID().uuidString)",
                                                                         directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// Si può sostituire l'app che sta girando?
    public static func checkReplaceable(_ app: URL) throws {
        if app.path.contains("/AppTranslocation/") { throw InstallError.translocated }
        let parent = app.deletingLastPathComponent().path
        guard FileManager.default.isWritableFile(atPath: parent), FileManager.default.isWritableFile(atPath: app.path) else {
            throw InstallError.notWritable(parent)
        }
    }

    // MARK: Download e controlli

    /// Scarica il DMG della release e ne controlla la firma; restituisce il DMG verificato.
    public static func download(_ release: AppRelease, publicKey: String = Updates.publicKey,
                                progress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        guard let signatureURL = release.signature else { throw Updates.UpdateError.unsigned }
        let directory = try workDirectory()
        let (signatureData, _) = try await URLSession.shared.data(from: signatureURL)
        let dmg = directory.appending(path: release.dmg.lastPathComponent)
        try await fetch(release.dmg, to: dmg, progress: progress)
        guard Updates.verify(dmg, signature: String(decoding: signatureData, as: UTF8.self), publicKey: publicKey) else {
            try? FileManager.default.removeItem(at: directory)
            throw Updates.UpdateError.badSignature
        }
        return dmg
    }

    /// Un download con l'avanzamento (da 0 a 1); si ferma se il task viene annullato.
    static func fetch(_ url: URL, to destination: URL, progress: @escaping @Sendable (Double) -> Void) async throws {
        let box = TaskBox()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                let task = URLSession.shared.downloadTask(with: url) { temporary, response, error in
                    if let error {
                        continuation.resume(throwing: (error as? URLError)?.code == .cancelled ? CancellationError()
                                            : InstallError.download(error.localizedDescription))
                        return
                    }
                    guard let temporary, (response as? HTTPURLResponse)?.statusCode == 200 else {
                        continuation.resume(throwing: InstallError.download("risposta \((response as? HTTPURLResponse)?.statusCode ?? 0)"))
                        return
                    }
                    do {
                        try? FileManager.default.removeItem(at: destination)
                        try FileManager.default.moveItem(at: temporary, to: destination)
                        continuation.resume()
                    } catch {
                        continuation.resume(throwing: InstallError.download(error.localizedDescription))
                    }
                }
                box.task = task
                let observation = task.progress.observe(\.fractionCompleted) { value, _ in progress(value.fractionCompleted) }
                box.observation = observation
                task.resume()
            }
        } onCancel: {
            box.task?.cancel()
        }
        box.observation = nil
    }

    private final class TaskBox: @unchecked Sendable {
        var task: URLSessionDownloadTask?
        var observation: NSKeyValueObservation?
    }

    /// Copia l'app fuori dal DMG e controlla che sia quella giusta: stesso identificativo, la versione attesa, firma valida.
    public static func extractApp(from dmg: URL, bundleIdentifier: String, version: String) async throws -> URL {
        let directory = dmg.deletingLastPathComponent()
        let mount = directory.appending(path: "volume", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: mount, withIntermediateDirectories: true)
        try await run("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount.path, dmg.path])
        defer { _ = try? Process.run(URL(filePath: "/usr/bin/hdiutil"), arguments: ["detach", "-force", mount.path]) }

        let contents = try FileManager.default.contentsOfDirectory(at: mount, includingPropertiesForKeys: nil)
        guard let app = contents.first(where: { $0.pathExtension == "app" }) else { throw InstallError.wrongApp("nessuna app") }
        let info = NSDictionary(contentsOf: app.appending(path: "Contents/Info.plist")) as? [String: Any] ?? [:]
        guard info["CFBundleIdentifier"] as? String == bundleIdentifier else {
            throw InstallError.wrongApp("identificativo \(info["CFBundleIdentifier"] as? String ?? "?")")
        }
        guard let found = info["CFBundleShortVersionString"] as? String, !Updates.isNewer(found, than: version),
              !Updates.isNewer(version, than: found) else {
            throw InstallError.wrongApp("versione \(info["CFBundleShortVersionString"] as? String ?? "?") invece di \(version)")
        }
        let copy = directory.appending(path: app.lastPathComponent)
        try? FileManager.default.removeItem(at: copy)
        try await run("/usr/bin/ditto", [app.path, copy.path])
        try await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", copy.path])
        try await run("/usr/bin/hdiutil", ["detach", "-force", mount.path])
        return copy
    }

    // MARK: Sostituzione

    /// Lo script che aspetta la chiusura dell'app, la sostituisce e la riapre.
    static let script = #"""
    #!/bin/sh
    # Aggiornamento di AnoniMaiker: $1 = processo da aspettare, $2 = nuova app, $3 = app da sostituire.
    PID="$1"; NEW="$2"; TARGET="$3"; OLD="$TARGET.precedente"
    i=0
    while kill -0 "$PID" 2>/dev/null && [ $i -lt 300 ]; do sleep 0.2; i=$((i+1)); done
    rm -rf "$OLD"
    if mv "$TARGET" "$OLD" && /usr/bin/ditto "$NEW" "$TARGET"; then
      rm -rf "$OLD"
    else
      rm -rf "$TARGET"; mv "$OLD" "$TARGET"
    fi
    /usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
    /usr/bin/open "$TARGET"
    rm -rf "$(dirname "$NEW")"
    """#

    /// Avvia lo script; subito dopo l'app deve chiudersi.
    public static func replace(_ target: URL, with newApp: URL, waitingFor pid: Int32 = ProcessInfo.processInfo.processIdentifier) throws {
        try checkReplaceable(target)
        let scriptURL = newApp.deletingLastPathComponent().appending(path: "installa.sh")
        try script.write(to: scriptURL, atomically: true, encoding: .utf8)
        let process = Process()
        process.executableURL = URL(filePath: "/bin/sh")
        process.arguments = [scriptURL.path, String(pid), newApp.path, target.path]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            throw InstallError.failed(error.localizedDescription)
        }
    }

    @discardableResult
    static func run(_ tool: String, _ arguments: [String]) async throws -> String {
        let process = Process()
        process.executableURL = URL(filePath: tool)
        process.arguments = arguments
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        return try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = { finished in
                let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                if finished.terminationStatus == 0 {
                    continuation.resume(returning: text)
                } else {
                    let name = (tool as NSString).lastPathComponent
                    continuation.resume(throwing: InstallError.failed("\(name): \(text.trimmingCharacters(in: .whitespacesAndNewlines).suffix(300))"))
                }
            }
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: InstallError.failed(error.localizedDescription))
            }
        }
    }
}
