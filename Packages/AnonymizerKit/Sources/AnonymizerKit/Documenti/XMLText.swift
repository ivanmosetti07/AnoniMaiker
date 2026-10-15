import Foundation

// MARK: - XML a byte: i tag, il testo, le modifiche chirurgiche
//
// I file di Office si riscrivono toccando solo il testo: si scorrono i tag in ordine (saltando commenti, CDATA e
// istruzioni), si leggono i contenuti dei nodi di testo e i valori degli attributi, e si sostituiscono solo quei byte.
// Tutto il resto (formattazione, stili, namespace, spazi) resta identico.

struct XMLTag: Sendable {
    /// Nome qualificato («w:t», «si»).
    let name: String
    /// I byte dell'intero tag, da «<» a «>».
    let range: Range<Int>
    let isEnd: Bool
    let isSelfClosing: Bool
}

struct XMLBytes: Sendable {
    var bytes: [UInt8]

    init(_ data: Data) {
        bytes = [UInt8](data)
    }

    var data: Data { Data(bytes) }

    /// Tutti i tag, nell'ordine del file.
    func tags() -> [XMLTag] {
        var tags: [XMLTag] = []
        let n = bytes.count
        var i = 0
        while i < n {
            guard bytes[i] == 0x3C else { i += 1; continue }                    // «<»
            if i + 1 < n, bytes[i + 1] == 0x21 {                                  // «<!»
                if matches("<!--", at: i) { i = find("-->", from: i + 4).map { $0 + 3 } ?? n; continue }
                if matches("<![CDATA[", at: i) { i = find("]]>", from: i + 9).map { $0 + 3 } ?? n; continue }
                i = find(">", from: i).map { $0 + 1 } ?? n
                continue
            }
            if i + 1 < n, bytes[i + 1] == 0x3F {                                  // «<?»
                i = find("?>", from: i + 2).map { $0 + 2 } ?? n
                continue
            }
            let isEnd = i + 1 < n && bytes[i + 1] == 0x2F
            var j = i + (isEnd ? 2 : 1)
            let nameStart = j
            while j < n, !isSpace(bytes[j]), bytes[j] != 0x2F, bytes[j] != 0x3E { j += 1 }
            let name = String(decoding: bytes[nameStart..<j], as: UTF8.self)
            // Fino al «>» che chiude il tag, saltando quelli tra virgolette.
            var quote: UInt8 = 0
            while j < n {
                let byte = bytes[j]
                if quote != 0 {
                    if byte == quote { quote = 0 }
                } else if byte == 0x22 || byte == 0x27 {
                    quote = byte
                } else if byte == 0x3E {
                    break
                }
                j += 1
            }
            guard j < n else { break }
            tags.append(XMLTag(name: name, range: i..<(j + 1), isEnd: isEnd, isSelfClosing: !isEnd && bytes[j - 1] == 0x2F))
            i = j + 1
        }
        return tags
    }

    /// Gli attributi di un tag: nome → (valore decodificato, byte del valore senza virgolette, virgoletta usata).
    func attributes(of tag: XMLTag) -> [String: (value: String, range: Range<Int>, quote: UInt8)] {
        var result: [String: (String, Range<Int>, UInt8)] = [:]
        var j = tag.range.lowerBound + 1 + (tag.isEnd ? 1 : 0) + tag.name.utf8.count
        let end = tag.range.upperBound - 1
        while j < end {
            while j < end, isSpace(bytes[j]) { j += 1 }
            let nameStart = j
            while j < end, bytes[j] != 0x3D, !isSpace(bytes[j]), bytes[j] != 0x2F, bytes[j] != 0x3E { j += 1 }
            let name = String(decoding: bytes[nameStart..<j], as: UTF8.self)
            while j < end, isSpace(bytes[j]) { j += 1 }
            guard j < end, bytes[j] == 0x3D else { j += 1; continue }
            j += 1
            while j < end, isSpace(bytes[j]) { j += 1 }
            guard j < end, bytes[j] == 0x22 || bytes[j] == 0x27 else { continue }
            let quote = bytes[j]
            let valueStart = j + 1
            j = valueStart
            while j < end, bytes[j] != quote { j += 1 }
            if !name.isEmpty { result[name] = (decode(valueStart..<j), valueStart..<j, quote) }
            j += 1
        }
        return result
    }

