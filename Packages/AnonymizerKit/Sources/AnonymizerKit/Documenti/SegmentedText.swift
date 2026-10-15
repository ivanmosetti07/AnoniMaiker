import Foundation

// MARK: - Testo a segmenti: celle, paragrafi, pagine
//
// Un file si legge come una serie di segmenti (una cella, un paragrafo, una pagina), ognuno fatto di unità riscrivibili
// (i nodi di testo del file: in Word un paragrafo è spezzato in «run» con formattazioni diverse). Il motore legge tutto
// insieme, con i separatori in mezzo (tab fra le celle, a capo fra righe e paragrafi), così ha il contesto; i dati
// trovati si spezzano ai confini dei segmenti e si rimettono nelle unità: il segnaposto va nell'unità dove il dato
// comincia (e ne prende la formattazione), il resto del dato sparisce dalle unità successive.

struct SegmentedText: Sendable {
    var units: [String] = []
    /// Le unità di ogni segmento (indici contigui).
    var segments: [Range<Int>] = []
    /// Il separatore dopo ogni segmento, nel testo per il motore.
    var separators: [String] = []
    /// La categoria suggerita per un segmento (la colonna «Email» di una tabella).
    var hints: [Int: String] = [:]

    var isEmpty: Bool { segments.isEmpty }

    @discardableResult
    mutating func addSegment(_ texts: [String], separator: String, hint: String? = nil) -> Int {
        let start = units.count
        units += texts
        segments.append(start..<units.count)
        separators.append(separator)
        let index = segments.count - 1
        if let hint { hints[index] = hint }
        return index
    }

    func text(of segment: Int) -> String { units[segments[segment]].joined() }

    /// Il testo per il motore e dove sta ogni segmento (in code point).
    func layout() -> (text: PIIText, ranges: [(start: Int, end: Int)]) {
        var string = ""
        var ranges: [(Int, Int)] = []
        var position = 0
        for index in segments.indices {
            let text = self.text(of: index)
            let length = text.unicodeScalars.count
            ranges.append((position, position + length))
            string += text + separators[index]
            position += length + separators[index].unicodeScalars.count
        }
        return (PIIText(string), ranges)
    }

    /// Una sostituzione dentro un segmento (posizioni in code point del segmento).
    struct Replacement: Sendable, Equatable {
        var start: Int
        var end: Int
        var text: String
    }

    /// Le unità di un segmento con le sostituzioni applicate.
    static func distribute(_ units: ArraySlice<String>, _ replacements: [Replacement]) -> [String] {
        let sorted = replacements.sorted { $0.start < $1.start }
        guard !sorted.isEmpty else { return Array(units) }
        var result: [String] = []
        var offset = 0
        var r = 0
        for unit in units {
            var output = String.UnicodeScalarView()
            let scalars = Array(unit.unicodeScalars)
            for (index, scalar) in scalars.enumerated() {
                let position = offset + index
                while r < sorted.count, sorted[r].end <= position { r += 1 }
                if r < sorted.count, position >= sorted[r].start {
                    if position == sorted[r].start { output.append(contentsOf: sorted[r].text.unicodeScalars) }
                    continue
                }
                output.append(scalar)
            }
            offset += scalars.count
            result.append(String(output))
        }
        return result
    }

    /// Tutte le unità con le sostituzioni di ogni segmento.
    func applying(_ replacements: [Int: [Replacement]]) -> [String] {
        var units = self.units
        for (segment, list) in replacements where !list.isEmpty {
            let range = segments[segment]
            units.replaceSubrange(range, with: Self.distribute(self.units[range], list))
        }
        return units
    }

    /// Unisce le sostituzioni di più copie dello stesso testo (una stringa condivisa usata in più celle): senza
    /// sovrapposizioni, prima le più lunghe.
    static func merge(_ lists: [[Replacement]]) -> [Replacement] {
        var kept: [Replacement] = []
        for replacement in lists.flatMap({ $0 }).sorted(by: { ($0.end - $0.start) > ($1.end - $1.start) }) {
            if !kept.contains(where: { $0.start < replacement.end && replacement.start < $0.end }) { kept.append(replacement) }
        }
        return kept.sorted { $0.start < $1.start }
    }
}

// MARK: - Riconversione a segmenti

enum SegmentedRevealer {
    /// Le sostituzioni per riconvertire ogni segmento, e il resoconto.
    static func replacements(in content: SegmentedText, vault: Vault) -> (replacements: [Int: [SegmentedText.Replacement]], result: RevealResult) {
        var all: [Int: [SegmentedText.Replacement]] = [:]
        var result = RevealResult(text: "")
        for segment in content.segments.indices {
            let text = content.text(of: segment)
            guard text.contains("_") else { continue }
            let source = PIIText(text)
            var list: [SegmentedText.Replacement] = []
            for match in source.matches(Revealer.regex) {
                let placeholder = key(source.slice(match.start, match.end))
                if let value = vault.value(for: placeholder) {
                    list.append(.init(start: match.start, end: match.end, text: value))
                    result.replaced[placeholder, default: 0] += 1
                } else if !result.unknown.contains(placeholder) {
                    result.unknown.append(placeholder)
                }
            }
            if !list.isEmpty { all[segment] = list }
        }
        return (all, result)
    }

