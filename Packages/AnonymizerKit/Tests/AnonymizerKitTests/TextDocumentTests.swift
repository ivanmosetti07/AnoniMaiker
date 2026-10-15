import Foundation
import Testing
@testable import AnonymizerKit

/// I file .txt e .md: si riscrivono con la stessa codifica, lo stesso BOM e gli stessi a-capo.
@Suite struct TextDocumentTests {
    @Test func utf8WithAndWithoutBOM() throws {
        let plain = try TextDocument.decode(Data("Città: Forlì\r\nRiga 2".utf8), kind: .plainText)
        #expect(plain.encoding == .utf8 && !plain.hasBOM && plain.text == "Città: Forlì\r\nRiga 2")
        #expect(plain.data() == Data("Città: Forlì\r\nRiga 2".utf8))

        let withBOM = try TextDocument.decode(Data([0xEF, 0xBB, 0xBF]) + Data("# Titolo".utf8), kind: .markdown)
        #expect(withBOM.hasBOM && withBOM.text == "# Titolo")
        #expect(withBOM.data() == Data([0xEF, 0xBB, 0xBF]) + Data("# Titolo".utf8))
    }

    @Test func utf16AndLegacyEncodings() throws {
        let utf16 = Data([0xFF, 0xFE]) + "Però".data(using: .utf16LittleEndian)!
        let document = try TextDocument.decode(utf16, kind: .plainText)
        #expect(document.encoding == .utf16LittleEndian && document.text == "Però" && document.data() == utf16)

        // Un file vecchio di Windows: «è» è un byte solo.
        let windows = "Perché è così".data(using: .windowsCP1252)!
        let legacy = try TextDocument.decode(windows, kind: .plainText)
        #expect(legacy.text == "Perché è così" && legacy.encoding == .windowsCP1252 && legacy.data() == windows)
    }

    /// Un dato vero che la codifica originale non ha: si salva in UTF-8 invece di perderlo.
    @Test func unrepresentableTextFallsBackToUTF8() throws {
        let document = TextDocument(text: "Nome: Łukasz Żółć", kind: .plainText, encoding: .windowsCP1252)
        #expect(String(data: document.data(), encoding: .utf8) == "Nome: Łukasz Żółć")
    }

    /// Il nome del file non deve tradire il cliente: i dati del dizionario diventano segnaposto anche lì.
    @Test func fileNamesDoNotLeakPersonalData() {
        var vault = Vault()
        vault.placeholder(label: "FULLNAME", value: "Mario Rossi")
        vault.placeholder(label: "ORG", value: "Edilnord S.r.l.")
        vault.placeholder(label: "DOCID", value: "Prot. 456/2024")
        let url = URL(filePath: "/tmp/Contratto Mario Rossi - Edilnord.md")
        let anonymized = DocumentNaming.anonymizedName(for: url, vault: vault, settings: AnonymizationSettings())
        #expect(anonymized == "Contratto [FULLNAME_1] - [ORG_1] (anonimizzato).md")
        #expect(DocumentNaming.revealedName(for: URL(filePath: "/tmp/" + anonymized), vault: vault)
                == "Contratto Mario Rossi - Edilnord S.r.l. (riconvertito).md")
        #expect(DocumentNaming.revealedName(for: URL(filePath: "/tmp/Atto [DOCID_1].txt"), vault: vault) == "Atto Prot. 456-2024 (riconvertito).txt")
    }

    @Test func outputNames() {
        let url = URL(filePath: "/tmp/Contratto Rossi.md")
        #expect(DocumentNaming.anonymizedName(for: url) == "Contratto Rossi (anonimizzato).md")
        #expect(DocumentNaming.revealedName(for: URL(filePath: "/tmp/Contratto Rossi (anonimizzato).md")) == "Contratto Rossi (riconvertito).md")
        #expect(DocumentNaming.revealedName(for: URL(filePath: "/tmp/risposta.txt")) == "risposta (riconvertito).txt")
        #expect(TextDocument.kind(of: URL(filePath: "/tmp/a.MD")) == .markdown && TextDocument.kind(of: URL(filePath: "/tmp/a.docx")) == nil)
    }
}
