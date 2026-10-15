import Foundation

// MARK: - Excel (.xlsx): cella per cella
//
// Il testo delle celle sta nelle stringhe condivise (una stringa usata in più celle si scrive una volta), nelle stringhe
// in linea e nei risultati delle formule di testo; telefoni e partite IVA spesso sono numeri. Il motore legge i fogli
// riga per riga (così ha il contesto), poi i segnaposto tornano nelle stringhe: una stringa condivisa prende l'unione di
// quello che si è trovato in tutte le celle che la usano. Un numero che va nascosto diventa testo. Anche intestazioni e
// piè di pagina e i commenti; gli autori dei commenti diventano «Autore».

struct SpreadsheetFile: Sendable {
    static let namespaces = ["http://schemas.openxmlformats.org/spreadsheetml/2006/main", "http://purl.oclc.org/ooxml/spreadsheetml/main"]

    struct Part: Sendable {
        let path: String
        let xml: XMLBytes
        let tags: [XMLTag]
        let prefix: String

        init(path: String, data: Data) {
            self.path = path
            xml = XMLBytes(data)
            tags = xml.tags()
            prefix = xml.prefix(for: SpreadsheetFile.namespaces, in: tags) ?? ""
        }

        func name(_ local: String) -> String { XMLBytes.qualified(prefix, local) }
    }

    struct Cell: Sendable {
        enum Kind: Sendable {
            case shared(Int)
            case inline([TextNode])
            case formulaText(TextNode)
            /// Il tag «<c>», la fine dell'elemento e il valore.
            case number(cell: XMLTag, end: Int, value: TextNode)
        }

        let row: Int
        let column: Int
        let kind: Kind
    }

    struct Sheet: Sendable {
        let name: String
        let part: Part
        let cells: [Cell]
        let headerFooter: [TextNode]
    }

    /// Dove sta il testo di un segmento.
    enum Source: Sendable {
        case cell(sheet: Int, cell: Int)
        case headerFooter(sheet: Int, node: Int)
        case comment(part: Int, nodes: [TextNode])
    }

    private(set) var entries: [ZipEntry]
    private let sharedPart: Part?
    private let sharedItems: [[TextNode]]
    private let sheets: [Sheet]
    private let commentParts: [Part]

    init(data: Data) throws {
        entries = try ZipArchive.read(data)
        guard let workbookEntry = entries[entry: "xl/workbook.xml"] else { throw ZipArchive.ZipError.unsupported("manca xl/workbook.xml") }
        let workbook = Part(path: "xl/workbook.xml", data: workbookEntry.data)
        let relationships = OfficePaths.relationships(of: workbook.path, in: entries)

        // Stringhe condivise.
        let sharedPath = relationships.values.first { $0.type.hasSuffix("/sharedStrings") }
            .map { OfficePaths.resolve($0.target, relativeTo: workbook.path) } ?? "xl/sharedStrings.xml"
        if let entry = entries[entry: sharedPath] {
            let part = Part(path: sharedPath, data: entry.data)
            sharedPart = part
            sharedItems = Self.sharedItems(in: part)
        } else {
            sharedPart = nil
            sharedItems = []
        }

        // Fogli, nell'ordine della cartella di lavoro.
        var sheets: [Sheet] = []
        for tag in workbook.tags where !tag.isEnd && tag.name == workbook.name("sheet") {
            let attributes = workbook.xml.attributes(of: tag)
            guard let id = attributes.first(where: { $0.key == "r:id" || $0.key.hasSuffix(":id") })?.value.value,
                  let relationship = relationships[id], relationship.type.hasSuffix("/worksheet") else { continue }
            let path = OfficePaths.resolve(relationship.target, relativeTo: workbook.path)
            guard let entry = entries[entry: path] else { continue }
            let part = Part(path: path, data: entry.data)
            let (cells, headerFooter) = Self.cells(in: part)
            sheets.append(Sheet(name: attributes["name"]?.value ?? "Foglio", part: part, cells: cells, headerFooter: headerFooter))
        }
        self.sheets = sheets
        commentParts = entries.filter { entry in
            (entry.name.hasPrefix("xl/comments") || entry.name.hasPrefix("xl/threadedComments/")) && entry.name.hasSuffix(".xml")
        }.map { Part(path: $0.name, data: $0.data) }
    }

