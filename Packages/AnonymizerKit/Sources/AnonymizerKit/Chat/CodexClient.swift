import Foundation

// MARK: - GPT con l'abbonamento ChatGPT, attraverso la CLI Codex
//
// L'app non tiene chiavi né password: usa `codex exec`, dove l'utente ha già fatto l'accesso con il suo account ChatGPT.
// Codex parte isolato: senza la configurazione dell'utente, senza sessioni salvate, in sola lettura, senza strumenti,
// senza ricerca sul web e in una cartella vuota. Riceve la conversazione (già anonimizzata) da stdin e restituisce
// eventi JSON, uno per riga; la risposta è nell'evento `item.completed` di tipo `agent_message`.

public struct CodexClient: Sendable {
    /// Quanto ragiona il modello: più ragiona, più è lento.
    public enum Effort: String, Codable, Sendable, CaseIterable, Identifiable {
        case low, medium, high

        public var id: String { rawValue }

        public var title: String {
            switch self {
            case .low: "Veloce"
            case .medium: "Normale"
            case .high: "Accurato"
            }
        }
    }

    public enum Status: Sendable, Equatable {
        case notInstalled
        case notLoggedIn
        case ready(String)
    }

    public enum CodexError: LocalizedError, Equatable {
        case notInstalled
        case notLoggedIn
        case failed(String)
        case emptyReply

        public var errorDescription: String? {
            switch self {
            case .notInstalled:
                "Codex non è installato. Installalo dal Terminale con «npm install -g @openai/codex» (oppure «brew install codex») e fai l'accesso con «codex login»."
            case .notLoggedIn:
                "Codex non ha fatto l'accesso al tuo account ChatGPT. Dal Terminale: «codex login»."
            case .failed(let message):
                "GPT non ha risposto: \(message)"
            case .emptyReply:
                "GPT non ha restituito una risposta."
            }
        }
    }

    /// Le funzioni di Codex da spegnere: la chat deve solo rispondere, mai agire sul Mac.
    static let disabledFeatures = ["shell_tool", "unified_exec", "apps", "memories", "plugins", "remote_plugin", "skill_search",
                                   "tool_suggest", "browser_use", "browser_use_external", "computer_use", "in_app_browser",
                                   "image_generation", "view_image", "multi_agent", "goals", "hooks", "sleep_tool"]

    public var model: String?
    public var effort: Effort?

    public init(model: String? = nil, effort: Effort? = nil) {
        self.model = model?.trimmingCharacters(in: .whitespaces).isEmpty == false ? model : nil
        self.effort = effort
    }

    // MARK: Dove sta Codex

