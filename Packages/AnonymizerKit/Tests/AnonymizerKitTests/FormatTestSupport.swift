import Foundation
@testable import AnonymizerKit

/// Per le prove dei formati: un anonimizzatore con la sola rete regex (niente modello) e un dizionario usa e getta.
enum FormatTest {
    static func anonymizer() -> (Anonymizer, URL) {
        let directory = FileManager.default.temporaryDirectory.appending(path: "anonimizzatore-prove-\(UUID().uuidString)")
        return (Anonymizer(finder: RegexFinder(), store: VaultStore(directory: directory, protection: .file)), directory)
    }

    /// Un archivio Office fatto a mano: percorso → contenuto XML.
    static func office(_ parts: [(String, String)]) throws -> Data {
        try ZipArchive.write(parts.map { ZipEntry(name: $0.0, data: Data($0.1.utf8)) })
    }

    static func part(_ data: Data, _ name: String) throws -> String {
        let entries = try ZipArchive.read(data)
        guard let entry = entries[entry: name] else { return "" }
        return String(decoding: entry.data, as: UTF8.self)
    }

    static let contentTypes = #"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>"#
    static let rootRels = #"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#
    static let core = #"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Clienti Edilnord</dc:title><dc:creator>Ivan Prova</dc:creator><cp:lastModifiedBy>Ivan Prova</cp:lastModifiedBy></cp:coreProperties>"#
}
