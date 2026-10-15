import Foundation

// MARK: - Word (.docx): il testo cambia, la formattazione resta
//
// Un paragrafo di Word è spezzato in «run», ognuno con la sua formattazione («Mario » normale, «Rossi» in grassetto).
// Il motore legge il paragrafo intero; il segnaposto va nel run dove il dato comincia e ne prende la formattazione, il
// resto del dato sparisce dai run successivi. Si leggono il corpo, intestazioni e piè di pagina, note, commenti, il testo
// cancellato con le revisioni e i codici dei campi; anche gli indirizzi dei collegamenti («mailto:…»). Nel file
// anonimizzato gli autori di commenti e revisioni diventano «Autore».

struct WordFile: Sendable {
    static let namespaces = ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"]

    struct Part: Sendable {
        let path: String
        let xml: XMLBytes
        let tags: [XMLTag]
        let prefix: String

        func name(_ local: String) -> String { XMLBytes.qualified(prefix, local) }
    }

    enum Unit: Sendable {
        case text(part: Int, node: TextNode)
        case attribute(part: Int, node: AttributeNode)
    }

    private(set) var entries: [ZipEntry]
    private let parts: [Part]
    /// Le relazioni esterne (collegamenti): la parte .rels e i suoi «Target».
    private let relationshipParts: [(path: String, xml: XMLBytes, targets: [AttributeNode])]

    init(data: Data) throws {
        let entries = try ZipArchive.read(data)
        self.entries = entries
        guard entries[entry: "word/document.xml"] != nil else { throw ZipArchive.ZipError.unsupported("manca word/document.xml") }
        let textParts = entries.map(\.name).filter { name in
            guard name.hasPrefix("word/"), name.hasSuffix(".xml"), !name.contains("/_rels/") else { return false }
            let file = name.split(separator: "/").last.map(String.init) ?? name
            return file == "document.xml" || file.hasPrefix("header") || file.hasPrefix("footer") || file == "footnotes.xml"
                || file == "endnotes.xml" || file == "comments.xml" || name == "word/glossary/document.xml"
        }.sorted { a, b in
            // Il corpo prima di tutto, poi il resto in ordine.
            a == "word/document.xml" ? true : b == "word/document.xml" ? false : a < b
        }
        parts = textParts.compactMap { path in
            guard let entry = entries[entry: path] else { return nil }
            let xml = XMLBytes(entry.data)
            let tags = xml.tags()
            return Part(path: path, xml: xml, tags: tags, prefix: xml.prefix(for: Self.namespaces, in: tags) ?? "w")
        }
        relationshipParts = entries.filter { $0.name.hasPrefix("word/_rels/") && $0.name.hasSuffix(".rels") }.map { entry in
            let xml = XMLBytes(entry.data)
            var targets: [AttributeNode] = []
            for tag in xml.tags() where !tag.isEnd && tag.name.hasSuffix("Relationship") {
                let attributes = xml.attributes(of: tag)
                guard attributes["TargetMode"]?.value == "External", let target = attributes["Target"] else { continue }
                targets.append(AttributeNode(range: target.range, quote: target.quote, text: target.value))
            }
            return (entry.name, xml, targets)
        }
    }

    // MARK: Segmenti

