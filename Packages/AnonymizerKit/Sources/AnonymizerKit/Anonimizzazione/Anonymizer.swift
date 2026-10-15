import Foundation

// MARK: - Anonimizzare e riconvertire, con il dizionario unico
//
// Il motore trova le entità, le regole decidono quali nascondere, il dizionario dà a ognuna il suo segnaposto e si salva
// cifrato. Al ritorno i segnaposto tornano i dati veri con lo stesso dizionario.

/// Cosa nascondere: categorie, eccezioni e dati già noti.
public struct AnonymizationSettings: Codable, Sendable, Equatable {
    /// Categorie che diventano segnaposto (di serie: dati personali e aziende).
    public var hidden: Set<String>
    /// «Mai nascondere»: per esempio il nome della tua agenzia. Si confrontano senza badare a maiuscole e forma societaria.
    public var exceptions: [String]
    /// «Nascondi sempre»: parole che il motore non riconosce da solo (per esempio un'attività dal nome vago come
    /// «On Location»). Si nascondono ovunque compaiano, con la loro categoria, anche se la categoria è in chiaro.
    public var forcedTerms: [ForcedTerm]
    /// Nascondi anche i dati già nel dizionario che il modello non ha riconosciuto in questo testo.
    public var maskKnownValues: Bool

    public init(hidden: Set<String> = PIICategory.defaultHidden, exceptions: [String] = [], forcedTerms: [ForcedTerm] = [],
                maskKnownValues: Bool = true) {
        self.hidden = hidden
        self.exceptions = exceptions
        self.forcedTerms = forcedTerms
        self.maskKnownValues = maskKnownValues
    }

    enum CodingKeys: String, CodingKey { case hidden, exceptions, forcedTerms, maskKnownValues }

    // Le impostazioni salvate dalle versioni precedenti non hanno «nascondi sempre».
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        hidden = c.value(.hidden, default: PIICategory.defaultHidden)
        exceptions = c.value(.exceptions, default: [])
        forcedTerms = c.value(.forcedTerms, default: [])
        maskKnownValues = c.value(.maskKnownValues, default: true)
    }
}

/// Una parola da nascondere sempre, con la sua categoria (azienda, persona o altro dato).
public struct ForcedTerm: Codable, Sendable, Hashable, Identifiable {
    public var value: String
    public var label: String

    public init(value: String, label: String) {
        self.value = value
        self.label = label
    }

    public var id: String { Vault.normalized(value) }

    /// Le categorie fra cui scegliere, nell'ordine del menu.
    public static let labels = ["ORG", "FULLNAME", "OTHER"]

    public static func title(_ label: String) -> String {
        switch label {
        case "ORG": "Azienda o attività"
        case "FULLNAME": "Persona"
        default: "Altro dato"
        }
    }
}

/// Quanto è stato nascosto in un testo.
public struct AnonymizationReport: Sendable, Equatable {
    /// Segnaposto diversi usati, per categoria.
    public var counts: [String: Int]
    /// Segnaposto usati, in ordine di categoria e numero.
    public var placeholders: [String]
    /// Voci aggiunte al dizionario.
    public var newEntries: Int

    public init(used: [String], newEntries: Int) {
        let unique = Array(Set(used)).sorted { a, b in
            let (la, na) = Vault.split(a), (lb, nb) = Vault.split(b)
            return la == lb ? na < nb : la < lb
        }
        placeholders = unique
        counts = unique.reduce(into: [:]) { $0[Vault.split($1).label, default: 0] += 1 }
        self.newEntries = newEntries
    }

    public var isEmpty: Bool { placeholders.isEmpty }

    /// «3 nomi, 2 codici fiscali, 1 IBAN»: prima i più numerosi, a pari numero nell'ordine delle categorie.
    public var summary: String {
        func rank(_ label: String) -> Int { PIICategory.placeholderLabels.firstIndex(of: label) ?? .max }
        return counts.sorted { $0.value != $1.value ? $0.value > $1.value : rank($0.key) < rank($1.key) }
            .map { "\($0.value) \(PIICategory.name($0.key, count: $0.value))" }.joined(separator: ", ")
    }
}

public struct AnonymizationResult: Sendable, Equatable {
    public var text: String
    public var report: AnonymizationReport
}

/// Chi trova i dati personali in un testo: il motore vero o, nelle prove, la sola rete regex.
protocol EntityFinder: Sendable {
    func entities(in source: PIIText, progress: (@Sendable (Double) -> Void)?) async throws -> [PIIEntity]
}

extension PIIEngine: EntityFinder {}

/// Solo regex e checksum, senza modello (per le prove dei formati).
struct RegexFinder: EntityFinder {
    func entities(in source: PIIText, progress: (@Sendable (Double) -> Void)?) async throws -> [PIIEntity] {
        let existing = source.matches(PIIAnalysis.placeholderRegex)
        return PIIAnalysis.merge(PIIDetectors.detect(source), in: source)
            .filter { entity in !existing.contains { $0.start < entity.end && entity.start < $0.end } }
    }
}

public final class Anonymizer: Sendable {
    let finder: any EntityFinder
    public let store: VaultStore

