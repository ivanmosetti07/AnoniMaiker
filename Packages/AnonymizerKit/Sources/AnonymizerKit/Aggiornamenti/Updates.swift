import CryptoKit
import Foundation

// MARK: - Aggiornamenti dalle release di GitHub
//
// L'app chiede a GitHub l'ultima release del progetto. Se è più nuova, scarica il DMG e la sua firma (`.dmg.sig`).
// La firma è Ed25519 sull'impronta SHA-256 del DMG, fatta con la chiave privata di chi pubblica (nel suo portachiavi):
// l'app ha la chiave pubblica e installa solo DMG firmati con quella. Così un file cambiato, anche su GitHub, non passa.
// Non serve l'Apple Developer Program.

/// Una release pubblicata su GitHub.
public struct AppRelease: Sendable, Equatable {
    public var version: String
    public var title: String
    /// Le novità, in Markdown.
    public var notes: String
    public var page: URL
    public var dmg: URL
    public var dmgSize: Int
    public var signature: URL?
    public var published: Date?

    public init(version: String, title: String, notes: String, page: URL, dmg: URL, dmgSize: Int, signature: URL?, published: Date?) {
        self.version = version
        self.title = title
        self.notes = notes
        self.page = page
        self.dmg = dmg
        self.dmgSize = dmgSize
        self.signature = signature
        self.published = published
    }
}

public enum Updates {
    /// Il progetto su GitHub.
    public static let repository = "ivanmosetti07/AnoniMaiker"
    public static var projectPage: URL { URL(string: "https://github.com/\(repository)")! }
    public static var issuesPage: URL { URL(string: "https://github.com/\(repository)/issues")! }
    public static var releasesPage: URL { URL(string: "https://github.com/\(repository)/releases")! }

    /// La chiave pubblica con cui sono firmati i DMG (Ed25519, base64). La privata sta nel portachiavi di chi pubblica.
    public static let publicKey = "Pp4atww+p9VoIY8YL4BrUffunyN50jk0FBGtPkCIEGE="

    public enum UpdateError: LocalizedError, Equatable {
        case network(String)
        case noDownload
        case unsigned
        case badSignature

        public var errorDescription: String? {
            switch self {
            case .network(let message): "Non riesco a controllare gli aggiornamenti: \(message)"
            case .noDownload: "L'ultima versione non ha un DMG da scaricare."
            case .unsigned: "L'ultima versione non è firmata: per sicurezza non si installa da qui. Scaricala dalla pagina del progetto."
            case .badSignature: "La firma dell'aggiornamento non corrisponde: il file non viene installato."
            }
        }
    }

    // MARK: Versioni

    /// «v0.10» è più nuova di «0.9». Si confrontano i numeri; quello che segue un «-» (0.5-beta) conta come più vecchio.
    public static func isNewer(_ candidate: String, than current: String) -> Bool {
        func parts(_ version: String) -> (numbers: [Int], prerelease: Bool) {
            var text = version.trimmingCharacters(in: .whitespaces)
            if text.hasPrefix("v") || text.hasPrefix("V") { text.removeFirst() }
            let pieces = text.split(separator: "-", maxSplits: 1)
            let numbers = (pieces.first ?? "").split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
            return (numbers, pieces.count > 1)
        }
        let a = parts(candidate), b = parts(current)
        for index in 0..<max(a.numbers.count, b.numbers.count) {
            let x = index < a.numbers.count ? a.numbers[index] : 0
            let y = index < b.numbers.count ? b.numbers[index] : 0
            if x != y { return x > y }
        }
        return !a.prerelease && b.prerelease
    }

    // MARK: GitHub

    /// L'ultima release pubblicata (non le bozze né le pre-release).
    public static func latest(session: URLSession = .shared) async throws -> AppRelease? {
        var request = URLRequest(url: URL(string: "https://api.github.com/repos/\(repository)/releases/latest")!)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("AnoniMaiker", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 20
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw UpdateError.network(error.localizedDescription)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 404 { return nil }
        guard status == 200 else { throw UpdateError.network("GitHub ha risposto \(status).") }
        return try parse(data)
    }

    static func parse(_ data: Data) throws -> AppRelease? {
        struct Asset: Decodable {
            let name: String
            let size: Int
            let browser_download_url: URL
        }
        struct Release: Decodable {
            let tag_name: String
            let name: String?
            let body: String?
            let html_url: URL
            let draft: Bool?
            let prerelease: Bool?
            let published_at: String?
            let assets: [Asset]
        }
        let release = try JSONDecoder().decode(Release.self, from: data)
        guard release.draft != true, release.prerelease != true else { return nil }
        guard let dmg = release.assets.first(where: { $0.name.lowercased().hasSuffix(".dmg") }) else { throw UpdateError.noDownload }
        let signature = release.assets.first { $0.name == dmg.name + ".sig" }?.browser_download_url
        var version = release.tag_name
        if version.hasPrefix("v") || version.hasPrefix("V") { version.removeFirst() }
        return AppRelease(version: version, title: release.name ?? release.tag_name, notes: release.body ?? "", page: release.html_url,
                          dmg: dmg.browser_download_url, dmgSize: dmg.size, signature: signature,
                          published: release.published_at.flatMap { try? Date($0, strategy: .iso8601) })
    }

    // MARK: Firma

    /// L'impronta SHA-256 di un file, letta a pezzi (un DMG pesa centinaia di MB).
    public static func digest(of file: URL) throws -> Data {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 8 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return Data(hasher.finalize())
    }

    /// La firma (base64) di un file con la chiave privata (base64).
    public static func sign(_ file: URL, privateKey: String) throws -> String {
        guard let raw = Data(base64Encoded: privateKey.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw CryptoKitError.incorrectKeySize
        }
        let key = try Curve25519.Signing.PrivateKey(rawRepresentation: raw)
        return try key.signature(for: digest(of: file)).base64EncodedString()
    }

    /// Il file è firmato con la chiave pubblica indicata?
    public static func verify(_ file: URL, signature: String, publicKey: String = Updates.publicKey) -> Bool {
        guard let raw = Data(base64Encoded: publicKey.trimmingCharacters(in: .whitespacesAndNewlines)),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw),
              let signatureData = Data(base64Encoded: signature.trimmingCharacters(in: .whitespacesAndNewlines)),
              let digest = try? digest(of: file) else { return false }
        return key.isValidSignature(signatureData, for: digest)
    }
}
