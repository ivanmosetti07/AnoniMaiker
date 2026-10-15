import Foundation
import Testing
@testable import AnonymizerKit

/// Gli archivi ZIP e l'XML a byte: la base di Excel e Word.
@Suite struct ZipXMLTests {
    @Test func zipRoundTrip() throws {
        let text = String(repeating: "Mario Rossi, via Garibaldi 24. ", count: 200)
        let entries = [ZipEntry(name: "a.xml", data: Data(text.utf8)), ZipEntry(name: "cartella/b.bin", data: Data([0, 1, 2, 3]), method: 0),
                       ZipEntry(name: "vuoto.txt", data: Data())]
        let archive = try ZipArchive.write(entries)
        #expect(archive.count < text.utf8.count)                    // compresso
        let read = try ZipArchive.read(archive)
        #expect(read.map(\.name) == ["a.xml", "cartella/b.bin", "vuoto.txt"])
        #expect(read[entry: "a.xml"]?.data == Data(text.utf8) && read[entry: "cartella/b.bin"]?.data == Data([0, 1, 2, 3]))
        // Le voci che non cambiano si ricopiano identiche.
        #expect(try ZipArchive.write(read) == archive)
    }

    /// Un archivio fatto dagli strumenti di macOS (come quelli di Office): si legge.
    @Test func readsArchivesMadeByOtherTools() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: "zip-prova-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let source = directory.appending(path: "sorgente")
        try FileManager.default.createDirectory(at: source.appending(path: "xl"), withIntermediateDirectories: true)
        let body = String(repeating: "<row>Riga di prova</row>\n", count: 300)
        try Data(body.utf8).write(to: source.appending(path: "xl/foglio.xml"))
        try Data("ciao".utf8).write(to: source.appending(path: "nota.txt"))
        let archive = directory.appending(path: "prova.zip")
        let process = Process()
        process.executableURL = URL(filePath: "/usr/bin/ditto")
        process.arguments = ["-c", "-k", "--norsrc", "--noextattr", source.path, archive.path]
        try process.run()
        process.waitUntilExit()
        let entries = try ZipArchive.read(Data(contentsOf: archive))
        #expect(entries.first { $0.name.hasSuffix("xl/foglio.xml") }?.data == Data(body.utf8))
        #expect(entries.first { $0.name.hasSuffix("nota.txt") }?.data == Data("ciao".utf8))
    }

    @Test func corruptedArchivesAreRefused() throws {
        var archive = try ZipArchive.write([ZipEntry(name: "a.txt", data: Data(String(repeating: "abc", count: 50).utf8), method: 0)])
        // Un byte del contenuto cambiato: il CRC non torna.
        archive[40] ^= 0xFF
        #expect(throws: ZipArchive.ZipError.self) { try ZipArchive.read(archive) }
        #expect(throws: ZipArchive.ZipError.notAnArchive) { try ZipArchive.read(Data("non è uno zip".utf8)) }
    }

    @Test func xmlTagsAndText() {
        let source = #"<?xml version="1.0"?><!-- <w:t>no</w:t> --><w:p a="x > y"><w:r><w:t xml:space="preserve">Rossi &amp; C. &#233;</w:t></w:r><![CDATA[<w:t>no</w:t>]]><w:t/></w:p>"#
        let xml = XMLBytes(Data(source.utf8))
        let tags = xml.tags()
        #expect(tags.map(\.name) == ["w:p", "w:r", "w:t", "w:t", "w:r", "w:t", "w:p"])
        #expect(xml.attributes(of: tags[0])["a"]?.value == "x > y")
        let node = xml.textNode(at: 2, in: tags)
        #expect(node?.text == "Rossi & C. é" && tags[5].isSelfClosing)
        // Solo il testo cambia; il resto resta byte per byte.
        var edits = XMLEdits()
        xml.edit(node!, to: "[ORG_1] <ok>", in: &edits)
        let output = String(decoding: edits.applied(to: xml.bytes), as: UTF8.self)
        #expect(output == source.replacingOccurrences(of: "Rossi &amp; C. &#233;", with: "[ORG_1] &lt;ok&gt;"))
    }

    /// Spazi ai bordi: l'elemento li deve conservare.
    @Test func edgeSpacesArePreserved() {
        let xml = XMLBytes(Data("<w:t>Mario</w:t>".utf8))
        let tags = xml.tags()
        var edits = XMLEdits()
        xml.edit(xml.textNode(at: 0, in: tags)!, to: " [FULLNAME_1]", in: &edits)
        #expect(String(decoding: edits.applied(to: xml.bytes), as: UTF8.self) == #"<w:t xml:space="preserve"> [FULLNAME_1]</w:t>"#)
    }

    /// Un dato spezzato fra più nodi: il segnaposto va dove comincia, il resto sparisce.
    @Test func replacementsAcrossUnits() {
        let units = ["Gentile Mario ", "Rossi", ", a presto"]
        let result = SegmentedText.distribute(units[...], [.init(start: 8, end: 19, text: "[FULLNAME_1]")])
        #expect(result == ["Gentile [FULLNAME_1]", "", ", a presto"])
        #expect(SegmentedText.merge([[.init(start: 0, end: 5, text: "A")], [.init(start: 0, end: 11, text: "B"), .init(start: 12, end: 14, text: "C")]])
                == [.init(start: 0, end: 11, text: "B"), .init(start: 12, end: 14, text: "C")])
    }

    @Test func columnHeaders() {
        #expect(ColumnHints.label(forHeader: "E-mail") == "EMAIL" && ColumnHints.label(forHeader: "Cell.") == "TELEPHONENUM")
        #expect(ColumnHints.label(forHeader: "Nome azienda") == "ORG" && ColumnHints.label(forHeader: "Cognome") == "FULLNAME")
        #expect(ColumnHints.label(forHeader: "C.F.") == "CF" && ColumnHints.label(forHeader: "P.IVA") == "PIVA")
        #expect(ColumnHints.label(forHeader: "Importo") == nil && ColumnHints.label(forHeader: "Inviato") == nil)
        #expect(ColumnHints.headerLabels(["Nome", "Email", "Importo"]) == [0: "FULLNAME", 1: "EMAIL"])
        #expect(ColumnHints.headerLabels(["Mario", "mario@x.it", "12"]) == nil)
        #expect(!ColumnHints.accepts("n/d", as: "EMAIL") && ColumnHints.accepts("Rossi", as: "FULLNAME"))
    }
}
