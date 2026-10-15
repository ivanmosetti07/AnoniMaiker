import Foundation

// MARK: - Documenti di testo: .txt e .md
//
// Si legge la codifica dell'originale (UTF-8 con o senza BOM, UTF-16, oppure Windows-1252 e Latin-1 dei file vecchi) e
// si riscrive uguale: a-capo, BOM e codifica non cambiano. Se un dato vero non sta nella codifica originale (un nome
// con lettere che Latin-1 non ha), il file riconvertito si salva in UTF-8.

public struct TextDocument: Sendable, Equatable {
    public enum Kind: String, Codable, Sendable, CaseIterable {
        case plainText
        case markdown

        public var title: String {
            switch self {
            case .plainText: "Testo"
            case .markdown: "Markdown"
            }
        }
    }

    public enum DocumentError: LocalizedError {
        case unsupported(String)
        case unreadable

        public var errorDescription: String? {
            switch self {
            case .unsupported(let ext):
                "I file .\(ext) arriveranno nelle prossime versioni: per ora .txt e .md."
            case .unreadable:
                "Non riesco a leggere il testo di questo file."
            }
        }
    }

    public var text: String
    public var kind: Kind
    public var encoding: String.Encoding
    public var hasBOM: Bool

    public init(text: String, kind: Kind, encoding: String.Encoding = .utf8, hasBOM: Bool = false) {
        self.text = text
        self.kind = kind
        self.encoding = encoding
        self.hasBOM = hasBOM
    }

    /// Estensioni gestite.
    public static let extensions: [String: Kind] = ["txt": .plainText, "text": .plainText, "md": .markdown, "markdown": .markdown,
                                                    "mdown": .markdown, "mkd": .markdown]

    public static func kind(of url: URL) -> Kind? { extensions[url.pathExtension.lowercased()] }

    public static func read(from url: URL) throws -> TextDocument {
        guard let kind = kind(of: url) else { throw DocumentError.unsupported(url.pathExtension.lowercased()) }
        return try decode(Data(contentsOf: url), kind: kind)
    }

    public static func decode(_ data: Data, kind: Kind) throws -> TextDocument {
        let head = [UInt8](data.prefix(3))
        if head.starts(with: [0xEF, 0xBB, 0xBF]) {
            guard let text = String(data: Data(data.dropFirst(3)), encoding: .utf8) else { throw DocumentError.unreadable }
            return TextDocument(text: text, kind: kind, encoding: .utf8, hasBOM: true)
        }
        if head.starts(with: [0xFF, 0xFE]) || head.starts(with: [0xFE, 0xFF]) {
            let encoding: String.Encoding = head[0] == 0xFF ? .utf16LittleEndian : .utf16BigEndian
            guard let text = String(data: Data(data.dropFirst(2)), encoding: encoding) else { throw DocumentError.unreadable }
            return TextDocument(text: text, kind: kind, encoding: encoding, hasBOM: true)
        }
        for encoding in [String.Encoding.utf8, .windowsCP1252, .isoLatin1] {
            if let text = String(data: data, encoding: encoding) {
                return TextDocument(text: text, kind: kind, encoding: encoding)
            }
        }
        throw DocumentError.unreadable
    }

    /// Il file da scrivere: stessa codifica e stesso BOM dell'originale, se il testo ci sta; altrimenti UTF-8.
    public func data() -> Data {
        guard let body = text.data(using: encoding, allowLossyConversion: false) else { return Data(text.utf8) }
        guard hasBOM else { return body }
        let bom: [UInt8] = switch encoding {
        case .utf16LittleEndian: [0xFF, 0xFE]
        case .utf16BigEndian: [0xFE, 0xFF]
        default: [0xEF, 0xBB, 0xBF]
        }
        return Data(bom) + body
    }

    public func write(to url: URL) throws {
        try data().write(to: url, options: .atomic)
    }

    func replacingText(_ text: String) -> TextDocument {
        var copy = self
        copy.text = text
        return copy
    }
}

/// I nomi dei file prodotti: «Contratto.md» → «Contratto (anonimizzato).md» → «Contratto (riconvertito).md».
/// Anche il nome può contenere dati personali («Contratto Mario Rossi.md»): quelli già nel dizionario diventano
/// segnaposto nel nome del file anonimizzato e tornano veri in quello riconvertito.
public enum DocumentNaming {
    public static func anonymizedName(for url: URL) -> String { name(for: url, suffix: "anonimizzato") }
    public static func revealedName(for url: URL) -> String { name(for: url, suffix: "riconvertito") }

    /// Il nome del file anonimizzato, senza i dati del dizionario.
    public static func anonymizedName(for url: URL, vault: Vault, settings: AnonymizationSettings) -> String {
        let base = Masking.maskKnown(baseName(of: url), vault: vault, labels: settings.hidden,
                                     exceptions: Masking.normalizedExceptions(settings.exceptions)).text
        return compose(base, suffix: "anonimizzato", ext: url.pathExtension)
    }

    /// Il nome del file riconvertito, con i dati veri al posto dei segnaposto.
    public static func revealedName(for url: URL, vault: Vault) -> String {
        let base = Revealer.reveal(baseName(of: url), vault: vault).text
            .replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        return compose(base, suffix: "riconvertito", ext: url.pathExtension)
    }

    static func name(for url: URL, suffix: String) -> String {
        compose(baseName(of: url), suffix: suffix, ext: url.pathExtension)
    }

    static func baseName(of url: URL) -> String {
        url.deletingPathExtension().lastPathComponent
            .replacingOccurrences(of: #"\s*\((?:anonimizzato|riconvertito)\)$"#, with: "", options: [.regularExpression, .caseInsensitive])
    }

    static func compose(_ base: String, suffix: String, ext: String) -> String {
        "\(base) (\(suffix))" + (ext.isEmpty ? "" : ".\(ext)")
    }
}
