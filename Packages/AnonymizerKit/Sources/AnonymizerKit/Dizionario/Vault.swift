import Foundation

// MARK: - Il dizionario unico: segnaposto ↔ valori veri
//
// Uno solo per tutta l'app: lo stesso dato ha lo stesso segnaposto in tutti i file, e qualsiasi file si riconverte da
// solo, anche se mescola più clienti. Ogni segnaposto è una grafia esatta («MARIO ROSSI» e «Mario Rossi» ne hanno due):
// così un file riconvertito torna identico, maiuscole comprese. Per la chat c'è anche la ricerca che non bada a
// maiuscole e spazi. Ogni voce ricorda a quali clienti del CRM appartiene. Un numero, una volta dato, non torna mai
// libero: se una voce si cancella, «[FULLNAME_7]» non diventerà mai un'altra persona.

/// Una voce del dizionario: «[FULLNAME_1]» = «Mario Rossi».
public struct VaultEntry: Codable, Sendable, Hashable, Identifiable {
    public var id: String { placeholder }
    public let placeholder: String
    public let label: String
    public internal(set) var value: String
    /// I clienti del CRM a cui il dato appartiene.
    public internal(set) var clients: Set<UUID>
    public let created: Date
    public internal(set) var lastUsed: Date

    /// Il numero del segnaposto («[FULLNAME_12]» → 12).
    public var number: Int { Vault.split(placeholder).number }
}

public struct Vault: Sendable, Equatable {
    public static let currentVersion = 1

    private var byPlaceholder: [String: VaultEntry] = [:]
    /// Categoria + valore esatto → segnaposto.
    private var byKey: [String: String] = [:]
    /// Categoria + valore senza badare a maiuscole e spazi → il primo segnaposto con quella forma.
    private var byLooseKey: [String: String] = [:]
    /// Ultimo numero dato per categoria: non scende mai.
    private var counters: [String: Int] = [:]

    public init() {}

    public var isEmpty: Bool { byPlaceholder.isEmpty }
    public var count: Int { byPlaceholder.count }

    /// Le voci in ordine di categoria e numero.
    public var entries: [VaultEntry] {
        byPlaceholder.values.sorted { a, b in a.label == b.label ? a.number < b.number : a.label < b.label }
    }

    public func entry(_ placeholder: String) -> VaultEntry? { byPlaceholder[placeholder] }

    public func value(for placeholder: String) -> String? { byPlaceholder[placeholder]?.value }

    /// Come cercare un valore già noto: con la stessa grafia (file: riconversione identica), oppure senza badare a
    /// maiuscole e spazi (chat: «mario rossi» è «Mario Rossi»).
    public enum Matching: Sendable {
        case exact
        case loose
    }

    /// Il segnaposto già dato a un valore, se c'è.
    public func placeholder(forLabel label: String, value: String, matching: Matching = .exact) -> String? {
        byKey[Self.key(label, value)] ?? (matching == .loose ? byLooseKey[Self.looseKey(label, value)] : nil)
    }

