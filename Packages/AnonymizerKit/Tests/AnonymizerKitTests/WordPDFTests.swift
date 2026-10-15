import AppKit
import CoreText
import Foundation
import PDFKit
import Testing
@testable import AnonymizerKit

/// Word (la formattazione resta) e PDF (testo, OCR, PDF nuovo).
@Suite struct WordPDFTests {
    // MARK: Word

    static func document() throws -> Data {
        let w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        let r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        let body = #"""
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:document xmlns:w="\#(w)" xmlns:r="\#(r)"><w:body>
        <w:p><w:r><w:t xml:space="preserve">Scrivere a </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>mario.rossi@</w:t></w:r><w:r><w:t>edilnord.it</w:t></w:r><w:r><w:t xml:space="preserve"> entro venerdì.</w:t></w:r></w:p>
        <w:p><w:r><w:t>Email:</w:t></w:r><w:r><w:tab/><w:t>anna@neri.it</w:t></w:r></w:p>
        <w:p><w:ins w:id="1" w:author="Ivan Prova" w:date="2026-10-15T10:00:00Z"><w:r><w:t>IBAN IT60X0542811101000000123456</w:t></w:r></w:ins><w:del w:id="2" w:author="Ivan Prova"><w:r><w:delText>vecchia@mail.it</w:delText></w:r></w:del></w:p>
        <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:luca@studio.it" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Luca</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> oppure </w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t>scrivici</w:t></w:r></w:hyperlink></w:p>
        </w:body></w:document>
        """#
        return try FormatTest.office([
            ("[Content_Types].xml", FormatTest.contentTypes),
            ("_rels/.rels", FormatTest.rootRels),
            ("docProps/core.xml", FormatTest.core),
            ("word/document.xml", body),
            ("word/_rels/document.xml.rels", #"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="\#(r)/hyperlink" Target="mailto:info@edilnord.it" TargetMode="External"/><Relationship Id="rId6" Type="\#(r)/header" Target="header1.xml"/></Relationships>"#),
            ("word/header1.xml", #"<?xml version="1.0"?><w:hdr xmlns:w="\#(w)"><w:p><w:r><w:t>Riservato – contatto luca@studio.it</w:t></w:r></w:p></w:hdr>"#),
            ("word/comments.xml", #"<?xml version="1.0"?><w:comments xmlns:w="\#(w)"><w:comment w:id="0" w:author="Ivan Prova" w:initials="IP"><w:p><w:r><w:t>Chiedere il CF RSSMRA85H12F205Y</w:t></w:r></w:p></w:comment></w:comments>"#),
        ])
    }

    @Test func wordKeepsTheFormatting() async throws {
        let (anonymizer, directory) = FormatTest.anonymizer()
        defer { try? FileManager.default.removeItem(at: directory) }
        let source = try Self.document()
        let outcome = try await anonymizer.anonymizeFile(source, format: .docx)
        let body = try FormatTest.part(outcome.data, "word/document.xml")
        // L'email spezzata in due run: il segnaposto nel primo (in grassetto), il secondo resta vuoto.
        #expect(body.contains("<w:rPr><w:b/></w:rPr><w:t>[EMAIL_1]</w:t></w:r><w:r><w:t></w:t></w:r>"))
        #expect(body.contains(#"<w:t xml:space="preserve"> entro venerdì.</w:t>"#))
        #expect(body.contains("<w:tab/><w:t>[EMAIL_2]</w:t>"))
        #expect(body.contains("<w:t>IBAN [IBAN_1]</w:t>") && body.contains("<w:delText>[EMAIL_3]</w:delText>"))
        #expect(body.contains(#"HYPERLINK "mailto:[EMAIL_4]" "#) && body.contains("<w:t>Luca</w:t>"))
        #expect(!body.contains("Ivan Prova") && body.contains(#"w:author="Autore""#))
        #expect(try FormatTest.part(outcome.data, "word/_rels/document.xml.rels").contains(#"Target="mailto:[EMAIL_5]""#))
        #expect(try FormatTest.part(outcome.data, "word/header1.xml").contains("contatto [EMAIL_4]"))
        let comments = try FormatTest.part(outcome.data, "word/comments.xml")
        #expect(comments.contains("Chiedere il CF [CF_1]") && comments.contains(#"w:author="Autore" w:initials="A""#))
        #expect(!(try FormatTest.part(outcome.data, "docProps/core.xml")).contains("Ivan"))
        guard case .text(let preview) = outcome.preview else { Issue.record("anteprima"); return }
        #expect(preview.hasPrefix("Scrivere a [EMAIL_1] entro venerdì.\nEmail:\t[EMAIL_2]"))

        let back = try await FileReveal.reveal(outcome.data, format: .docx, vault: anonymizer.store.snapshot())
        let revealed = try FormatTest.part(back.data, "word/document.xml")
        #expect(revealed.contains("<w:rPr><w:b/></w:rPr><w:t>mario.rossi@edilnord.it</w:t></w:r><w:r><w:t></w:t></w:r>"))
        #expect(revealed.contains("IT60X0542811101000000123456") && revealed.contains("mailto:luca@studio.it"))
        #expect(try FormatTest.part(back.data, "word/_rels/document.xml.rels").contains("mailto:info@edilnord.it"))
        #expect(back.reveal?.unknown.isEmpty == true)
    }

    /// Un .docx scritto da macOS (come quelli di Pages o TextEdit): anonimizzato resta un .docx che macOS sa aprire.
    @Test func wordFilesWrittenByMacOS() async throws {
        let (anonymizer, directory) = FormatTest.anonymizer()
        defer { try? FileManager.default.removeItem(at: directory) }
        let text = NSMutableAttributedString(string: "Contratto per ", attributes: [.font: NSFont.systemFont(ofSize: 12)])
        text.append(NSAttributedString(string: "mario.rossi@edilnord.it", attributes: [.font: NSFont.boldSystemFont(ofSize: 12)]))
        text.append(NSAttributedString(string: "\nIBAN: IT60X0542811101000000123456\nImporto: 12.500,00 €", attributes: [.font: NSFont.systemFont(ofSize: 12)]))
        let source = try text.data(from: NSRange(location: 0, length: text.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.officeOpenXML])

        let outcome = try await anonymizer.anonymizeFile(source, format: .docx)
        func read(_ data: Data) throws -> NSAttributedString {
            try NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.officeOpenXML], documentAttributes: nil)
        }
        // macOS, rileggendo un .docx, aggiunge un a-capo finale: si confronta con l'originale riletto allo stesso modo.
        let original = try read(source)
        let reopened = try read(outcome.data)
        #expect(reopened.string == original.string.replacingOccurrences(of: "mario.rossi@edilnord.it", with: "[EMAIL_1]")
            .replacingOccurrences(of: "IT60X0542811101000000123456", with: "[IBAN_1]"), "Riaperto: \(reopened.string.debugDescription)")
        // Il segnaposto ha la formattazione del dato (grassetto).
        let range = (reopened.string as NSString).range(of: "[EMAIL_1]")
        let font = reopened.attribute(.font, at: range.location, effectiveRange: nil) as? NSFont
        #expect(font?.fontDescriptor.symbolicTraits.contains(.bold) == true)

        let back = try await FileReveal.reveal(outcome.data, format: .docx, vault: anonymizer.store.snapshot())
        let revealed = try read(back.data)
        #expect(revealed.string == original.string, "Riconvertito: \(revealed.string.debugDescription)")
    }

    // MARK: PDF

    @Test func pdfTextAnonymizedIntoANewPDF() async throws {
        let (anonymizer, directory) = FormatTest.anonymizer()
        defer { try? FileManager.default.removeItem(at: directory) }
        let source = PDFWriter.make(pages: ["Contratto di fornitura\nReferente: mario.rossi@edilnord.it",
                                            "Pagamento su IBAN IT60X0542811101000000123456 entro il 30/11/2026."])
        let (pages, recognized) = try await PDFText.pages(of: source, recognize: false)
        #expect(pages.count == 2 && recognized == 0 && pages[0].contains("mario.rossi@edilnord.it"))

        let outcome = try await anonymizer.anonymizeFile(source, format: .pdf)
        let output = try await PDFText.pages(of: outcome.data, recognize: false).pages
        #expect(output.count == 2 && output[0].contains("[EMAIL_1]") && !output[0].contains("edilnord"))
        #expect(output[1].contains("[IBAN_1]") && output[1].contains("30/11/2026"))
        let back = try await FileReveal.reveal(outcome.data, format: .pdf, vault: anonymizer.store.snapshot())
        let revealed = try await PDFText.pages(of: back.data, recognize: false).pages
        #expect(revealed[0].contains("mario.rossi@edilnord.it") && revealed[1].contains("IT60X0542811101000000123456"))
    }

    /// Una pagina scansionata (solo un'immagine): il testo si legge con l'OCR di Apple, sul Mac.
    @Test func scannedPagesAreRead() async throws {
        // L'«immagine» di una pagina con del testo.
        let width = 1240, height = 600
        let bitmap = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                               space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        bitmap.setFillColor(CGColor(gray: 1, alpha: 1))
        bitmap.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: "Contratto firmato da Mario Rossi", attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Helvetica" as CFString, 56, nil),
        ]))
        bitmap.textPosition = CGPoint(x: 60, y: 280)
        CTLineDraw(line, bitmap)
        let image = bitmap.makeImage()!
        // Un PDF con dentro solo l'immagine.
        let data = NSMutableData()
        var box = CGRect(x: 0, y: 0, width: 620, height: 300)
        let pdf = CGContext(consumer: CGDataConsumer(data: data as CFMutableData)!, mediaBox: &box, nil)!
        pdf.beginPDFPage(nil)
        pdf.draw(image, in: box)
        pdf.endPDFPage()
        pdf.closePDF()

        let (pages, recognized) = try await PDFText.pages(of: data as Data)
        #expect(recognized == 1)
        #expect(pages.first?.localizedCaseInsensitiveContains("Mario Rossi") == true, "Letto: \(pages.first ?? "")")
    }

    @Test func unsupportedFormatsExplainWhatToDo() {
        #expect(DocumentFormat.of(URL(filePath: "/tmp/a.DOCX")) == .docx && DocumentFormat.of(URL(filePath: "/tmp/a.tsv")) == .csv)
        #expect(DocumentFormat.of(URL(filePath: "/tmp/a.doc")) == nil)
        #expect(DocumentFormat.FormatError.unsupported("xls").errorDescription?.contains(".xlsx") == true)
    }
}