    /// Paragrafi (fatti di run), codici dei campi e indirizzi dei collegamenti, ognuno un segmento.
    func segmented() -> (content: SegmentedText, units: [Unit]) {
        var content = SegmentedText()
        var units: [Unit] = []
        for (p, part) in parts.enumerated() {
            var current: [(String, Unit)] = []
            func close(_ separator: String) {
                guard !current.isEmpty else { return }
                content.addSegment(current.map(\.0), separator: separator)
                units += current.map(\.1)
                current = []
            }
            let paragraph = part.name("p")
            let breaks: Set<String> = [part.name("tab"), part.name("br"), part.name("cr"), part.name("ptab")]
            // Il testo cancellato con le revisioni e i codici dei campi non fanno parte del testo visibile: segmenti a sé,
            // altrimenti si attaccherebbero alle parole vicine («…123456vecchia@mail.it»).
            let apart: Set<String> = [part.name("delText"), part.name("instrText")]
            for (index, tag) in part.tags.enumerated() {
                if tag.name == paragraph {
                    close("\n")
                } else if breaks.contains(tag.name), !tag.isEnd {
                    close(tag.name == part.name("tab") || tag.name == part.name("ptab") ? "\t" : "\n")
                } else if tag.name == part.name("t"), !tag.isEnd, let node = part.xml.textNode(at: index, in: part.tags) {
                    current.append((node.text, .text(part: p, node: node)))
                } else if apart.contains(tag.name), !tag.isEnd, let node = part.xml.textNode(at: index, in: part.tags) {
                    close(" ")
                    content.addSegment([node.text], separator: " ")
                    units.append(.text(part: p, node: node))
                } else if !tag.isEnd, tag.name == part.name("fldSimple"),
                          let instruction = part.xml.attributes(of: tag)[part.name("instr")] {
                    content.addSegment([instruction.value], separator: " ")
                    units.append(.attribute(part: p, node: AttributeNode(range: instruction.range, quote: instruction.quote, text: instruction.value)))
                }
            }
            close("\n")
        }
        for (r, relationships) in relationshipParts.enumerated() {
            for target in relationships.targets {
                content.addSegment([target.text], separator: "\n")
                units.append(.attribute(part: parts.count + r, node: target))
            }
        }
        return (content, units)
    }

    /// Il file con le sostituzioni (`anonymized`: toglie anche metadati e autori).
    func applying(_ replacements: [Int: [SegmentedText.Replacement]], content: SegmentedText, units: [Unit],
                  anonymized: Bool) throws -> Data {
        var entries = self.entries
        var edits = [XMLEdits](repeating: XMLEdits(), count: parts.count + relationshipParts.count)
        let texts = content.applying(replacements)
        for (index, unit) in units.enumerated() where texts[index] != content.units[index] {
            switch unit {
            case .text(let p, let node):
                parts[p].xml.edit(node, to: texts[index], in: &edits[p])
            case .attribute(let p, let node):
                let xml = p < parts.count ? parts[p].xml : relationshipParts[p - parts.count].xml
                xml.edit(node, to: texts[index], in: &edits[p])
            }
        }
        if anonymized {
            for (p, part) in parts.enumerated() {
                OfficeMetadata.neutralizeAuthors(in: part.xml, tags: part.tags, attributes: [part.name("author"), part.name("initials")],
                                                 edits: &edits[p])
            }
        }
        for (p, part) in parts.enumerated() where !edits[p].isEmpty {
            entries.replace(part.path, with: Data(edits[p].applied(to: part.xml.bytes)))
        }
        for (r, relationships) in relationshipParts.enumerated() where !edits[parts.count + r].isEmpty {
            entries.replace(relationships.path, with: Data(edits[parts.count + r].applied(to: relationships.xml.bytes)))
        }
        if anonymized {
            OfficeMetadata.neutralize(&entries)
            // Le persone che hanno commentato o modificato: «word/people.xml».
            if let people = entries[entry: "word/people.xml"] {
                let xml = XMLBytes(people.data)
                var personEdits = XMLEdits()
                OfficeMetadata.neutralizeAuthors(in: xml, tags: xml.tags(), attributes: ["w15:author", "w15:userId"], edits: &personEdits)
                if !personEdits.isEmpty { entries.replace("word/people.xml", with: Data(personEdits.applied(to: xml.bytes))) }
            }
        }
        return try ZipArchive.write(entries)
    }

    /// Il testo del documento (corpo, poi intestazioni, note, commenti), un paragrafo per riga.
    var plainText: String {
        let (content, units) = segmented()
        var lines: [String] = []
        var line = ""
        for segment in content.segments.indices {
            // Solo il testo visibile: niente codici dei campi, testo cancellato o collegamenti.
            guard case .text(let p, let node) = units[content.segments[segment].lowerBound],
                  node.startTag.name == parts[p].name("t") else { continue }
            line += content.text(of: segment)
            if content.separators[segment] == "\n" {
                lines.append(line)
                line = ""
            } else {
                line += content.separators[segment]
            }
        }
        if !line.isEmpty { lines.append(line) }
        return lines.joined(separator: "\n")
    }
}
