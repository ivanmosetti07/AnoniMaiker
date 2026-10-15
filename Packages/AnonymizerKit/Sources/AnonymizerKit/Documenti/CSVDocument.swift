import Foundation

// MARK: - CSV: cella per cella
//
// Si riconosce il separatore (Excel in italiano usa «;»), le virgolette (anche con a-capo dentro), gli a-capo e la
// codifica, e si riscrive tutto uguale: cambia solo il testo delle celle. Una cella che aveva le virgolette le tiene;
// una che ora contiene un separatore le prende.

struct CSVTable: Sendable {
    struct Field: Sendable, Equatable {
        var text: String
        var quoted: Bool
        /// Com'era scritta nel file (virgolette comprese): se il testo non cambia, si riscrive così.
        var raw: String? = nil
        var original: String? = nil
    }

    var rows: [[Field]]
    var delimiter: Character
    var lineEnding: String
    var endsWithNewline: Bool
    /// Codifica e BOM dell'originale.
    var encoding: TextDocument

    static let candidates: [Character] = [";", ",", "\t", "|"]

    init(data: Data, fileExtension: String = "csv") throws {
        let document = try TextDocument.decode(data, kind: .plainText)
        encoding = document
        let text = document.text
        lineEnding = Self.lineEnding(of: text)
        delimiter = fileExtension.lowercased() == "tsv" ? "\t" : Self.delimiter(of: text)
        (rows, endsWithNewline) = Self.parse(text, delimiter: delimiter)
    }

    /// «\r\n» se il file lo usa, altrimenti «\n» (o «\r» dei vecchi Mac).
    static func lineEnding(of text: String) -> String {
        var inQuotes = false
        var previous: Unicode.Scalar?
        for scalar in text.unicodeScalars {
            if scalar == "\"" { inQuotes.toggle() }
            if !inQuotes {
                if scalar == "\n" { return previous == "\r" ? "\r\n" : "\n" }
                if previous == "\r" { return "\r" }
            }
            previous = scalar
        }
        return previous == "\r" ? "\r" : "\n"
    }

    /// Il separatore che divide le prime righe nello stesso numero di colonne.
    static func delimiter(of text: String) -> Character {
        var lines: [[Character: Int]] = [[:]]
        var inQuotes = false
        for character in text {
            if character == "\"" { inQuotes.toggle(); continue }
            if inQuotes { continue }
            if character == "\n" || character == "\r\n" || character == "\r" {
                if lines.count >= 20 { break }
                lines.append([:])
                continue
            }
            if candidates.contains(character) { lines[lines.count - 1][character, default: 0] += 1 }
        }
        let filled = lines.filter { !$0.isEmpty }
        guard !filled.isEmpty else { return "," }
        var best: (Character, Int) = (",", -1)
        for candidate in candidates {
            let counts = filled.map { $0[candidate] ?? 0 }
            guard let first = counts.first, first > 0 else { continue }
            // Stesso numero su tutte le righe: punteggio pieno; altrimenti conta quante righe tornano.
            let consistent = counts.filter { $0 == first }.count
            let score = consistent * 100 + first
            if score > best.1 { best = (candidate, score) }
        }
        return best.0
    }

    static func parse(_ text: String, delimiter: Character) -> (rows: [[Field]], endsWithNewline: Bool) {
        var rows: [[Field]] = []
        var row: [Field] = []
        var field = ""
        var quoted = false
        var inQuotes = false
        var endsWithNewline = false
        let characters = Array(text)
        var index = 0
        var fieldStart = 0
        func close(at end: Int) {
            row.append(Field(text: field, quoted: quoted, raw: String(characters[fieldStart..<end]), original: field))
            field = ""
            quoted = false
        }
        // Un a-capo dentro le virgolette è testo; «""» dentro le virgolette è una virgoletta.
        while index < characters.count {
            let character = characters[index]
            endsWithNewline = false
            if inQuotes {
                if character == "\"" {
                    if index + 1 < characters.count, characters[index + 1] == "\"" {
                        field.append("\"")
                        index += 1
                    } else {
                        inQuotes = false
                    }
                } else {
                    field.append(character)
                }
            } else if character == "\"", field.isEmpty, !quoted {
                inQuotes = true
                quoted = true
            } else if character == delimiter {
                close(at: index)
                fieldStart = index + 1
            } else if character == "\n" || character == "\r\n" || character == "\r" {
                close(at: index)
                rows.append(row)
                row = []
                fieldStart = index + 1
                endsWithNewline = true
            } else {
                field.append(character)
            }
            index += 1
        }
        if !endsWithNewline, !(row.isEmpty && field.isEmpty && !quoted) {
            close(at: characters.count)
            rows.append(row)
        }
        return (rows, endsWithNewline)
    }

    func data() -> Data {
        let separator = String(delimiter)
        var text = rows.map { row in
            row.map { field in
                if let raw = field.raw, field.text == field.original { return raw }
                let needsQuotes = field.quoted || field.text.contains(delimiter) || field.text.contains("\"")
                    || field.text.contains("\n") || field.text.contains("\r")
                return needsQuotes ? "\"" + field.text.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : field.text
            }.joined(separator: separator)
        }.joined(separator: lineEnding)
        if endsWithNewline { text += lineEnding }
        var document = encoding
        document.text = text
        return document.data()
    }

    // MARK: Segmenti

    /// Una cella = un segmento; la prima riga, se è un'intestazione, dà la categoria delle colonne.
    func segmented() -> (content: SegmentedText, cells: [(row: Int, column: Int)]) {
        var content = SegmentedText()
        var cells: [(Int, Int)] = []
        let header = rows.first.flatMap { ColumnHints.headerLabels($0.map(\.text)) }
        for (r, row) in rows.enumerated() {
            for (c, field) in row.enumerated() {
                let hint = r > 0 ? header?[c] : nil
                content.addSegment([field.text], separator: c == row.count - 1 ? "\n" : "\t", hint: hint)
                cells.append((r, c))
            }
        }
        return (content, cells)
    }

    mutating func apply(_ units: [String], cells: [(row: Int, column: Int)]) {
        for (index, cell) in cells.enumerated() { rows[cell.row][cell.column].text = units[index] }
    }

    var preview: PreviewSheet {
        PreviewSheet(name: "CSV", rows: rows.map { $0.map(\.text) })
    }
}