    /// Spazi compattati, maiuscole e minuscole uguali.
    static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .lowercased()
    }

    private static func key(_ label: String, _ value: String) -> String {
        label + "\u{0}" + value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func looseKey(_ label: String, _ value: String) -> String { label + "\u{0}" + normalized(value) }

    /// «[FULLNAME_12]» → («FULLNAME», 12).
    static func split(_ placeholder: String) -> (label: String, number: Int) {
        let inner = placeholder.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        guard let underscore = inner.lastIndex(of: "_") else { return (inner, 0) }
        return (String(inner[..<underscore]), Int(inner[inner.index(after: underscore)...]) ?? 0)
    }

    /// Il segnaposto di un dato (nuovo se non c'era), legato al cliente se c'è.
    @discardableResult
    public mutating func placeholder(label: String, value: String, client: UUID? = nil, matching: Matching = .exact,
                                     now: Date = .now) -> (placeholder: String, isNew: Bool) {
        if let existing = placeholder(forLabel: label, value: value, matching: matching) {
            touch(existing, client: client, now: now)
            return (existing, false)
        }
        let number = (counters[label] ?? 0) + 1
        counters[label] = number
        let placeholder = "[\(label)_\(number)]"
        byKey[Self.key(label, value)] = placeholder
        let loose = Self.looseKey(label, value)
        if byLooseKey[loose] == nil { byLooseKey[loose] = placeholder }
        byPlaceholder[placeholder] = VaultEntry(placeholder: placeholder, label: label, value: value,
                                                clients: client.map { [$0] } ?? [], created: now, lastUsed: now)
        return (placeholder, true)
    }

    /// Lega una voce a un cliente del CRM.
    public mutating func link(_ placeholder: String, to client: UUID) {
        byPlaceholder[placeholder]?.clients.insert(client)
    }

    /// Una voce usata di nuovo (anche ritrovata fra i dati noti): data dell'ultimo uso e cliente.
    mutating func touch(_ placeholder: String, client: UUID?, now: Date = .now) {
        byPlaceholder[placeholder]?.lastUsed = now
        if let client { byPlaceholder[placeholder]?.clients.insert(client) }
    }

    /// Toglie una voce: i file che la usano non potranno più riavere quel dato. Il numero resta occupato.
    public mutating func remove(_ placeholder: String) {
        guard let entry = byPlaceholder.removeValue(forKey: placeholder) else { return }
        byKey[Self.key(entry.label, entry.value)] = nil
        let loose = Self.looseKey(entry.label, entry.value)
        if byLooseKey[loose] == placeholder {
            // Un'altra grafia dello stesso dato, se c'è, prende il suo posto.
            byLooseKey[loose] = entries.first { Self.looseKey($0.label, $0.value) == loose }?.placeholder
        }
    }

    /// Un dizionario con solo alcune voci, con gli stessi segnaposto. I contatori restano quelli di partenza: un numero
    /// già dato non torna libero neanche nel dizionario nuovo.
    public func subset(_ include: (VaultEntry) -> Bool) -> Vault {
        var result = Vault()
        result.counters = counters
        for entry in byPlaceholder.values where include(entry) {
            result.byPlaceholder[entry.placeholder] = entry
            result.byKey[Self.key(entry.label, entry.value)] = entry.placeholder
        }
        for entry in result.entries {
            let loose = Self.looseKey(entry.label, entry.value)
            if result.byLooseKey[loose] == nil { result.byLooseKey[loose] = entry.placeholder }
        }
        return result
    }

    /// Le voci legate a un cliente del CRM.
    public func entries(of client: UUID) -> [VaultEntry] {
        entries.filter { $0.clients.contains(client) }
    }

    /// Un cliente esce dal dizionario: le voci solo sue si tolgono, quelle condivise con altri clienti perdono il
    /// collegamento. Restituisce quante voci sono state tolte.
    @discardableResult
    public mutating func removeClient(_ client: UUID) -> Int {
        var removed = 0
        for entry in entries(of: client) {
            if entry.clients == [client] {
                remove(entry.placeholder)
                removed += 1
            } else {
                byPlaceholder[entry.placeholder]?.clients.remove(client)
            }
        }
        return removed
    }
}

// Su disco: le voci e i contatori; l'indice per valore si ricostruisce.
extension Vault: Codable {
    private enum CodingKeys: String, CodingKey { case version, entries, counters }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .version)
        guard version <= Self.currentVersion else {
            throw DecodingError.dataCorruptedError(forKey: .version, in: container,
                                                   debugDescription: "Dizionario di una versione più recente dell'app (\(version))")
        }
        counters = try container.decode([String: Int].self, forKey: .counters)
        for entry in try container.decode([VaultEntry].self, forKey: .entries).sorted(by: { $0.number < $1.number }) {
            byPlaceholder[entry.placeholder] = entry
            byKey[Self.key(entry.label, entry.value)] = entry.placeholder
            let loose = Self.looseKey(entry.label, entry.value)
            if byLooseKey[loose] == nil { byLooseKey[loose] = entry.placeholder }
            // Per sicurezza: un contatore non è mai sotto i numeri già dati.
            counters[entry.label] = max(counters[entry.label] ?? 0, entry.number)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.currentVersion, forKey: .version)
        try container.encode(entries, forKey: .entries)
        try container.encode(counters, forKey: .counters)
    }
}
