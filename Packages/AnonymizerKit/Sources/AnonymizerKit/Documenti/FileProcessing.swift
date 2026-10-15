import Foundation

// MARK: - Tutti i formati, una porta sola
//
// Testo e Markdown, CSV ed Excel (cella per cella), Word (con la formattazione), PDF (con l'OCR per le scansioni e un
// PDF nuovo in uscita). Anonimizzare, riconvertire e mostrare un'anteprima passano tutti da qui.

public enum DocumentFormat: String, Codable, Sendable, CaseIterable {
    case plainText, markdown, csv, xlsx, docx, pdf

    public static func of(_ url: URL) -> DocumentFormat? { of(extension: url.pathExtension) }

    public static func of(extension ext: String) -> DocumentFormat? {
        switch ext.lowercased() {
        case "txt", "text": .plainText
        case "md", "markdown", "mdown", "mkd": .markdown
        case "csv", "tsv": .csv
        case "xlsx", "xlsm": .xlsx
        case "docx", "docm": .docx
        case "pdf": .pdf
        default: nil
        }
    }

    /// Le estensioni che l'app apre.
    public static let extensions = ["txt", "text", "md", "markdown", "mdown", "mkd", "csv", "tsv", "xlsx", "xlsm", "docx", "docm", "pdf"]

    public var title: String {
        switch self {
        case .plainText: "Testo"
        case .markdown: "Markdown"
        case .csv: "CSV"
        case .xlsx: "Excel"
        case .docx: "Word"
        case .pdf: "PDF"
        }
    }

    public var symbol: String {
        switch self {
        case .plainText: "doc.text"
        case .markdown: "doc.richtext"
        case .csv, .xlsx: "tablecells"
        case .docx: "doc.text.fill"
        case .pdf: "doc.viewfinder"
        }
    }

    public var defaultExtension: String {
        switch self {
        case .plainText: "txt"
        case .markdown: "md"
        case .csv: "csv"
        case .xlsx: "xlsx"
        case .docx: "docx"
        case .pdf: "pdf"
        }
    }

    /// Testo semplice: si legge e si scrive come testo (anche modificandolo a mano).
    public var isText: Bool { self == .plainText || self == .markdown }
    public var isTable: Bool { self == .csv || self == .xlsx }

    var textKind: TextDocument.Kind { self == .markdown ? .markdown : .plainText }

    public enum FormatError: LocalizedError {
        case unsupported(String)

        public var errorDescription: String? {
            switch self {
            case .unsupported(let ext):
                ["doc", "xls", "ppt"].contains(ext)
                    ? "I file .\(ext) del vecchio Office non si leggono: aprili e salvali come .\(ext)x, poi riprova."
                    : "I file .\(ext) non si leggono: l'app gestisce testo, Markdown, CSV, Excel, Word e PDF."
            }
        }
    }
}

/// Esito di un'anonimizzazione o di una riconversione.
public struct FileOutcome: Sendable {
    public var data: Data
    public var preview: DocumentPreview
    public var report: AnonymizationReport?
    public var reveal: RevealResult?
    /// Pagine del PDF lette con il riconoscimento del testo.
    public var recognizedPages = 0
}

