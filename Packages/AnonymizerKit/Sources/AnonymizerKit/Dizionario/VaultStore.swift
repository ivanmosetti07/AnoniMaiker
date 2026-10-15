import Foundation

// MARK: - Il dizionario su disco, cifrato
//
// Sta nella cartella cifrata dell'app (`dizionario.sigillato`). Ogni modifica si salva subito: è il dizionario che
// permette di riconvertire i file. Un dizionario che non si riesce ad aprire non si sovrascrive mai.

public actor VaultStore {
    public static let fileName = "dizionario"

    public nonisolated let folder: SecureFolder
    /// Il file cifrato del dizionario («dizionario», o quello di un progetto).
    public nonisolated let fileName: String
    private var vault = Vault()
    private var isOpen = false

    public init(folder: SecureFolder, fileName: String = VaultStore.fileName) {
        self.folder = folder
        self.fileName = fileName
    }

    /// Un dizionario con la sua cartella (per le prove e la riga di comando).
    public init(directory: URL = SecureFolder.defaultDirectory, protection: KeyProtection = .secureEnclave) {
        self.init(folder: SecureFolder(directory: directory, protection: protection))
    }

    public nonisolated var directory: URL { folder.directory }

    /// Chi custodisce la chiave, una volta aperto.
    public nonisolated var protection: KeyProtection? { folder.protection }

    /// Apre il dizionario; la prima volta crea la chiave.
    @discardableResult
    public func open() throws -> Vault {
        if isOpen { return vault }
        if let data = try folder.read(fileName) {
            do {
                vault = try JSONDecoder().decode(Vault.self, from: data)
            } catch {
                throw SecureFolder.FolderError.unreadable(name: fileName, reason: error.localizedDescription)
            }
        } else {
            try folder.unlock()
        }
        isOpen = true
        return vault
    }

    /// Il dizionario com'è adesso.
    public func snapshot() throws -> Vault { try open() }

    /// Modifica il dizionario e, se è cambiato, lo salva subito cifrato.
    public func update<T: Sendable>(_ body: @Sendable (inout Vault) throws -> T) throws -> T {
        var copy = try open()
        let result = try body(&copy)
        if copy != vault {
            try folder.write(JSONEncoder().encode(copy), to: fileName)
            vault = copy
        }
        return result
    }

    /// Toglie una voce (il numero resta occupato).
    public func remove(_ placeholder: String) throws {
        try update { $0.remove(placeholder) }
    }

    /// Dopo un ripristino: rilegge dal disco.
    @discardableResult
    public func reload() throws -> Vault {
        isOpen = false
        vault = Vault()
        return try open()
    }
}
