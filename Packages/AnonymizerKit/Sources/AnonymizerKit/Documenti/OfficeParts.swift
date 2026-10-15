import Foundation

// MARK: - Pezzi comuni ai file di Office
//
// Nodi di testo, modifiche dei nodi (con `xml:space="preserve"` se servono gli spazi ai bordi), percorsi delle parti e
// pulizia dei metadati: nel file anonimizzato non restano autore, ultimo autore, società e titolo.

/// Il contenuto di un elemento di testo («<w:t>», «<t>»).
struct TextNode: Sendable {
    let startTag: XMLTag
    let content: Range<Int>
    let text: String
}

/// Il valore di un attributo (per esempio l'indirizzo di un collegamento).
struct AttributeNode: Sendable {
    let range: Range<Int>
    let quote: UInt8
    let text: String
}

extension XMLBytes {
    /// Il nome qualificato con il prefisso del namespace («w:t», o «t» senza prefisso).
    static func qualified(_ prefix: String, _ local: String) -> String {
        prefix.isEmpty ? local : "\(prefix):\(local)"
    }

    /// Il nodo di testo che comincia con il tag `index` (il successivo è la sua chiusura).
    func textNode(at index: Int, in tags: [XMLTag]) -> TextNode? {
        let tag = tags[index]
        guard !tag.isEnd, !tag.isSelfClosing, index + 1 < tags.count else { return nil }
        let content = tag.range.upperBound..<tags[index + 1].range.lowerBound
        return TextNode(startTag: tag, content: content, text: decode(content))
    }

    /// Riscrive un nodo di testo; se il testo nuovo ha spazi ai bordi, l'elemento li deve conservare.
    func edit(_ node: TextNode, to text: String, in edits: inout XMLEdits) {
        guard text != node.text else { return }
        edits.replace(node.content, with: XMLBytes.escape(text))
        let edges = text.first.map(\.isWhitespace) == true || text.last.map(\.isWhitespace) == true
        guard edges, attributes(of: node.startTag)["xml:space"] == nil else { return }
        var tag = Array(bytes[node.startTag.range])
        tag.insert(contentsOf: Array(" xml:space=\"preserve\"".utf8), at: tag.count - 1)
        edits.replace(node.startTag.range, with: tag)
    }

    func edit(_ node: AttributeNode, to text: String, in edits: inout XMLEdits) {
        guard text != node.text else { return }
        edits.replace(node.range, with: XMLBytes.escape(text, quote: node.quote))
    }
}

enum OfficePaths {
    /// Il percorso di una parte a cui punta una relazione («worksheets/sheet1.xml» accanto a «xl/workbook.xml»).
    static func resolve(_ target: String, relativeTo part: String) -> String {
        if target.hasPrefix("/") { return String(target.dropFirst()) }
        var components = part.split(separator: "/").dropLast().map(String.init)
        for component in target.split(separator: "/").map(String.init) {
            if component == ".." { _ = components.popLast() } else if component != "." { components.append(component) }
        }
        return components.joined(separator: "/")
    }

    /// Le relazioni di una parte: Id → (Type, Target, esterna?).
    static func relationships(of part: String, in entries: [ZipEntry]) -> [String: (type: String, target: String, external: Bool)] {
        let components = part.split(separator: "/").map(String.init)
        let relsPath = (components.dropLast() + ["_rels", (components.last ?? "") + ".rels"]).joined(separator: "/")
        guard let entry = entries[entry: relsPath] else { return [:] }
        let xml = XMLBytes(entry.data)
        var result: [String: (String, String, Bool)] = [:]
        for tag in xml.tags() where !tag.isEnd && tag.name.hasSuffix("Relationship") {
            let attributes = xml.attributes(of: tag)
            guard let id = attributes["Id"]?.value, let target = attributes["Target"]?.value else { continue }
            result[id] = (attributes["Type"]?.value ?? "", target, attributes["TargetMode"]?.value == "External")
        }
        return result
    }
}

enum OfficeMetadata {
    /// Toglie autore, ultimo autore, titolo, oggetto, parole chiave, società e responsabile dalle proprietà.
    static func neutralize(_ entries: inout [ZipEntry]) {
        clear(in: "docProps/core.xml", locals: ["creator", "lastModifiedBy", "title", "subject", "description", "keywords", "category"],
              entries: &entries)
        clear(in: "docProps/app.xml", locals: ["Company", "Manager", "HyperlinkBase"], entries: &entries)
    }

    private static func clear(in path: String, locals: Set<String>, entries: inout [ZipEntry]) {
        guard let entry = entries[entry: path] else { return }
        let xml = XMLBytes(entry.data)
        let tags = xml.tags()
        var edits = XMLEdits()
        for (index, tag) in tags.enumerated() where !tag.isEnd && !tag.isSelfClosing {
            let local = tag.name.split(separator: ":").last.map(String.init) ?? tag.name
            guard locals.contains(local), let node = xml.textNode(at: index, in: tags), !node.text.isEmpty else { continue }
            edits.replace(node.content, with: [])
        }
        if !edits.isEmpty { entries.replace(path, with: Data(edits.applied(to: xml.bytes))) }
    }

    /// Gli autori di commenti e revisioni diventano «Autore».
    static func neutralizeAuthors(in xml: XMLBytes, tags: [XMLTag], attributes names: Set<String>, edits: inout XMLEdits) {
        for tag in tags where !tag.isEnd {
            for (name, attribute) in xml.attributes(of: tag) where names.contains(name) && !attribute.value.isEmpty {
                let replacement = name.hasSuffix("initials") ? "A" : name.lowercased().hasSuffix("userid") ? "" : "Autore"
                if attribute.value != replacement { edits.replace(attribute.range, with: Array(replacement.utf8)) }
            }
        }
    }
}