    /// «\[FULLNAME\_1\]», «[ FULLNAME_1 ]», «FULLNAME_1» → «[FULLNAME_1]».
    static func key(_ match: String) -> String {
        let inner = match.replacingOccurrences(of: "\\", with: "").trimmingCharacters(in: CharacterSet(charactersIn: "[] "))
        return "[\(inner)]"
    }
}

// MARK: - Le colonne di una tabella

/// Dall'intestazione di una colonna, la categoria dei suoi dati: le celle sotto «Email» o «Cognome» si nascondono anche
/// dove il motore non riconosce niente (una cella con «Rossi» da solo, senza contesto).
enum ColumnHints {
    private static let rules: [(label: String, words: [String])] = [
        ("EMAIL", ["email", "e mail", "mail", "pec", "posta elettronica"]),
        ("TELEPHONENUM", ["telefono", "tel", "cellulare", "cell", "mobile", "phone", "fax", "recapito telefonico"]),
        ("CF", ["codice fiscale", "cod fiscale", "cod fisc", "cf", "c f"]),
        ("PIVA", ["partita iva", "p iva", "piva", "p iva cf", "vat", "vat number"]),
        ("IBAN", ["iban", "coordinate bancarie"]),
        ("ORG", ["ragione sociale", "azienda", "societa", "company", "ditta", "denominazione", "impresa"]),
        ("FULLNAME", ["nome", "cognome", "nominativo", "nome e cognome", "cognome e nome", "referente", "contatto", "titolare",
                      "intestatario", "name", "first name", "last name", "full name", "dipendente", "paziente", "cliente nome"]),
        ("STREET", ["indirizzo", "via", "address", "residenza", "domicilio", "sede legale", "sede"]),
        ("CITY", ["citta", "comune", "city", "localita"]),
        ("ZIPCODE", ["cap"]),
        ("PROVINCE", ["provincia", "prov"]),
        ("TARGA", ["targa"]),
        ("DATE", ["data di nascita", "nato il", "nascita"]),
    ]

    /// La categoria di un'intestazione, se si riconosce.
    static func label(forHeader header: String) -> String? {
        let words = normalized(header)
        guard !words.isEmpty, words.count <= 5 else { return nil }
        let phrase = words.joined(separator: " ")
        for rule in rules {
            for keyword in rule.words {
                let parts = keyword.split(separator: " ").map(String.init)
                if phrase == keyword || containsSequence(words, parts) { return rule.label }
            }
        }
        return nil
    }

    /// Una riga è un'intestazione se ha testi brevi, senza cifre né «@», e almeno una colonna riconosciuta.
    static func headerLabels(_ row: [String]) -> [Int: String]? {
        let cells = row.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard cells.contains(where: { !$0.isEmpty }),
              cells.allSatisfy({ $0.count <= 40 && !$0.contains("@") && !$0.contains(where: \.isNumber) }) else { return nil }
        var labels: [Int: String] = [:]
        for (index, cell) in cells.enumerated() {
            if let label = label(forHeader: cell) { labels[index] = label }
        }
        return labels.isEmpty ? nil : labels
    }

    /// Una cella sotto quell'intestazione ha l'aria del dato giusto (non «n/d», non un numero per un nome).
    static func accepts(_ value: String, as label: String) -> Bool {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 2, !["n/d", "nd", "-", "--", "n.d.", "na", "n/a", "null", "nessuno", "nessuna"].contains(text.lowercased()) else {
            return false
        }
        let digits = text.filter(\.isNumber).count
        let letters = text.filter(\.isLetter).count
        switch label {
        case "EMAIL": return text.contains("@")
        case "TELEPHONENUM": return digits >= 6
        case "CF", "PIVA": return text.filter { $0.isLetter || $0.isNumber }.count >= 11
        case "IBAN": return text.filter { $0.isLetter || $0.isNumber }.count >= 15
        case "FULLNAME", "ORG", "CITY", "PROVINCE": return letters >= 2
        case "STREET": return letters >= 3
        case "ZIPCODE": return digits == 5
        default: return true
        }
    }

    private static func normalized(_ text: String) -> [String] {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "it_IT"))
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
    }

    private static func containsSequence(_ words: [String], _ parts: [String]) -> Bool {
        guard !parts.isEmpty, parts.count <= words.count else { return false }
        for start in 0...(words.count - parts.count) where Array(words[start..<(start + parts.count)]) == parts { return true }
        return false
    }
}

// MARK: - Anteprime

/// Un foglio (o un CSV) come tabella, per l'anteprima.
public struct PreviewSheet: Sendable, Equatable, Identifiable {
    public var id: String { name }
    public var name: String
    public var rows: [[String]]

    public init(name: String, rows: [[String]]) {
        self.name = name
        self.rows = rows
    }
}

/// Come mostrare un file: testo, oppure tabelle.
public enum DocumentPreview: Sendable, Equatable {
    case text(String)
    case sheets([PreviewSheet])

    /// Tutto come testo (le celle separate da tab): per copiarlo e per evidenziare.
    public var plainText: String {
        switch self {
        case .text(let text): text
        case .sheets(let sheets):
            sheets.map { sheet in
                (sheets.count > 1 ? "# \(sheet.name)\n" : "") + sheet.rows.map { $0.joined(separator: "\t") }.joined(separator: "\n")
            }.joined(separator: "\n\n")
        }
    }
}