    private static func sharedItems(in part: Part) -> [[TextNode]] {
        var items: [[TextNode]] = []
        var current: [TextNode]?
        var phonetic = false
        for (index, tag) in part.tags.enumerated() {
            switch tag.name {
            case part.name("si"):
                if tag.isSelfClosing { items.append([]) } else if tag.isEnd { items.append(current ?? []); current = nil } else { current = [] }
            case part.name("rPh"):
                phonetic = !tag.isEnd && !tag.isSelfClosing
            case part.name("t") where !tag.isEnd && !phonetic && current != nil:
                if let node = part.xml.textNode(at: index, in: part.tags) { current?.append(node) }
            default:
                break
            }
        }
        return items
    }

    private static func cells(in part: Part) -> ([Cell], [TextNode]) {
        var cells: [Cell] = []
        var headerFooter: [TextNode] = []
        let headerFooterNames = Set(["oddHeader", "oddFooter", "evenHeader", "evenFooter", "firstHeader", "firstFooter"].map(part.name))
        var row = 0
        var index = 0
        let tags = part.tags
        while index < tags.count {
            let tag = tags[index]
            if !tag.isEnd, tag.name == part.name("row") {
                row = part.xml.attributes(of: tag)["r"].flatMap { Int($0.value) } ?? row + 1
            } else if !tag.isEnd, headerFooterNames.contains(tag.name), let node = part.xml.textNode(at: index, in: tags) {
                headerFooter.append(node)
            } else if !tag.isEnd, !tag.isSelfClosing, tag.name == part.name("c") {
                let attributes = part.xml.attributes(of: tag)
                let (cellRow, column) = Self.position(attributes["r"]?.value, row: row, previous: cells.last)
                let type = attributes["t"]?.value ?? "n"
                var value: TextNode?
                var inline: [TextNode] = []
                var hasFormula = false
                var phonetic = false
                var j = index + 1
                while j < tags.count, !(tags[j].isEnd && tags[j].name == part.name("c")) {
                    let inner = tags[j]
                    if inner.name == part.name("rPh") { phonetic = !inner.isEnd && !inner.isSelfClosing }
                    if !inner.isEnd {
                        if inner.name == part.name("v") { value = part.xml.textNode(at: j, in: tags) }
                        if inner.name == part.name("f") { hasFormula = true }
                        if inner.name == part.name("t"), !phonetic, let node = part.xml.textNode(at: j, in: tags) { inline.append(node) }
                    }
                    j += 1
                }
                let end = j < tags.count ? tags[j].range.upperBound : tag.range.upperBound
                switch type {
                case "s":
                    if let value, let shared = Int(value.text.trimmingCharacters(in: .whitespaces)) {
                        cells.append(Cell(row: cellRow, column: column, kind: .shared(shared)))
                    }
                case "inlineStr":
                    if !inline.isEmpty { cells.append(Cell(row: cellRow, column: column, kind: .inline(inline))) }
                case "str":
                    if let value { cells.append(Cell(row: cellRow, column: column, kind: .formulaText(value))) }
                case "n":
                    if let value, !hasFormula { cells.append(Cell(row: cellRow, column: column, kind: .number(cell: tag, end: end, value: value))) }
                default:
                    break
                }
                index = j
            }
            index += 1
        }
        return (cells, headerFooter)
    }

    /// «B12» → (12, 1); senza riferimento, la cella dopo la precedente.
    static func position(_ reference: String?, row: Int, previous: Cell?) -> (row: Int, column: Int) {
        guard let reference, !reference.isEmpty else {
            if let previous, previous.row == row { return (row, previous.column + 1) }
            return (row, 0)
        }
        var column = 0
        var digits = ""
        for character in reference.uppercased() {
            if let ascii = character.asciiValue, character.isLetter {
                column = column * 26 + Int(ascii - 64)
            } else if character.isNumber {
                digits.append(character)
            }
        }
        return (Int(digits) ?? row, max(0, column - 1))
    }

    // MARK: Segmenti

    private func texts(of cell: Cell) -> [String]? {
        switch cell.kind {
        case .shared(let index): index < sharedItems.count ? sharedItems[index].map(\.text) : nil
        case .inline(let nodes): nodes.map(\.text)
        case .formulaText(let node): [node.text]
        case .number(_, _, let value): [value.text]
        }
    }

