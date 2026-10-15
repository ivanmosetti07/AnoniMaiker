import CryptoKit
import Foundation
import Testing
@testable import AnonymizerKit

/// Il dizionario cifrato su disco: si riapre, non si legge senza chiave, non si sovrascrive mai se non si apre.
@Suite struct StoreTests {
    private func temporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory.appending(path: "anonimizzatore-prove-\(UUID().uuidString)")
    }

    @Test func savesEncryptedAndReopens() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = VaultStore(directory: directory, protection: .file)
        try await store.update { _ = $0.placeholder(label: "FULLNAME", value: "Mario Rossi") }
        #expect(store.protection == .file)

        // Sul disco non c'è niente in chiaro.
        let sealed = try Data(contentsOf: directory.appending(path: "dizionario.sigillato"))
        #expect(sealed.range(of: Data("Mario Rossi".utf8)) == nil)
        let attributes = try FileManager.default.attributesOfItem(atPath: directory.appending(path: "dizionario.sigillato").path)
        #expect((attributes[.posixPermissions] as? Int) == 0o600)

        // Un'altra apertura (un riavvio dell'app) ritrova la voce.
        let reopened = VaultStore(directory: directory, protection: .file)
        #expect(try await reopened.snapshot().value(for: "[FULLNAME_1]") == "Mario Rossi")
    }

    /// Senza chiave, o con un dizionario rovinato, l'app si ferma: non ricomincia da zero sopra i dati.
    @Test func neverOverwritesWhatItCannotOpen() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        try await VaultStore(directory: directory, protection: .file).update { _ = $0.placeholder(label: "EMAIL", value: "a@b.it") }
        let vaultURL = directory.appending(path: "dizionario.sigillato")
        let original = try Data(contentsOf: vaultURL)

        // Dizionario alterato: errore, e il file resta com'era.
        var tampered = original
        tampered[tampered.count - 1] ^= 0xFF
        try tampered.write(to: vaultURL)
        await #expect(throws: SecureFolder.FolderError.self) { try await VaultStore(directory: directory, protection: .file).snapshot() }
        #expect(try Data(contentsOf: vaultURL) == tampered)

        // Chiave sparita: errore, nessuna chiave nuova sopra un dizionario esistente.
        try original.write(to: vaultURL)
        try FileManager.default.removeItem(at: directory.appending(path: "chiave.json"))
        await #expect(throws: SecureFolder.FolderError.keyMissing) { try await VaultStore(directory: directory, protection: .file).snapshot() }
        #expect(!FileManager.default.fileExists(atPath: directory.appending(path: "chiave.json").path))
    }

    /// Con la Secure Enclave la chiave dei dati si riapre solo su questo Mac.
    @Test(.enabled(if: SecureEnclave.isAvailable)) func secureEnclaveCustody() throws {
        let created = try KeyCustody.create(preferring: .secureEnclave)
        #expect(created.file.protection == .secureEnclave && created.file.fileKey == nil && created.file.enclaveKey != nil)
        let reopened = try KeyCustody.open(created.file)
        #expect(reopened.withUnsafeBytes { Data($0) } == created.key.withUnsafeBytes { Data($0) })
    }
}
