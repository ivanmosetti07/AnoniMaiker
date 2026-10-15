import CryptoKit
import Foundation

// MARK: - La cartella cifrata dell'app
//
// `~/Library/Application Support/Anonimizzatore AI/`: una chiave dei dati (sigillata dal custode in `chiave.json`) e
// i file cifrati con lei: il dizionario, il CRM, i documenti dei clienti. Un file che non si riesce ad aprire non si
// sovrascrive mai. Con una cartella che non si apre (su un Mac nuovo) si può solo ripristinare una copia di sicurezza:
// i file vecchi si mettono da parte, non si cancellano.
//
// Le operazioni sono sincrone e sotto lock: chi la usa (dizionario e CRM, due attori) aggiorna i suoi file senza
// sospendersi a metà, quindi due salvataggi non si sovrappongono mai.

public final class SecureFolder: @unchecked Sendable {
    public enum FolderError: LocalizedError, Equatable {
        case keyMissing
        case cannotUnlock(String)
        case unreadable(name: String, reason: String)
        case invalidName(String)
        case sealFailed

        public var errorDescription: String? {
            switch self {
            case .keyMissing:
                "I dati cifrati ci sono ma la loro chiave no (chiave.json): non li apro e non li sovrascrivo. Puoi ripristinare una copia di sicurezza."
            case .cannotUnlock(let reason):
                "Non riesco ad aprire la chiave dei dati (\(reason)). Se vengono da un altro Mac, la sua Secure Enclave non è questa: ripristina una copia di sicurezza."
            case .unreadable(let name, let reason):
                "Il file «\(name)» non è leggibile (\(reason)): non lo sovrascrivo."
            case .invalidName(let name):
                "Nome di file non valido: \(name)"
            case .sealFailed:
                "Cifratura non riuscita."
            }
        }
    }

    public static let sealedExtension = "sigillato"
    static let keyName = "chiave.json"
    /// Le sottocartelle con file cifrati (le altre, come quelle messe da parte, si ignorano).
    static let managedFolders = ["documenti"]

    public let directory: URL
    private let preferred: KeyProtection
    private let lock = NSLock()
    private var key: SymmetricKey?
    private var currentProtection: KeyProtection?

    public init(directory: URL = SecureFolder.defaultDirectory, protection: KeyProtection = .secureEnclave) {
        self.directory = directory
        preferred = protection
    }

    /// Resta la cartella del nome di prima dell'app, dove stanno già i dati.
    public static var defaultDirectory: URL {
        URL.applicationSupportDirectory.appending(path: "Anonimizzatore AI", directoryHint: .isDirectory)
    }

    /// Chi custodisce la chiave, una volta sbloccata.
    public var protection: KeyProtection? { lock.withLock { currentProtection } }

    var keyURL: URL { directory.appending(path: Self.keyName) }

    // MARK: Chiave

    /// Sblocca la chiave; la prima volta (cartella senza dati) la crea.
    public func unlock() throws {
        try lock.withLock { _ = try unlockedKey() }
    }

    private func unlockedKey() throws -> SymmetricKey {
        if let key { return key }
        let fm = FileManager.default
        try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if fm.fileExists(atPath: keyURL.path) {
            do {
                let file = try JSONDecoder().decode(KeyFile.self, from: Data(contentsOf: keyURL))
                let opened = try KeyCustody.open(file)
                key = opened
                currentProtection = file.protection
                return opened
            } catch {
                throw FolderError.cannotUnlock(error.localizedDescription)
            }
        }
        guard sealedNamesUnlocked().isEmpty else { throw FolderError.keyMissing }
        return try createKey()
    }

    private func createKey() throws -> SymmetricKey {
        let created = try KeyCustody.create(preferring: preferred)
        try Self.write(JSONEncoder().encode(created.file), to: keyURL)
        key = created.key
        currentProtection = created.file.protection
        return created.key
    }

    // MARK: File

    /// Il contenuto in chiaro di un file cifrato («dizionario», «crm», «documenti/…»); nil se non c'è.
    public func read(_ name: String) throws -> Data? {
        try lock.withLock {
            let key = try unlockedKey()
            let url = try sealedURL(name)
            guard FileManager.default.fileExists(atPath: url.path) else { return nil }
            do {
                return try AES.GCM.open(AES.GCM.SealedBox(combined: Data(contentsOf: url)), using: key)
            } catch {
                throw FolderError.unreadable(name: name, reason: error.localizedDescription)
            }
        }
    }