    func segmented() -> (content: SegmentedText, sources: [Source]) {
        var content = SegmentedText()
        var sources: [Source] = []
        for (s, sheet) in sheets.enumerated() {
            let rows = Dictionary(grouping: sheet.cells.indices, by: { sheet.cells[$0].row }).sorted { $0.key < $1.key }
            var hints: [Int: String] = [:]
            for (r, row) in rows.enumerated() {
                let ordered = row.value.sorted { sheet.cells[$0].column < sheet.cells[$1].column }
                if r == 0 {
                    // Intestazione: le colonne riconosciute, per colonna del foglio.
                    let texts = ordered.map { texts(of: sheet.cells[$0])?.joined() ?? "" }
                    if let labels = ColumnHints.headerLabels(texts) {
                        for (position, label) in labels { hints[sheet.cells[ordered[position]].column] = label }
                    }
                }
                for (position, cellIndex) in ordered.enumerated() {
                    guard let units = texts(of: sheet.cells[cellIndex]) else { continue }
                    let hint = r > 0 ? hints[sheet.cells[cellIndex].column] : nil
                    content.addSegment(units, separator: position == ordered.count - 1 ? "\n" : "\t", hint: hint)
                    sources.append(.cell(sheet: s, cell: cellIndex))
                }
            }
            for (n, node) in sheet.headerFooter.enumerated() {
                content.addSegment([node.text], separator: "\n")
                sources.append(.headerFooter(sheet: s, node: n))
            }
        }
        for (p, part) in commentParts.enumerated() {
            for nodes in Self.commentTexts(in: part) where !nodes.isEmpty {
                content.addSegment(nodes.map(\.text), separator: "\n")
                sources.append(.comment(part: p, nodes: nodes))
            }
        }
        return (content, sources)
    }

    /// I testi dei commenti, uno per commento (classici: «<comment><text>…<t>»; nuovi: «<threadedComment><text>»).
    private static func commentTexts(in part: Part) -> [[TextNode]] {
        var result: [[TextNode]] = []
        var current: [TextNode]?
        let threaded = part.path.contains("threadedComments")
        for (index, tag) in part.tags.enumerated() {
            let local = tag.name.split(separator: ":").last.map(String.init) ?? tag.name
            if threaded {
                if local == "text", !tag.isEnd, let node = part.xml.textNode(at: index, in: part.tags) { result.append([node]) }
                continue
            }
            if local == "comment" {
                if tag.isEnd { result.append(current ?? []); current = nil } else if !tag.isSelfClosing { current = [] }
            } else if local == "t", !tag.isEnd, current != nil, let node = part.xml.textNode(at: index, in: part.tags) {
                current?.append(node)
            }
        }
        return result
    }