    /// Un'app aperta dal Finder non ha il PATH del Terminale: si cercano anche le cartelle d'installazione più comuni.
    static var searchPath: [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let inherited = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        let common = ["/opt/homebrew/bin", "/usr/local/bin", home + "/.npm-global/bin", home + "/.local/bin", home + "/.volta/bin",
                      home + "/.bun/bin", "/usr/bin", "/bin"]
        var seen = Set<String>()
        return (common + inherited).filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    public static func executable() -> URL? {
        for directory in searchPath {
            let path = directory + "/codex"
            if FileManager.default.isExecutableFile(atPath: path) { return URL(filePath: path) }
        }
        return nil
    }

    /// Codex è installato e ha fatto l'accesso?
    public static func status() async -> Status {
        guard let codex = executable() else { return .notInstalled }
        guard let output = try? await run(codex, arguments: ["login", "status"], input: nil) else { return .notLoggedIn }
        let text = (output.stdout + "\n" + output.stderr).trimmingCharacters(in: .whitespacesAndNewlines)
        guard output.status == 0, text.localizedCaseInsensitiveContains("logged in"), !text.localizedCaseInsensitiveContains("not logged in")
        else { return .notLoggedIn }
        return .ready(text.components(separatedBy: .newlines).last ?? text)
    }

    // MARK: Una richiesta

    func arguments() -> [String] {
        var arguments = ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-s", "read-only", "--color", "never", "--json"]
        for feature in Self.disabledFeatures { arguments += ["--disable", feature] }
        arguments += ["-c", #"web_search="disabled""#]
        if let model { arguments += ["-m", model] }
        if let effort { arguments += ["-c", #"model_reasoning_effort=""# + effort.rawValue + #"""#] }
        arguments.append("-")
        return arguments
    }

    /// Manda il testo (già anonimizzato) e restituisce la risposta di GPT così com'è.
    public func send(_ transcript: String) async throws -> String {
        guard let codex = Self.executable() else { throw CodexError.notInstalled }
        let output = try await Self.run(codex, arguments: arguments(), input: Data(transcript.utf8))
        let events = Self.parse(output.stdout)
        if let reply = events.reply { return reply }
        let message = events.error ?? output.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        throw Self.classify(message, status: output.status)
    }

    static func classify(_ message: String, status: Int32) -> CodexError {
        let lower = message.lowercased()
        if lower.contains("command not found") || lower.contains("no such file") { return .notInstalled }
        if lower.contains("login") || lower.contains("401") || lower.contains("unauthorized") || lower.contains("not logged in") {
            return .notLoggedIn
        }
        if message.isEmpty { return status == 0 ? .emptyReply : .failed("Codex si è fermato (codice \(status)).") }
        return .failed(String(message.suffix(400)))
    }

    /// Gli eventi JSON di `codex exec --json`: la risposta (l'ultimo `agent_message`) o l'errore.
    static func parse(_ output: String) -> (reply: String?, error: String?) {
        var replies: [String] = []
        var error: String?
        for line in output.split(whereSeparator: \.isNewline) {
            guard let data = line.data(using: .utf8),
                  let event = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let type = event["type"] as? String else { continue }
            switch type {
            case "item.completed":
                // Gli elementi di tipo «error» qui sono solo avvisi di Codex (per esempio sulle skill): si ignorano.
                if let item = event["item"] as? [String: Any], item["type"] as? String == "agent_message",
                   let text = item["text"] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    replies.append(text)
                }
            case "turn.failed":
                error = ((event["error"] as? [String: Any])?["message"] as? String) ?? error
            case "error":
                error = (event["message"] as? String) ?? error
            default:
                break
            }
        }
        return (replies.last, replies.isEmpty ? error : nil)
    }

    // MARK: Il processo

    struct Output: Sendable {
        var status: Int32
        var stdout: String
        var stderr: String
    }

    /// Avvia Codex in una cartella vuota e aspetta che finisca; se il task viene annullato, lo ferma.
    static func run(_ executable: URL, arguments: [String], input: Data?) async throws -> Output {
        let directory = FileManager.default.temporaryDirectory.appending(path: "chat-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.currentDirectoryURL = directory
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = searchPath.joined(separator: ":")
        environment["NO_COLOR"] = "1"
        process.environment = environment
        let stdout = Pipe(), stderr = Pipe(), stdin = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        process.standardInput = input == nil ? FileHandle.nullDevice : stdin

        let collected = Collected()
        stdout.fileHandleForReading.readabilityHandler = { handle in collected.append(handle.availableData, error: false) }
        stderr.fileHandleForReading.readabilityHandler = { handle in collected.append(handle.availableData, error: true) }

        let status: Int32 = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Int32, Error>) in
                process.terminationHandler = { finished in continuation.resume(returning: finished.terminationStatus) }
                do {
                    try process.run()
                } catch {
                    process.terminationHandler = nil
                    continuation.resume(throwing: CodexError.notInstalled)
                    return
                }
                if let input {
                    try? stdin.fileHandleForWriting.write(contentsOf: input)
                    try? stdin.fileHandleForWriting.close()
                }
            }
        } onCancel: {
            if process.isRunning { process.terminate() }
        }
        stdout.fileHandleForReading.readabilityHandler = nil
        stderr.fileHandleForReading.readabilityHandler = nil
        collected.append(stdout.fileHandleForReading.readDataToEndOfFile(), error: false)
        collected.append(stderr.fileHandleForReading.readDataToEndOfFile(), error: true)
        try Task.checkCancellation()
        let (out, err) = collected.strings
        return Output(status: status, stdout: out, stderr: err)
    }

    /// Le uscite del processo, raccolte da più thread.
    private final class Collected: @unchecked Sendable {
        private let lock = NSLock()
        private var out = Data()
        private var err = Data()

        func append(_ data: Data, error: Bool) {
            guard !data.isEmpty else { return }
            lock.withLock { if error { err.append(data) } else { out.append(data) } }
        }

        var strings: (String, String) {
            lock.withLock { (String(decoding: out, as: UTF8.self), String(decoding: err, as: UTF8.self)) }
        }
    }
}
