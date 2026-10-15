import Foundation

// MARK: - GPT con l'abbonamento ChatGPT, attraverso la CLI Codex
//
// L'app non tiene chiavi né password: usa `codex exec`, dove l'utente ha già fatto l'accesso con il suo account ChatGPT.
// Codex parte isolato: senza la configurazione dell'utente, senza sessioni salvate, in sola lettura, senza strumenti,
// senza ricerca sul web e in una cartella vuota. Riceve la conversazione (già anonimizzata) da stdin e restituisce
// eventi JSON, uno per riga; la risposta è nell'evento `item.completed` di tipo `agent_message`.

public struct CodexClient: Sendable {
    /// Quanto ragiona il modello (i livelli che il modello accetta stanno nel catalogo): più ragiona, più è lento.
    public static func effortTitle(_ effort: String) -> String {
        switch effort {
        case "minimal": "Minimo"
        case "low": "Veloce"
        case "medium": "Normale"
        case "high": "Accurato"
        case "xhigh": "Molto accurato"
        case "max": "Massimo"
        case "ultra": "Ultra"
        default: effort
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
                "Il tuo account ChatGPT non è ancora collegato: premi «Collega il tuo account ChatGPT» (Impostazioni › Chat)."
            case .notLoggedIn:
                "Il tuo account ChatGPT non è collegato: premi «Collega il tuo account ChatGPT» (Impostazioni › Chat)."
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
    public var effort: String?

    public init(model: String? = nil, effort: String? = nil) {
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

    // MARK: Collegare il proprio account

    public enum SetupError: LocalizedError, Equatable {
        case needsNode
        case installFailed(String)
        case loginFailed(String)

        public var errorDescription: String? {
            switch self {
            case .needsNode:
                "Per installare Codex serve Node.js (gratuito): scaricalo da nodejs.org, installalo e riprova."
            case .installFailed(let detail):
                "Installazione di Codex non riuscita: \(detail)"
            case .loginFailed(let detail):
                "Accesso a ChatGPT non completato: \(detail)"
            }
        }
    }

    static func tool(_ name: String) -> URL? {
        searchPath.lazy.map { URL(filePath: $0 + "/" + name) }.first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    /// Installa Codex con npm (o Homebrew). Ognuno lo installa sul proprio Mac, una volta sola.
    public static func install() async throws {
        let attempt: (URL, [String])
        if let npm = tool("npm") {
            attempt = (npm, ["install", "-g", "@openai/codex"])
        } else if let brew = tool("brew") {
            attempt = (brew, ["install", "codex"])
        } else {
            throw SetupError.needsNode
        }
        let output = try await run(attempt.0, arguments: attempt.1, input: nil)
        guard output.status == 0, executable() != nil else {
            let detail = (output.stderr + "\n" + output.stdout).trimmingCharacters(in: .whitespacesAndNewlines)
            if detail.contains("EACCES") {
                throw SetupError.installFailed("npm non ha i permessi per installare programmi. Installa Node.js da nodejs.org (o usa Homebrew) e riprova.")
            }
            throw SetupError.installFailed(String(detail.suffix(300)))
        }
    }

    /// L'indirizzo di accesso che Codex stampa (per aprirlo se il browser non parte da solo).
    static func loginURL(in text: String) -> URL? {
        guard let range = text.range(of: #"https://[^\s"'<>]+"#, options: .regularExpression) else { return nil }
        return URL(string: String(text[range]))
    }

    /// Collega l'account ChatGPT di chi usa questo Mac: Codex apre il browser sulla pagina di accesso di OpenAI e aspetta.
    /// `onURL` riceve l'indirizzo della pagina, da offrire se il browser non si apre.
    public static func login(onURL: @escaping @Sendable (URL) -> Void) async throws {
        guard let codex = executable() else { throw CodexError.notInstalled }
        let seen = SeenURL()
        let output = try await run(codex, arguments: ["login"], input: nil) { text in
            if let url = loginURL(in: text), seen.first(url) { onURL(url) }
        }
        guard output.status == 0, await status() != .notLoggedIn else {
            let detail = (output.stderr + "\n" + output.stdout).trimmingCharacters(in: .whitespacesAndNewlines)
            throw SetupError.loginFailed(detail.isEmpty ? "accesso annullato." : String(detail.suffix(300)))
        }
    }

    /// Scollega l'account ChatGPT da Codex su questo Mac.
    public static func logout() async throws {
        guard let codex = executable() else { return }
        _ = try await run(codex, arguments: ["logout"], input: nil)
    }

    private final class SeenURL: @unchecked Sendable {
        private let lock = NSLock()
        private var done = false
        func first(_ url: URL) -> Bool { lock.withLock { defer { done = true }; return !done } }
    }

    // MARK: I modelli

    /// I modelli che si possono scegliere, dal catalogo di Codex: solo le famiglie terra, luna e sol dalla versione 6 in
    /// poi (i nuovi compaiono da soli). Dal più recente; a parità di versione nell'ordine del catalogo.
    public static func models() async -> [CodexModel] {
        guard let codex = executable(),
              let output = try? await run(codex, arguments: ["debug", "models"], input: nil), output.status == 0 else { return [] }
        return parseModels(Data(output.stdout.utf8))
    }

    static func parseModels(_ data: Data) -> [CodexModel] {
        struct Level: Decodable { let effort: String }
        struct Entry: Decodable {
            let slug: String
            let display_name: String?
            let description: String?
            let visibility: String?
            let default_reasoning_level: String?
            let supported_reasoning_levels: [Level]?
            let priority: Int?
        }
        struct Catalog: Decodable { let models: [Entry] }
        guard let catalog = try? JSONDecoder().decode(Catalog.self, from: data) else { return [] }
        return catalog.models.compactMap { entry -> CodexModel? in
            guard entry.visibility != "hide", let version = CodexModel.version(of: entry.slug),
                  version.major >= CodexModel.minimumVersion else { return nil }
            return CodexModel(slug: entry.slug, name: entry.display_name ?? entry.slug, summary: entry.description ?? "",
                              efforts: entry.supported_reasoning_levels?.map(\.effort) ?? [],
                              defaultEffort: entry.default_reasoning_level, major: version.major, minor: version.minor,
                              priority: entry.priority ?? .max)
        }
        .sorted { a, b in (a.major, a.minor) != (b.major, b.minor) ? (a.major, a.minor) > (b.major, b.minor) : a.priority < b.priority }
    }

    // MARK: Una richiesta

    func arguments() -> [String] {
        var arguments = ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-s", "read-only", "--color", "never", "--json"]
        for feature in Self.disabledFeatures { arguments += ["--disable", feature] }
        arguments += ["-c", #"web_search="disabled""#]
        if let model { arguments += ["-m", model] }
        if let effort, !effort.isEmpty, effort.allSatisfy({ $0.isLetter }) { arguments += ["-c", "model_reasoning_effort=\"" + effort + "\""] }
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
    static func run(_ executable: URL, arguments: [String], input: Data?,
                    onOutput: (@Sendable (String) -> Void)? = nil) async throws -> Output {
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
        stdout.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            collected.append(data, error: false)
            if !data.isEmpty { onOutput?(String(decoding: data, as: UTF8.self)) }
        }
        stderr.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            collected.append(data, error: true)
            if !data.isEmpty { onOutput?(String(decoding: data, as: UTF8.self)) }
        }

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

/// Un modello di GPT che si può scegliere per la chat.
public struct CodexModel: Sendable, Equatable, Hashable, Identifiable {
    /// Solo queste famiglie, dalla versione 6.
    public static let families = ["terra", "luna", "sol"]
    public static let minimumVersion = 6

    public var id: String { slug }
    /// Il nome per Codex («gpt-6-sol»).
    public let slug: String
    /// Il nome da mostrare («GPT-6-Sol»).
    public let name: String
    public let summary: String
    /// I livelli di ragionamento che accetta («low», «medium», …).
    public let efforts: [String]
    public let defaultEffort: String?
    let major: Int
    let minor: Int
    let priority: Int

    /// Un nome di modello che si può usare (terra, luna o sol dalla versione 6).
    public static func isAllowed(_ slug: String) -> Bool {
        (version(of: slug)?.major ?? 0) >= minimumVersion
    }

    /// «gpt-6-sol» → (6, 0, «sol»); «gpt-5.6-terra» → (5, 6, «terra»); nil per le altre famiglie.
    static func version(of slug: String) -> (major: Int, minor: Int, family: String)? {
        let pattern = "^gpt-(\\d+)(?:\\.(\\d+))?-(" + families.joined(separator: "|") + ")$"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: slug, range: NSRange(location: 0, length: (slug as NSString).length)) else { return nil }
        let ns = slug as NSString
        let major = Int(ns.substring(with: match.range(at: 1))) ?? 0
        let minor = match.range(at: 2).location == NSNotFound ? 0 : Int(ns.substring(with: match.range(at: 2))) ?? 0
        return (major, minor, ns.substring(with: match.range(at: 3)).lowercased())
    }
}
