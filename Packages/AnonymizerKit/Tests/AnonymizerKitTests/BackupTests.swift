import Foundation
import Testing
@testable import AnonymizerKit

/// La cartella cifrata e la copia di sicurezza con password: si riapre su un altro Mac, mai senza la password giusta.
@Suite struct BackupTests {
    private func temporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory.appending(path: "anonimizzatore-prove-\(UUID().uuidString)")
    }

    /// Una cartella con dizionario, CRM e un documento.
    private func filledFolder() async throws -> (SecureFolder, URL) {
        let directory = temporaryDirectory()
        let folder = SecureFolder(directory: directory, protection: .file)
        try await VaultStore(folder: folder).update { _ = $0.placeholder(label: "FULLNAME", value: "Mario Rossi") }
        let crm = CRMStore(folder: folder)
        let company = Company(name: "Edilnord S.r.l.", status: .client)
        try await crm.update { $0.save(company) }
        _ = try await crm.addDocument(title: "Verbale", text: TextDocument(text: "Incontro con Mario Rossi.", kind: .markdown),
                                      fileName: "verbale.md", companyID: company.id)
        return (folder, directory)
    }

    @Test func aBackupOpensOnAnotherMacWithThePassword() async throws {
        let (folder, directory) = try await filledFolder()
        defer { try? FileManager.default.removeItem(at: directory) }
        let summary = BackupSummary(vault: try await VaultStore(folder: folder).snapshot(), crm: try await CRMStore(folder: folder).snapshot(),
                                    appVersion: "prova")
        let backup = try Backup.make(files: try folder.allFiles(), summary: summary, password: "una password lunga", iterations: 1_000)
        // Nella copia non c'è niente in chiaro.
        #expect(backup.range(of: Data("Mario Rossi".utf8)) == nil && backup.range(of: Data("Edilnord".utf8)) == nil)

        let contents = try Backup.open(backup, password: "una password lunga")
        #expect(contents.summary.dictionaryEntries == 1 && contents.summary.companies == 1 && contents.summary.documents == 1)
        #expect(Set(contents.files.keys).count == 3)

        // Un altro Mac: cartella nuova, chiave nuova, stessi dati.
        let other = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: other) }
        let otherFolder = SecureFolder(directory: other, protection: .file)
        try otherFolder.replaceAll(with: contents.files)
        #expect(try await VaultStore(folder: otherFolder).snapshot().value(for: "[FULLNAME_1]") == "Mario Rossi")
        let crm = CRMStore(folder: otherFolder)
        let database = try await crm.snapshot()
        let document = try #require(database.documents.first)
        #expect(database.companies.first?.name == "Edilnord S.r.l.")
        #expect(try await crm.text(of: try #require(document.original), in: document).text == "Incontro con Mario Rossi.")
    }

    @Test func wrongPasswordsAndOtherFilesAreRefused() throws {
        let summary = BackupSummary(appVersion: "prova", dictionaryEntries: 0, companies: 0, contacts: 0, deals: 0, activities: 0, documents: 0)
        let backup = try Backup.make(files: ["crm": Data("{}".utf8)], summary: summary, password: "password giusta!", iterations: 1_000)
        #expect(throws: Backup.BackupError.wrongPassword) { try Backup.open(backup, password: "password sbagliata") }
        // L'intestazione è autenticata: cambiarla (per esempio le iterazioni) rende la copia inapribile.
        var tampered = backup
        let headerStart = Backup.magic.count + 4
        let header = String(decoding: tampered[headerStart..<(headerStart + 60)], as: UTF8.self)
        #expect(header.contains("{"))
        tampered[headerStart + 1] = tampered[headerStart + 1] == UInt8(ascii: "a") ? UInt8(ascii: "b") : UInt8(ascii: "a")
        #expect(throws: Backup.BackupError.self) { try Backup.open(tampered, password: "password giusta!") }
        #expect(throws: Backup.BackupError.notABackup) { try Backup.open(Data("non sono una copia".utf8), password: "password giusta!") }
        #expect(throws: Backup.BackupError.weakPassword) { try Backup.make(files: [:], summary: summary, password: "corta") }
        #expect(Backup.strength(of: "corta").score == 0 && Backup.strength(of: "Una-Password-Robusta-2026").score == 3)
    }

    /// Su un Mac nuovo la cartella copiata non si apre: il ripristino mette da parte i file vecchi, non li cancella.
    @Test func restoringOverAnUnopenableFolderSetsTheOldFilesAside() async throws {
        let (folder, directory) = try await filledFolder()
        defer { try? FileManager.default.removeItem(at: directory) }
        let files = try folder.allFiles()
        // La chiave di «un altro Mac»: non si apre.
        try Data(#"{"version":1,"protection":"secureEnclave","salt":"AAAA","sealedDataKey":"AAAA"}"#.utf8)
            .write(to: directory.appending(path: "chiave.json"))
        let stranger = SecureFolder(directory: directory, protection: .file)
        #expect(throws: SecureFolder.FolderError.self) { try stranger.unlock() }

        let aside = try #require(try stranger.replaceAll(with: files))
        #expect(FileManager.default.fileExists(atPath: aside.appending(path: "chiave.json").path))
        #expect(FileManager.default.fileExists(atPath: aside.appending(path: "dizionario.sigillato").path))
        #expect(try await VaultStore(folder: stranger).snapshot().value(for: "[FULLNAME_1]") == "Mario Rossi")
        // La cartella messa da parte non conta fra i dati.
        #expect(stranger.sealedNames().allSatisfy { !$0.contains("Sostituiti") })
    }

    @Test func onlySimpleNamesInsideTheFolder() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let folder = SecureFolder(directory: directory, protection: .file)
        for name in ["../fuori", "documenti/../../x", "altro/x", "a/b/c", "", "con spazio"] {
            #expect(throws: SecureFolder.FolderError.invalidName(name)) { try folder.write(Data(), to: name) }
        }
        try folder.write(Data("ok".utf8), to: "documenti/\(UUID().uuidString)")
        #expect(folder.sealedNames().count == 1)
    }
}
