import AnonymizerKit
import AppKit
import Foundation
import Observation
import os

let appLog = Logger(subsystem: "com.ivanmosetti.anonimizzatoreai", category: "app")

// MARK: - Lo stato dell'app
//
// Il motore (dentro l'app), la cartella cifrata con dizionario, CRM e chat, le impostazioni, i due banchi di lavoro
// («Anonimizza» e «Riconverti»), la chat con GPT e la navigazione. Tutto resta sul Mac.

enum AppSection: String, CaseIterable, Identifiable {
    case anonymize, reveal, chat, companies, contacts, deals, activities, dictionary

    var id: String { rawValue }

    var title: String {
        switch self {
        case .anonymize: "Anonimizza"
        case .reveal: "Riconverti"
        case .chat: "Chat con GPT"
        case .companies: "Aziende"
        case .contacts: "Contatti"
        case .deals: "Trattative"
        case .activities: "Attività"
        case .dictionary: "Dizionario"
        }
    }

    var symbol: String {
        switch self {
        case .anonymize: "eye.slash"
        case .reveal: "arrow.uturn.backward.circle"
        case .chat: "bubble.left.and.text.bubble.right"
        case .companies: "building.2"
        case .contacts: "person.2"
        case .deals: "eurosign.circle"
        case .activities: "checklist"
        case .dictionary: "character.book.closed"
        }
    }
}

/// Dove si va dentro la sezione Aziende.
enum CRMRoute: Hashable {
    case company(UUID)
    case document(UUID)
}

/// Un file aperto: il nome, il formato e i byte; per testo e Markdown anche il testo con la sua codifica.
struct OpenedFile: Equatable {
    let url: URL
    let format: DocumentFormat
    let data: Data
    let text: TextDocument?

    /// CSV, Excel, Word, PDF: si lavora sul file, non su un testo modificabile.
    var isFile: Bool { text == nil }
}

/// Un banco di lavoro: il testo di partenza a sinistra, il risultato a destra.
@Observable
final class Workspace {
    enum Mode { case anonymize, reveal }

    enum Outcome: Equatable {
        case anonymized(AnonymizationReport)
        case revealed(RevealResult)
    }

    let mode: Mode
    var input = ""
    var source: OpenedFile?
    /// Il cliente del CRM a cui legare i dati (solo «Anonimizza»).
    var clientID: UUID?
    var output = ""
    /// Le parti da evidenziare nel risultato (segnaposto o dati rimessi).
    var highlights: [NSRange] = []
    var outcome: Outcome?
    /// Da 0 a 1 mentre il motore lavora.
    var progress: Double?
    /// Il testo da cui viene il risultato: se l'ingresso cambia, il risultato è vecchio.
    var ranInput: String?
    @ObservationIgnored var task: Task<Void, Never>?
    var isRunning = false
    /// Con un file (CSV, Excel, Word, PDF): l'anteprima di partenza, il file prodotto e la sua anteprima.
    var inputPreview: DocumentPreview?
    var outputData: Data?
    var outputPreview: DocumentPreview?
    /// Pagine del PDF lette con il riconoscimento del testo.
    var recognizedPages = 0

    init(mode: Mode) {
        self.mode = mode
    }

    var isFile: Bool { source?.isFile == true }
    var isStale: Bool { ranInput != nil && ranInput != input }
    var hasInput: Bool { isFile || !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var hasOutput: Bool { !output.isEmpty || outputData != nil }
    var isEmpty: Bool { input.isEmpty && output.isEmpty && source == nil }

    func clear() {
        task?.cancel()
        task = nil
        isRunning = false
        input = ""
        source = nil
        output = ""
        highlights = []
        outcome = nil
        progress = nil
        ranInput = nil
        inputPreview = nil
        outputData = nil
        outputPreview = nil
        recognizedPages = 0
    }
}

@Observable
final class AppModel {
    enum EngineState: Equatable { case loading, ready, missing, failed(String) }
    enum VaultState: Equatable { case opening, ready(KeyProtection), failed(String) }