extension Anonymizer {
    /// Anonimizza un file di qualunque formato gestito; esce un file dello stesso formato (un PDF nuovo per i PDF).
    public func anonymizeFile(_ data: Data, format: DocumentFormat, fileExtension: String = "", settings: AnonymizationSettings = .init(),
                              client: UUID? = nil, known: [KnownValue] = [], matching: Vault.Matching = .exact,
                              progress: (@Sendable (Double) -> Void)? = nil) async throws -> FileOutcome {
        switch format {
        case .plainText, .markdown:
            var document = try TextDocument.decode(data, kind: format.textKind)
            let result = try await anonymize(document.text, settings: settings, client: client, known: known, matching: matching, progress: progress)
            document.text = result.text
            return FileOutcome(data: document.data(), preview: .text(result.text), report: result.report)
        case .csv:
            var table = try CSVTable(data: data, fileExtension: fileExtension)
            let (content, cells) = table.segmented()
            let (replacements, report) = try await anonymize(content, settings: settings, client: client, known: known, matching: matching, progress: progress)
            table.apply(content.applying(replacements), cells: cells)
            return FileOutcome(data: table.data(), preview: .sheets([table.preview]), report: report)
        case .xlsx:
            let file = try SpreadsheetFile(data: data)
            let (content, sources) = file.segmented()
            let (replacements, report) = try await anonymize(content, settings: settings, client: client, known: known, matching: matching, progress: progress)
            let output = try file.applying(replacements, content: content, sources: sources, anonymized: true)
            return FileOutcome(data: output, preview: .sheets(try SpreadsheetFile(data: output).preview()), report: report)
        case .docx:
            let file = try WordFile(data: data)
            let (content, units) = file.segmented()
            let (replacements, report) = try await anonymize(content, settings: settings, client: client, known: known, matching: matching, progress: progress)
            let output = try file.applying(replacements, content: content, units: units, anonymized: true)
            return FileOutcome(data: output, preview: .text(try WordFile(data: output).plainText), report: report)
        case .pdf:
            let (pages, recognized) = try await PDFText.pages(of: data)
            guard pages.contains(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else { throw PDFText.PDFError.noText }
            var content = SegmentedText()
            for page in pages { content.addSegment([page], separator: "\n\n") }
            let (replacements, report) = try await anonymize(content, settings: settings, client: client, known: known, matching: matching, progress: progress)
            let texts = content.applying(replacements)
            var outcome = FileOutcome(data: PDFWriter.make(pages: texts, title: "Documento anonimizzato"), preview: .text(FileReveal.join(pages: texts)),
                                      report: report)
            outcome.recognizedPages = recognized
            return outcome
        }
    }
}

public enum FileReveal {
    /// Riconverte un file con i segnaposto (anche scritto da un'AI) nello stesso formato.
    public static func reveal(_ data: Data, format: DocumentFormat, fileExtension: String = "", vault: Vault) async throws -> FileOutcome {
        switch format {
        case .plainText, .markdown:
            var document = try TextDocument.decode(data, kind: format.textKind)
            let result = Revealer.reveal(document.text, vault: vault)
            document.text = result.text
            return FileOutcome(data: document.data(), preview: .text(result.text), reveal: result)
        case .csv:
            var table = try CSVTable(data: data, fileExtension: fileExtension)
            let (content, cells) = table.segmented()
            let (replacements, result) = SegmentedRevealer.replacements(in: content, vault: vault)
            table.apply(content.applying(replacements), cells: cells)
            return FileOutcome(data: table.data(), preview: .sheets([table.preview]), reveal: result)
        case .xlsx:
            let file = try SpreadsheetFile(data: data)
            let (content, sources) = file.segmented()
            let (replacements, result) = SegmentedRevealer.replacements(in: content, vault: vault)
            let output = try file.applying(replacements, content: content, sources: sources, anonymized: false)
            return FileOutcome(data: output, preview: .sheets(try SpreadsheetFile(data: output).preview()), reveal: result)
        case .docx:
            let file = try WordFile(data: data)
            let (content, units) = file.segmented()
            let (replacements, result) = SegmentedRevealer.replacements(in: content, vault: vault)
            let output = try file.applying(replacements, content: content, units: units, anonymized: false)
            return FileOutcome(data: output, preview: .text(try WordFile(data: output).plainText), reveal: result)
        case .pdf:
            let (pages, recognized) = try await PDFText.pages(of: data)
            var content = SegmentedText()
            for page in pages { content.addSegment([page], separator: "\n\n") }
            let (replacements, result) = SegmentedRevealer.replacements(in: content, vault: vault)
            let texts = content.applying(replacements)
            var outcome = FileOutcome(data: PDFWriter.make(pages: texts, title: "Documento"), preview: .text(join(pages: texts)), reveal: result)
            outcome.recognizedPages = recognized
            return outcome
        }
    }

    /// Come mostrare un file (senza toccarlo).
    public static func preview(_ data: Data, format: DocumentFormat, fileExtension: String = "") async throws -> DocumentPreview {
        switch format {
        case .plainText, .markdown: .text(try TextDocument.decode(data, kind: format.textKind).text)
        case .csv: .sheets([try CSVTable(data: data, fileExtension: fileExtension).preview])
        case .xlsx: .sheets(try SpreadsheetFile(data: data).preview())
        case .docx: .text(try WordFile(data: data).plainText)
        case .pdf: .text(join(pages: try await PDFText.pages(of: data).pages))
        }
    }

    /// Le pagine di un PDF, separate da una riga.
    static func join(pages: [String]) -> String {
        pages.enumerated().map { index, text in
            (pages.count > 1 ? "— Pagina \(index + 1) —\n\n" : "") + text.trimmingCharacters(in: .whitespacesAndNewlines)
        }.joined(separator: "\n\n")
    }
}
