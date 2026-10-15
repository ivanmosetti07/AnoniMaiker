import CoreGraphics
import CoreText
import Foundation
import PDFKit
import Vision

// MARK: - PDF: si legge il testo, si genera un PDF nuovo
//
// Un PDF non si riscrive come un file di Word: si legge il testo di ogni pagina (le pagine scansionate con l'OCR di
// Apple, sul Mac) e si genera un PDF nuovo, A4, con il testo anonimizzato o riconvertito, una sezione per pagina
// dell'originale. L'impaginazione è semplice; il contenuto è quello del documento.

enum PDFText {
    enum PDFError: LocalizedError {
        case unreadable
        case locked
        case noText

        var errorDescription: String? {
            switch self {
            case .unreadable: "Il PDF non si apre."
            case .locked: "Il PDF è protetto da password: aprilo, togli la protezione e riprova."
            case .noText: "Nel PDF non c'è testo leggibile, nemmeno con il riconoscimento del testo."
            }
        }
    }

    /// Il testo di ogni pagina; quelle senza testo (scansioni) si leggono con l'OCR. `recognized`: quante.
    static func pages(of data: Data, recognize: Bool = true) async throws -> (pages: [String], recognized: Int) {
        let (texts, images) = try extract(data, recognize: recognize)
        var pages = texts
        var recognized = 0
        for (index, image) in images {
            let text = try await Self.recognize(image)
            if !text.isEmpty {
                pages[index] = text
                recognized += 1
            }
        }
        return (pages, recognized)
    }

    /// Il testo delle pagine e le immagini di quelle da leggere con l'OCR.
    private static func extract(_ data: Data, recognize: Bool) throws -> ([String], [(Int, CGImage)]) {
        guard let document = PDFDocument(data: data) else { throw PDFError.unreadable }
        guard !document.isLocked else { throw PDFError.locked }
        var pages: [String] = []
        var images: [(Int, CGImage)] = []
        for index in 0..<document.pageCount {
            let page = document.page(at: index)
            let text = page?.string ?? ""
            pages.append(text)
            if recognize, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let page, let image = render(page) {
                images.append((index, image))
            }
        }
        return (pages, images)
    }

    /// La pagina come immagine a 144 dpi, su fondo bianco.
    static func render(_ page: PDFPage, scale: CGFloat = 2) -> CGImage? {
        let bounds = page.bounds(for: .mediaBox)
        let width = Int(bounds.width * scale), height = Int(bounds.height * scale)
        guard width > 0, height > 0,
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.scaleBy(x: scale, y: scale)
        page.draw(with: .mediaBox, to: context)
        return context.makeImage()
    }

    /// Il riconoscimento del testo di Apple (Vision), in italiano e in inglese, sul Mac.
    static func recognize(_ image: CGImage) async throws -> String {
        var request = RecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = [Locale.Language(identifier: "it-IT"), Locale.Language(identifier: "en-US")]
        let observations = try await request.perform(on: image)
        return observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }
}

enum PDFWriter {
    static let pageSize = CGRect(x: 0, y: 0, width: 595.28, height: 841.89)
    static let margin: CGFloat = 56

    /// Un PDF A4 con un testo per ogni pagina dell'originale (un testo lungo continua nelle pagine successive).
    static func make(pages: [String], title: String = "Documento") -> Data {
        let data = NSMutableData()
        var box = pageSize
        let info = [kCGPDFContextTitle as String: title, kCGPDFContextCreator as String: "AnoniMaiker"] as CFDictionary
        guard let consumer = CGDataConsumer(data: data as CFMutableData),
              let context = CGContext(consumer: consumer, mediaBox: &box, info) else { return Data() }
        let font = CTFontCreateWithName("Helvetica" as CFString, 10.5, nil)
        let small = CTFontCreateWithName("Helvetica" as CFString, 8, nil)
        let black = CGColor(gray: 0, alpha: 1)
        let gray = CGColor(gray: 0.45, alpha: 1)
        var spacing: CGFloat = 2.5
        let paragraph = withUnsafeBytes(of: &spacing) { pointer in
            [CTParagraphStyleSetting(spec: .lineSpacingAdjustment, valueSize: MemoryLayout<CGFloat>.size, value: pointer.baseAddress!)]
                .withUnsafeBufferPointer { CTParagraphStyleCreate($0.baseAddress, $0.count) }
        }
        let attributes: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): black,
            NSAttributedString.Key(kCTParagraphStyleAttributeName as String): paragraph,
        ]
        let frame = pageSize.insetBy(dx: margin, dy: margin)
        var number = 0
        for text in pages {
            let attributed = NSAttributedString(string: text.isEmpty ? " " : text, attributes: attributes)
            let framesetter = CTFramesetterCreateWithAttributedString(attributed)
            var location = 0
            repeat {
                context.beginPDFPage(nil)
                let laidOut = CTFramesetterCreateFrame(framesetter, CFRange(location: location, length: 0), CGPath(rect: frame, transform: nil), nil)
                CTFrameDraw(laidOut, context)
                number += 1
                let footer = NSAttributedString(string: "\(number)", attributes: [
                    NSAttributedString.Key(kCTFontAttributeName as String): small,
                    NSAttributedString.Key(kCTForegroundColorAttributeName as String): gray,
                ])
                let line = CTLineCreateWithAttributedString(footer)
                let width = CTLineGetTypographicBounds(line, nil, nil, nil)
                context.textPosition = CGPoint(x: (pageSize.width - width) / 2, y: margin / 2)
                CTLineDraw(line, context)
                context.endPDFPage()
                let visible = CTFrameGetVisibleStringRange(laidOut).length
                guard visible > 0 else { break }
                location += visible
            } while location < attributed.length
        }
        context.closePDF()
        return data as Data
    }
}