    /// Il testo di un intervallo, con le entità XML risolte.
    func decode(_ range: Range<Int>) -> String {
        let raw = String(decoding: bytes[range], as: UTF8.self)
        return raw.contains("&") ? Self.unescape(raw) : raw
    }

    /// Il prefisso usato per un namespace nel tag radice («w» per WordprocessingML; "" se è quello di default).
    func prefix(for namespaces: [String], in tags: [XMLTag]) -> String? {
        guard let root = tags.first(where: { !$0.isEnd }) else { return nil }
        for (name, attribute) in attributes(of: root) where namespaces.contains(attribute.value) {
            if name == "xmlns" { return "" }
            if name.hasPrefix("xmlns:") { return String(name.dropFirst(6)) }
        }
        return nil
    }

    private func matches(_ text: String, at index: Int) -> Bool {
        let pattern = Array(text.utf8)
        guard index + pattern.count <= bytes.count else { return false }
        return Array(bytes[index..<(index + pattern.count)]) == pattern
    }

    private func find(_ text: String, from index: Int) -> Int? {
        let pattern = Array(text.utf8)
        guard !pattern.isEmpty, bytes.count >= pattern.count else { return nil }
        var i = index
        while i <= bytes.count - pattern.count {
            if bytes[i] == pattern[0], Array(bytes[i..<(i + pattern.count)]) == pattern { return i }
            i += 1
        }
        return nil
    }

    private func isSpace(_ byte: UInt8) -> Bool { byte == 0x20 || byte == 0x09 || byte == 0x0A || byte == 0x0D }

    // MARK: Entità

    static func unescape(_ text: String) -> String {
        var output = ""
        output.reserveCapacity(text.count)
        var index = text.startIndex
        while index < text.endIndex {
            let character = text[index]
            guard character == "&", let semicolon = text[index...].firstIndex(of: ";"),
                  text.distance(from: index, to: semicolon) <= 10 else {
                output.append(character)
                index = text.index(after: index)
                continue
            }
            let entity = text[text.index(after: index)..<semicolon]
            var replacement: String?
            switch entity {
            case "amp": replacement = "&"
            case "lt": replacement = "<"
            case "gt": replacement = ">"
            case "quot": replacement = "\""
            case "apos": replacement = "'"
            default:
                if entity.hasPrefix("#x") || entity.hasPrefix("#X") {
                    replacement = UInt32(entity.dropFirst(2), radix: 16).flatMap(Unicode.Scalar.init).map { String($0) }
                } else if entity.hasPrefix("#") {
                    replacement = UInt32(entity.dropFirst(1)).flatMap(Unicode.Scalar.init).map { String($0) }
                }
            }
            if let replacement {
                output += replacement
                index = text.index(after: semicolon)
            } else {
                output.append(character)
                index = text.index(after: index)
            }
        }
        return output
    }

    /// Testo da mettere dentro un elemento o un attributo.
    static func escape(_ text: String, quote: UInt8? = nil) -> [UInt8] {
        var output: [UInt8] = []
        output.reserveCapacity(text.utf8.count)
        for byte in text.utf8 {
            switch byte {
            case 0x26: output += Array("&amp;".utf8)
            case 0x3C: output += Array("&lt;".utf8)
            case 0x3E: output += Array("&gt;".utf8)
            case 0x22 where quote == 0x22: output += Array("&quot;".utf8)
            case 0x27 where quote == 0x27: output += Array("&apos;".utf8)
            default: output.append(byte)
            }
        }
        return output
    }
}

/// Sostituzioni di byte che non si sovrappongono, applicate in un passaggio solo.
struct XMLEdits: Sendable {
    private(set) var edits: [(range: Range<Int>, bytes: [UInt8])] = []

    var isEmpty: Bool { edits.isEmpty }

    mutating func replace(_ range: Range<Int>, with bytes: [UInt8]) {
        edits.append((range, bytes))
    }

    func applied(to source: [UInt8]) -> [UInt8] {
        guard !edits.isEmpty else { return source }
        var output: [UInt8] = []
        output.reserveCapacity(source.count + edits.reduce(0) { $0 + $1.bytes.count })
        var position = 0
        for edit in edits.sorted(by: { $0.range.lowerBound < $1.range.lowerBound }) where edit.range.lowerBound >= position {
            output += source[position..<edit.range.lowerBound]
            output += edit.bytes
            position = edit.range.upperBound
        }
        output += source[position...]
        return output
    }
}