    /// Scrive un file cifrato (in modo atomico, leggibile solo dal tuo utente).
    public func write(_ data: Data, to name: String) throws {
        try lock.withLock { try writeUnlocked(data, to: name) }
    }

    private func writeUnlocked(_ data: Data, to name: String) throws {
        let key = try unlockedKey()
        let url = try sealedURL(name)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        guard let sealed = try AES.GCM.seal(data, using: key).combined else { throw FolderError.sealFailed }
        try Self.write(sealed, to: url)
    }

    public func delete(_ name: String) throws {
        try lock.withLock {
            let url = try sealedURL(name)
            if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        }
    }

    /// I nomi dei file cifrati presenti, senza estensione («crm», «documenti/…»).
    public func sealedNames() -> [String] {
        lock.withLock { sealedNamesUnlocked() }
    }

    private func sealedNamesUnlocked() -> [String] {
        let fm = FileManager.default
        var names: [String] = []
        let suffix = "." + Self.sealedExtension
        for item in (try? fm.contentsOfDirectory(atPath: directory.path)) ?? [] where item.hasSuffix(suffix) {
            names.append(String(item.dropLast(suffix.count)))
        }
        for folder in Self.managedFolders {
            let base = directory.appending(path: folder)
            for item in (try? fm.subpathsOfDirectory(atPath: base.path)) ?? [] where item.hasSuffix(suffix) {
                names.append(folder + "/" + String(item.dropLast(suffix.count)))
            }
        }
        return names.sorted()
    }

    /// Tutti i file, in chiaro (per la copia di sicurezza).
    public func allFiles() throws -> [String: Data] {
        try lock.withLock {
            let key = try unlockedKey()
            var files: [String: Data] = [:]
            for name in sealedNamesUnlocked() {
                let url = try sealedURL(name)
                do {
                    files[name] = try AES.GCM.open(AES.GCM.SealedBox(combined: Data(contentsOf: url)), using: key)
                } catch {
                    throw FolderError.unreadable(name: name, reason: error.localizedDescription)
                }
            }
            return files
        }
    }

    // MARK: Ripristino

    /// Sostituisce tutto con i file dati (in chiaro), cifrati con una chiave nuova di questo Mac. Quello che c'era
    /// (anche se non si apriva) finisce in una cartella «Sostituiti il …»: niente si cancella. Restituisce quella cartella.
    @discardableResult
    public func replaceAll(with files: [String: Data], now: Date = .now) throws -> URL? {
        try lock.withLock {
            for name in files.keys { _ = try sealedURL(name) }
            let fm = FileManager.default
            try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let current = (try? fm.contentsOfDirectory(atPath: directory.path)) ?? []
            let movable = current.filter { $0 == Self.keyName || $0.hasSuffix("." + Self.sealedExtension) || Self.managedFolders.contains($0) }
            var aside: URL?
            if !movable.isEmpty {
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "it_IT")
                formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
                let folder = directory.appending(path: "Sostituiti il \(formatter.string(from: now))", directoryHint: .isDirectory)
                try fm.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                for item in movable { try fm.moveItem(at: directory.appending(path: item), to: folder.appending(path: item)) }
                aside = folder
            }
            key = nil
            currentProtection = nil
            _ = try createKey()
            for (name, data) in files { try writeUnlocked(data, to: name) }
            return aside
        }
    }

    // MARK: Supporto

    /// Solo nomi semplici dentro la cartella: lettere, numeri, «-», «_» e una sottocartella gestita.
    private func sealedURL(_ name: String) throws -> URL {
        let parts = name.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        let valid = !parts.isEmpty && parts.count <= 2 && parts.allSatisfy { part in
            !part.isEmpty && part.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" }
        } && (parts.count == 1 || Self.managedFolders.contains(parts[0]))
        guard valid else { throw FolderError.invalidName(name) }
        return directory.appending(path: name + "." + Self.sealedExtension)
    }

    static func write(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
