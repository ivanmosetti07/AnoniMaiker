import AnonymizerKit
import AppKit
import UniformTypeIdentifiers

/// Le finestre di Apri e Salva.
enum FilePanels {
    /// Testo, Markdown, CSV, Excel, Word e PDF.
    static var documentTypes: [UTType] {
        var types: [UTType] = [.plainText, .commaSeparatedText, .pdf]
        types += DocumentFormat.extensions.compactMap { UTType(filenameExtension: $0) }
        return types
    }

    static func chooseDocument() -> URL? {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = documentTypes
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "Scegli un file: testo, Markdown, CSV, Excel, Word o PDF"
        panel.prompt = "Apri"
        return panel.runModal() == .OK ? panel.url : nil
    }

    static func save(_ data: Data, suggestedName: String, in directory: URL?) throws {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        if let directory { panel.directoryURL = directory }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try data.write(to: url, options: .atomic)
    }
}