    public init(engine: PIIEngine, store: VaultStore) {
        finder = engine
        self.store = store
    }

    init(finder: any EntityFinder, store: VaultStore) {
        self.finder = finder
        self.store = store
    }

    /// Anonimizza un testo con il dizionario dell'app (che si aggiorna e si salva). `client`: il cliente del CRM a cui
    /// legare i dati trovati. `known`: i dati che il CRM sa già essere del cliente; entrano nel dizionario e si
    /// nascondono anche dove il motore non li riconosce.
    public func anonymize(_ text: String, settings: AnonymizationSettings = .init(), client: UUID? = nil, known: [KnownValue] = [],
                          matching: Vault.Matching = .exact, progress: (@Sendable (Double) -> Void)? = nil) async throws -> AnonymizationResult {
        guard text.unicodeScalars.contains(where: { !$0.properties.isWhitespace }) else {
            return AnonymizationResult(text: text, report: AnonymizationReport(used: [], newEntries: 0))
        }
        let source = PIIText(text)
        let found = try await finder.entities(in: source, progress: progress)
        let exceptions = Masking.normalizedExceptions(settings.exceptions)
        let entities = Masking.withForced(Masking.withoutExceptions(Masking.masked(found, in: source, labels: settings.hidden), in: source,
                                                                    exceptions: exceptions), in: source, terms: settings.forcedTerms)
        let hidden = settings.hidden
        let maskKnown = settings.maskKnownValues
        let (output, used, new) = try await store.update { (vault: inout Vault) -> (String, [String], Int) in
            let before = Set(vault.entries.map(\.placeholder))
            var seeded: [String] = []
            for value in known where hidden.contains(value.label) && !Masking.isException(value.value, exceptions) {
                seeded.append(vault.placeholder(label: value.label, value: value.value, client: client).placeholder)
            }
            var (output, used, _) = Self.substitute(entities, in: source, vault: &vault, client: client, matching: matching)
            // Con «dati già noti» spento si usano almeno quelli del cliente.
            let candidates = maskKnown ? vault.entries : seeded.compactMap { vault.entry($0) }
            if !candidates.isEmpty {
                // Ogni grafia ha il suo segnaposto: «MARIO ROSSI» trovato grazie a «Mario Rossi» torna «MARIO ROSSI».
                let current = PIIText(output)
                var rebuilt = ""
                var position = 0
                for match in Masking.knownMatches(in: current, entries: candidates, labels: hidden, exceptions: exceptions) {
                    let placeholder = vault.placeholder(label: match.label, value: current.slice(match.start, match.end), client: client,
                                                        matching: matching).placeholder
                    rebuilt += current.slice(position, match.start) + placeholder
                    used.append(placeholder)
                    position = match.end
                }
                output = rebuilt + current.slice(position, current.count)
            }
            return (output, used, Set(used).subtracting(before).count)
        }
        return AnonymizationResult(text: output, report: AnonymizationReport(used: used, newEntries: new))
    }

    /// Riconverte un testo (anche scritto da un'AI) con il dizionario dell'app.
    public func reveal(_ text: String) async throws -> RevealResult {
        Revealer.reveal(text, vault: try await store.snapshot())
    }

    /// Le entità al posto dei loro segnaposto.
    static func substitute(_ entities: [PIIEntity], in source: PIIText, vault: inout Vault, client: UUID?,
                           matching: Vault.Matching = .exact) -> (String, [String], Int) {
        var output = ""
        var used: [String] = []
        var new = 0
        var position = 0
        for entity in entities {
            output += source.slice(position, entity.start)
            let (placeholder, isNew) = vault.placeholder(label: entity.label, value: source.slice(entity.start, entity.end), client: client,
                                                         matching: matching)
            if isNew { new += 1 }
            used.append(placeholder)
            output += placeholder
            position = entity.end
        }
        output += source.slice(position, source.count)
        return (output, used, new)
    }

    /// Per le prove: tutte le entità trovate, con un dizionario usa e getta e senza le regole delle categorie (come la
    /// pipeline originale). Non tocca il dizionario dell'app.
    public static func trial(_ text: String, engine: PIIEngine) async throws -> (text: String, vault: Vault) {
        let source = PIIText(text)
        let entities = try await engine.entities(in: source)
        var vault = Vault()
        let (output, _, _) = substitute(entities, in: source, vault: &vault, client: nil)
        return (output, vault)
    }
}

// MARK: - Documenti

extension Anonymizer {
    /// Un documento di testo anonimizzato, nella stessa codifica dell'originale.
    public func anonymize(_ document: TextDocument, settings: AnonymizationSettings = .init(), client: UUID? = nil, known: [KnownValue] = [],
                          progress: (@Sendable (Double) -> Void)? = nil) async throws -> (document: TextDocument, report: AnonymizationReport) {
        let result = try await anonymize(document.text, settings: settings, client: client, known: known, progress: progress)
        return (document.replacingText(result.text), result.report)
    }

    /// Un documento con i segnaposto riconvertito con i dati veri.
    public func reveal(_ document: TextDocument) async throws -> (document: TextDocument, result: RevealResult) {
        let result = try await reveal(document.text)
        return (document.replacingText(result.text), result)
    }
}
