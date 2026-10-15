import Foundation

// MARK: - Riconversione: i segnaposto tornano i dati veri
//
// Tollerante con quello che fanno le AI e gli editor: grassetto («**[FULLNAME_1]**»), spazi nelle parentesi,
// parentesi perse («FULLNAME_1»), Markdown con le parentesi e i trattini bassi preceduti da «\». Un segnaposto che il
// dizionario non conosce (inventato dall'AI, o di un altro Mac) resta com'è e si segnala: meglio di un valore sbagliato.

/// Esito di una riconversione.
public struct RevealResult: Sendable, Equatable {
    public var text: String
    /// Segnaposto rimessi, con quante volte.
    public var replaced: [String: Int] = [:]
    /// Segnaposto che il dizionario non conosce, nell'ordine in cui compaiono.
    public var unknown: [String] = []
    /// Dove stanno i valori rimessi nel testo riconvertito (offset UTF-16): per evidenziarli.
    public var spans: [NSRange] = []

    /// Quanti segnaposto sono tornati dati veri.
    public var count: Int { replaced.values.reduce(0, +) }

    public init(text: String) {
        self.text = text
    }
}

public enum Revealer {
    /// Solo le categorie dei segnaposto: «MAX_SIZE_1» in un pezzo di codice non è un segnaposto.
    static let regex: NSRegularExpression = {
        let labels = PIICategory.placeholderLabels.sorted { $0.count > $1.count }
            .map { NSRegularExpression.escapedPattern(for: $0).replacingOccurrences(of: "_", with: #"\\?_"#) }
            .joined(separator: "|")
        let inner = "(?:" + labels + #")\\?_\d+"#
        let pattern = #"\\?\[\s*("# + inner + #")\s*\\?\]|(?<![\p{L}\p{N}_\\])("# + inner + #")(?![\p{L}\p{N}_])"#
        return try! NSRegularExpression(pattern: pattern)
    }()

    public static func reveal(_ text: String, vault: Vault) -> RevealResult {
        var result = RevealResult(text: text)
        guard text.contains("_") else { return result }
        let ns = text as NSString
        var output = ""
        var length = 0
        var position = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            let group = [1, 2].map { match.range(at: $0) }.first { $0.location != NSNotFound } ?? match.range
            let placeholder = "[" + ns.substring(with: group).replacingOccurrences(of: "\\", with: "") + "]"
            let before = ns.substring(with: NSRange(location: position, length: match.range.location - position))
            output += before
            length += (before as NSString).length
            if let value = vault.value(for: placeholder) {
                let valueLength = (value as NSString).length
                result.spans.append(NSRange(location: length, length: valueLength))
                result.replaced[placeholder, default: 0] += 1
                output += value
                length += valueLength
            } else {
                let original = ns.substring(with: match.range)
                if !result.unknown.contains(placeholder) { result.unknown.append(placeholder) }
                output += original
                length += (original as NSString).length
            }
            position = match.range.location + match.range.length
        }
        result.text = output + ns.substring(from: position)
        return result
    }

    /// Dove stanno i segnaposto in un testo anonimizzato (offset UTF-16): per evidenziarli.
    public static func placeholderRanges(in text: String) -> [NSRange] {
        PIIAnalysis.placeholderRegex.matches(in: text, range: NSRange(location: 0, length: (text as NSString).length)).map(\.range)
    }
}
