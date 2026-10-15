import AnonymizerKit
import AppKit
import Foundation
import UniformTypeIdentifiers

// MARK: - Copia di sicurezza
//
// Tutto (dizionario, CRM, documenti) in un file cifrato con una password: si riapre su un altro Mac. La chiave si
// ricava dalla password con 600.000 passaggi, quindi il lavoro pesante non gira sul thread principale.

extension AppModel {
    static var backupType: UTType { UTType(filenameExtension: Backup.fileExtension) ?? .data }

    func startExport() {
        backupStep = .export
        Task { _ = await allProjectsSummary() }
    }

    func startRestore() {
        Task { _ = await allProjectsSummary() }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [Self.backupType]
        panel.allowsMultipleSelection = false
        panel.message = "Scegli una copia di sicurezza di AnoniMaiker"
        panel.prompt = "Apri"
        if panel.runModal() == .OK, let url = panel.url { backupStep = .restore(url) }
    }

    /// Quanto c'è in tutti i progetti insieme (per la copia di sicurezza).
    func allProjectsSummary() async -> BackupSummary {
        var vaults: [Vault] = []
        var crms: [CRMDatabase] = []
        for project in projects {
            let space = projectStore.space(project.id)
            if let vault = try? await space.vault.snapshot() { vaults.append(vault) }
            if let crm = try? await space.crm.snapshot() { crms.append(crm) }
        }
        let summary = BackupSummary(projects: projects.count, vaults: vaults, crms: crms, appVersion: Self.appVersion)
        totals = summary
        return summary
    }

    /// Crea la copia e la salva dove sceglie l'utente. Restituisce true se è stata salvata.
    func exportBackup(password: String) async throws -> Bool {
        let folder = folder
        let summary = await allProjectsSummary()
        let data = try await Task.detached(priority: .userInitiated) {
            try Backup.make(files: folder.allFiles(), summary: summary, password: password)
        }.value
        let panel = NSSavePanel()
        panel.allowedContentTypes = [Self.backupType]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = "AnoniMaiker – copia del \(Date.now.formatted(.iso8601.year().month().day())).\(Backup.fileExtension)"
        panel.message = "Conserva la copia e la password in due posti diversi."
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        try data.write(to: url, options: .atomic)
        lastBackup = .now
        return true
    }

    /// Apre una copia con la password (senza toccare i dati di questo Mac).
    func openBackup(at url: URL, password: String) async throws -> Backup.Contents {
        try await Task.detached(priority: .userInitiated) {
            try Backup.open(Data(contentsOf: url), password: password)
        }.value
    }

    /// Sostituisce i dati di questo Mac con quelli della copia. Restituisce la cartella dove sono finiti quelli di prima.
    func restore(_ contents: Backup.Contents) async throws -> URL? {
        let folder = folder
        let aside = try await Task.detached(priority: .userInitiated) {
            try folder.replaceAll(with: contents.files)
        }.value
        await openData()
        anonymizeSpace.clear()
        revealSpace.clear()
        chat.task?.cancel()
        chat.selectedID = nil
        chat.pending = []
        companiesPath = []
        return aside
    }
}