    /// Le finestre della copia di sicurezza.
    enum BackupStep: Identifiable {
        case export
        case restore(URL)

        var id: String {
            switch self {
            case .export: "export"
            case .restore(let url): url.path
            }
        }
    }

    var engineState: EngineState = .loading
    var vaultState: VaultState = .opening
    /// Il dizionario com'è adesso (per la vista Dizionario e i conteggi).
    var vault = Vault()
    /// Il CRM com'è adesso.
    var crm = CRMDatabase()
    var settings: AnonymizationSettings {
        didSet { saveSettings() }
    }
    /// Un messaggio da mostrare (errori di lettura, salvataggio, motore).
    var alert: String?
    var section: AppSection = .anonymize
    var companiesPath: [CRMRoute] = []
    var backupStep: BackupStep?
    var lastBackup: Date? {
        didSet { UserDefaults.standard.set(lastBackup, forKey: Self.lastBackupKey) }
    }
    /// I documenti che il motore sta anonimizzando.
    var busyDocuments: Set<UUID> = []
    /// Il cliente con cui filtrare il dizionario (nil: tutti).
    var dictionaryClient: UUID?

    let anonymizeSpace = Workspace(mode: .anonymize)
    let revealSpace = Workspace(mode: .reveal)
    let chat = ChatState()
    let updates = UpdateState()
    /// La guida (al primo avvio o da Aiuto).
    var showsGuide = false
    /// La guida chiede di aprire subito la scheda per una nuova azienda.
    var requestsNewCompany = false

    @ObservationIgnored let engine: PIIEngine?
    @ObservationIgnored let folder = SecureFolder()
    @ObservationIgnored let store: VaultStore
    @ObservationIgnored let crmStore: CRMStore
    @ObservationIgnored let chatStore: ChatStore
    @ObservationIgnored private var started = false

    init() {
        engine = PIIEngine.bundled()
        store = VaultStore(folder: folder)
        crmStore = CRMStore(folder: folder)
        chatStore = ChatStore(folder: folder)
        settings = Self.loadSettings()
        lastBackup = UserDefaults.standard.object(forKey: Self.lastBackupKey) as? Date
    }

    var isVaultReady: Bool {
        if case .ready = vaultState { true } else { false }
    }

    static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
    }

    // MARK: Avvio