    /// Il file con le sostituzioni (`anonymized`: toglie anche metadati e autori).
    func applying(_ replacements: [Int: [SegmentedText.Replacement]], content: SegmentedText, sources: [Source],
                  anonymized: Bool) throws -> Data {
        var entries = self.entries
        var sharedEdits = XMLEdits()
        var sheetEdits = [XMLEdits](repeating: XMLEdits(), count: sheets.count)
        var commentEdits = [XMLEdits](repeating: XMLEdits(), count: commentParts.count)
        var sharedReplacements: [Int: [[SegmentedText.Replacement]]] = [:]

        for (segment, list) in replacements where !list.isEmpty {
            switch sources[segment] {
            case .cell(let s, let c):
                let sheet = sheets[s]
                switch sheet.cells[c].kind {
                case .shared(let index):
                    sharedReplacements[index, default: []].append(list)
                case .inline(let nodes):
                    let texts = SegmentedText.distribute(content.units[content.segments[segment]], list)
                    for (node, text) in zip(nodes, texts) { sheet.part.xml.edit(node, to: text, in: &sheetEdits[s]) }
                case .formulaText(let node):
                    let text = SegmentedText.distribute(content.units[content.segments[segment]], list).joined()
                    sheet.part.xml.edit(node, to: text, in: &sheetEdits[s])
                case .number(let cell, let end, _):
                    // Un numero da nascondere diventa testo in linea, con lo stesso stile.
                    let text = SegmentedText.distribute(content.units[content.segments[segment]], list).joined()
                    var tag = String(decoding: sheet.part.xml.bytes[cell.range], as: UTF8.self)
                        .replacingOccurrences(of: #"\s+t\s*=\s*"[^"]*""#, with: "", options: .regularExpression)
                    tag.insert(contentsOf: " t=\"inlineStr\"", at: tag.index(before: tag.endIndex))
                    let element = tag + "<\(sheet.part.name("is"))><\(sheet.part.name("t")) xml:space=\"preserve\">"
                    let closing = "</\(sheet.part.name("t"))></\(sheet.part.name("is"))></\(sheet.part.name("c"))>"
                    sheetEdits[s].replace(cell.range.lowerBound..<end, with: Array(element.utf8) + XMLBytes.escape(text) + Array(closing.utf8))
                }
            case .headerFooter(let s, let n):
                let node = sheets[s].headerFooter[n]
                let text = SegmentedText.distribute(content.units[content.segments[segment]], list).joined()
                sheets[s].part.xml.edit(node, to: text, in: &sheetEdits[s])
            case .comment(let p, let nodes):
                let texts = SegmentedText.distribute(content.units[content.segments[segment]], list)
                for (node, text) in zip(nodes, texts) { commentParts[p].xml.edit(node, to: text, in: &commentEdits[p]) }
            }
        }
        if let sharedPart {
            for (index, lists) in sharedReplacements where index < sharedItems.count {
                let nodes = sharedItems[index]
                let texts = SegmentedText.distribute(nodes.map(\.text)[...], SegmentedText.merge(lists))
                for (node, text) in zip(nodes, texts) { sharedPart.xml.edit(node, to: text, in: &sharedEdits) }
            }
            if !sharedEdits.isEmpty { entries.replace(sharedPart.path, with: Data(sharedEdits.applied(to: sharedPart.xml.bytes))) }
        }
        for (s, sheet) in sheets.enumerated() where !sheetEdits[s].isEmpty {
            entries.replace(sheet.part.path, with: Data(sheetEdits[s].applied(to: sheet.part.xml.bytes)))
        }
        for (p, part) in commentParts.enumerated() {
            if anonymized {
                // Gli autori dei commenti: «<author>Mario Rossi</author>».
                for (index, tag) in part.tags.enumerated() where !tag.isEnd && (tag.name.split(separator: ":").last ?? "") == "author" {
                    if let node = part.xml.textNode(at: index, in: part.tags), !node.text.isEmpty {
                        part.xml.edit(node, to: "Autore", in: &commentEdits[p])
                    }
                }
            }
            if !commentEdits[p].isEmpty { entries.replace(part.path, with: Data(commentEdits[p].applied(to: part.xml.bytes))) }
        }
        if anonymized {
            OfficeMetadata.neutralize(&entries)
            for entry in entries where entry.name.hasPrefix("xl/persons/") && entry.name.hasSuffix(".xml") {
                let xml = XMLBytes(entry.data)
                var edits = XMLEdits()
                OfficeMetadata.neutralizeAuthors(in: xml, tags: xml.tags(), attributes: ["displayName", "userId"], edits: &edits)
                if !edits.isEmpty { entries.replace(entry.name, with: Data(edits.applied(to: xml.bytes))) }
            }
        }
        return try ZipArchive.write(entries)
    }

    // MARK: Anteprima

    /// I fogli come tabelle (al massimo `maxRows` righe e `maxColumns` colonne).
    func preview(maxRows: Int = 200, maxColumns: Int = 40) -> [PreviewSheet] {
        sheets.map { sheet in
            var grid: [[String]] = []
            let rows = Dictionary(grouping: sheet.cells, by: \.row).sorted { $0.key < $1.key }.prefix(maxRows)
            let columns = min(maxColumns, (sheet.cells.map(\.column).max() ?? -1) + 1)
            for row in rows {
                var line = [String](repeating: "", count: columns)
                for cell in row.value where cell.column < columns { line[cell.column] = texts(of: cell)?.joined() ?? "" }
                grid.append(line)
            }
            return PreviewSheet(name: sheet.name, rows: grid)
        }
    }
}