    func start() async {
        guard !started else { return }
        started = true
        await openData()
        showGuideIfNeeded()
        startUpdateChecks()
        guard let engine, engine.isInstalled else {
            appLog.error("Motore assente in \(Bundle.main.resourcePath ?? "?", privacy: .public)")
            engineState = .missing
            return
        }
        do {
            try await engine.prepare()
            engineState = .ready
            appLog.notice("Motore pronto")
        } catch {
            appLog.error("Motore non avviato: \(String(describing: error), privacy: .public)")
            engineState = .failed(error.localizedDescription)
        }
        // Il motore occupa circa 700 MB: se non serve da dieci minuti si scarica, e si ricarica alla prossima richiesta.
        Task.detached(priority: .background) {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(120))
                await engine.releaseIfIdle()
            }
        }
    }

    /// Apre (o riapre, dopo un ripristino) dizionario e CRM.
    func openData() async {
        do {
            vault = try await store.reload()
            crm = try await crmStore.reload()
            chat.conversations = try await chatStore.reload()
            vaultState = .ready(folder.protection ?? .file)
        } catch {
            appLog.error("Dati non aperti: \(error.localizedDescription, privacy: .public)")
            vaultState = .failed(error.localizedDescription)
        }
    }

    // MARK: Lavoro

    func canRun(_ space: Workspace) -> Bool {
        guard space.hasInput, !space.isRunning, isVaultReady else { return false }
        return space.mode == .reveal || engineState != .missing
    }

    func run(_ space: Workspace) {
        guard canRun(space) else { return }
        if space.mode == .anonymize, engine == nil {
            alert = EngineError.notInstalled.localizedDescription
            return
        }
        if let source = space.source, source.isFile {
            runFile(source, in: space)
            return
        }
        let text = space.input
        space.isRunning = true
        space.progress = space.mode == .anonymize ? 0 : nil
        switch space.mode {
        case .anonymize:
            guard let engine else { return }
            let anonymizer = Anonymizer(engine: engine, store: store)
            let settings = settings
            let client = space.clientID.flatMap { crm.company($0)?.id }
            let known = client.map { crm.knownValues(for: $0) } ?? []
            space.task = Task {
                defer { finish(space) }
                do {
                    let result = try await anonymizer.anonymize(text, settings: settings, client: client, known: known) { value in
                        Task { @MainActor in if space.isRunning { space.progress = value } }
                    }
                    show(result.text, highlights: Revealer.placeholderRanges(in: result.text), outcome: .anonymized(result.report),
                         from: text, in: space)
                    await refreshVault()
                } catch is CancellationError {
                } catch {
                    alert = error.localizedDescription
                }
            }
        case .reveal:
            space.task = Task {
                defer { finish(space) }
                do {
                    let result = Revealer.reveal(text, vault: try await store.snapshot())
                    show(result.text, highlights: result.spans, outcome: .revealed(result), from: text, in: space)
                } catch {
                    alert = error.localizedDescription
                }
            }
        }
    }

    /// CSV, Excel, Word, PDF: si lavora sul file intero, e ne esce un file dello stesso formato.
    private func runFile(_ source: OpenedFile, in space: Workspace) {
        space.isRunning = true
        space.progress = space.mode == .anonymize ? 0 : nil
        let ext = source.url.pathExtension
        switch space.mode {
        case .anonymize:
            guard let engine else { return }
            let anonymizer = Anonymizer(engine: engine, store: store)
            let settings = settings
            let client = space.clientID.flatMap { crm.company($0)?.id }
            let known = client.map { crm.knownValues(for: $0) } ?? []
            space.task = Task {
                defer { finish(space) }
                do {
                    let outcome = try await anonymizer.anonymizeFile(source.data, format: source.format, fileExtension: ext, settings: settings,
                                                                     client: client, known: known) { value in
                        Task { @MainActor in if space.isRunning { space.progress = value } }
                    }
                    showFile(outcome, highlights: Revealer.placeholderRanges(in: outcome.preview.plainText),
                             outcome: .anonymized(outcome.report ?? AnonymizationReport(used: [], newEntries: 0)), in: space)
                    await refreshVault()
                } catch is CancellationError {
                } catch {
                    alert = error.localizedDescription
                }
            }
        case .reveal:
            space.task = Task {
                defer { finish(space) }
                do {
                    let vault = try await store.snapshot()
                    let outcome = try await FileReveal.reveal(source.data, format: source.format, fileExtension: ext, vault: vault)
                    // Dove sono i dati rimessi: si riconverte l'anteprima di partenza (se coincide con quella del risultato).
                    var highlights: [NSRange] = []
                    if case .text = outcome.preview {
                        var inputPreview = space.inputPreview
                        if inputPreview == nil {
                            inputPreview = try? await FileReveal.preview(source.data, format: source.format, fileExtension: ext)
                        }
                        let revealed = Revealer.reveal(inputPreview?.plainText ?? "", vault: vault)
                        if revealed.text == outcome.preview.plainText { highlights = revealed.spans }
                    }
                    showFile(outcome, highlights: highlights, outcome: .revealed(outcome.reveal ?? RevealResult(text: "")), in: space)
                } catch {
                    alert = error.localizedDescription
                }
            }
        }
    }

    func cancel(_ space: Workspace) {
        space.task?.cancel()
    }

    private func show(_ output: String, highlights: [NSRange], outcome: Workspace.Outcome, from input: String, in space: Workspace) {
        space.output = output
        space.highlights = highlights
        space.outcome = outcome
        space.ranInput = input
    }

    private func showFile(_ result: FileOutcome, highlights: [NSRange], outcome: Workspace.Outcome, in space: Workspace) {
        space.outputData = result.data
        space.outputPreview = result.preview
        space.recognizedPages = result.recognizedPages
        show(result.preview.plainText, highlights: highlights, outcome: outcome, from: space.input, in: space)
    }

    private func finish(_ space: Workspace) {
        space.task = nil
        space.isRunning = false
        space.progress = nil
    }

    // MARK: File

    /// Apre un file (testo, Markdown, CSV, Excel, Word, PDF) e lo elabora subito: non esce niente dal Mac.
    func open(_ url: URL, into space: Workspace) {
        guard let format = DocumentFormat.of(url) else {
            alert = DocumentFormat.FormatError.unsupported(url.pathExtension.lowercased()).localizedDescription
            return
        }
        do {
            let data = try Data(contentsOf: url)
            let client = space.clientID
            space.clear()
            space.clientID = client
            if format.isText {
                let document = try TextDocument.decode(data, kind: format == .markdown ? .markdown : .plainText)
                space.input = document.text
                space.source = OpenedFile(url: url, format: format, data: data, text: document)
            } else {
                space.source = OpenedFile(url: url, format: format, data: data, text: nil)
                space.task = nil
                Task {
                    do {
                        let preview = try await FileReveal.preview(data, format: format, fileExtension: url.pathExtension)
                        if space.source?.url == url { space.inputPreview = preview }
                    } catch {
                        if space.source?.url == url { alert = error.localizedDescription }
                    }
                }
            }
            run(space)
        } catch {
            alert = error.localizedDescription
        }
    }

    func chooseFile(for space: Workspace) {
        if let url = FilePanels.chooseDocument() { open(url, into: space) }
    }

    /// Salva il risultato: con un file aperto, accanto a lui, con lo stesso formato (e la stessa codifica per il testo).
    func save(_ space: Workspace) {
        guard space.hasOutput else { return }
        let suffix = space.mode == .anonymize ? "anonimizzato" : "riconvertito"
        let name: String
        let data: Data
        if let source = space.source {
            name = space.mode == .anonymize ? DocumentNaming.anonymizedName(for: source.url, vault: vault, settings: settings)
                : DocumentNaming.revealedName(for: source.url, vault: vault)
            if var document = source.text {
                document.text = space.output
                data = document.data()
            } else {
                guard let output = space.outputData else { return }
                data = output
            }
        } else {
            name = "Testo (\(suffix)).txt"
            data = Data(space.output.utf8)
        }
        do {
            try FilePanels.save(data, suggestedName: name, in: space.source?.url.deletingLastPathComponent())
        } catch {
            alert = error.localizedDescription
        }
    }

    func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    func copy(_ space: Workspace) {
        if space.hasOutput { copy(space.output) }
    }

    // MARK: Dizionario

    func refreshVault() async {
        if let current = try? await store.snapshot() { vault = current }
    }

    func remove(_ placeholders: Set<String>) async {
        do {
            for placeholder in placeholders { try await store.remove(placeholder) }
        } catch {
            alert = error.localizedDescription
        }
        await refreshVault()
    }

    func showVaultInFinder() {
        NSWorkspace.shared.activateFileViewerSelecting([folder.directory])
    }

    /// Esegue un'operazione e mostra l'eventuale errore.
    func perform(_ body: () async throws -> Void) async {
        do {
            try await body()
        } catch {
            alert = error.localizedDescription
        }
    }

    // MARK: Impostazioni

    private static let settingsKey = "impostazioni.anonimizzazione"
    private static let lastBackupKey = "copia.ultima"

    private static func loadSettings() -> AnonymizationSettings {
        guard let data = UserDefaults.standard.data(forKey: settingsKey),
              let settings = try? JSONDecoder().decode(AnonymizationSettings.self, from: data) else { return AnonymizationSettings() }
        return settings
    }

    private func saveSettings() {
        if let data = try? JSONEncoder().encode(settings) { UserDefaults.standard.set(data, forKey: Self.settingsKey) }
    }
}
