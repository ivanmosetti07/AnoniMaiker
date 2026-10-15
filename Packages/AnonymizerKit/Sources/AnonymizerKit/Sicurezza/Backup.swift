import CommonCrypto
import CryptoKit
import Foundation

// MARK: - La copia di sicurezza, protetta da una password
//
// Un file solo con tutto: dizionario, CRM e documenti. Si cifra con una chiave ricavata dalla password (PBKDF2-SHA256,
// 600.000 iterazioni), non con la Secure Enclave: così si riapre su un altro Mac. Senza la password non si apre, e
// nessuno la può recuperare.
//
// Formato: «ANONBK01» · lunghezza dell'intestazione (4 byte) · intestazione JSON (versione, sale, iterazioni, data) ·
// contenuto sigillato con AES-GCM. L'intestazione è autenticata insieme al contenuto: se cambia, la copia non si apre.

/// Cosa c'è in una copia (si legge solo dopo averla aperta con la password).
public struct BackupSummary: Codable, Sendable, Equatable {
    public var created: Date
    public var appVersion: String
    public var dictionaryEntries: Int
    public var companies: Int
    public var contacts: Int
    public var deals: Int
    public var activities: Int
    public var documents: Int

    public init(created: Date = .now, appVersion: String, dictionaryEntries: Int, companies: Int, contacts: Int, deals: Int,
                activities: Int, documents: Int) {
        self.created = created
        self.appVersion = appVersion
        self.dictionaryEntries = dictionaryEntries
        self.companies = companies
        self.contacts = contacts
        self.deals = deals
        self.activities = activities
        self.documents = documents
    }

    public init(vault: Vault, crm: CRMDatabase, appVersion: String, created: Date = .now) {
        self.init(created: created, appVersion: appVersion, dictionaryEntries: vault.count, companies: crm.companies.count,
                  contacts: crm.contacts.count, deals: crm.deals.count, activities: crm.activities.count, documents: crm.documents.count)
    }

    /// «120 voci nel dizionario, 12 aziende, 30 contatti…»
    public var description: String {
        func part(_ count: Int, _ one: String, _ many: String) -> String { "\(count) \(count == 1 ? one : many)" }
        return [part(dictionaryEntries, "voce nel dizionario", "voci nel dizionario"), part(companies, "azienda", "aziende"),
                part(contacts, "contatto", "contatti"), part(deals, "trattativa", "trattative"),
                part(activities, "nota o attività", "note e attività"), part(documents, "documento", "documenti")]
            .joined(separator: ", ")
    }
}

public enum Backup {
    public static let fileExtension = "anonimizzatore"
    public static let defaultIterations: UInt32 = 600_000
    public static let minimumPasswordLength = 10
    static let magic = Data("ANONBK01".utf8)

    public enum BackupError: LocalizedError, Equatable {
        case notABackup
        case unsupportedVersion(Int)
        case wrongPassword
        case weakPassword
        case keyDerivationFailed

        public var errorDescription: String? {
            switch self {
            case .notABackup: "Questo file non è una copia di sicurezza di AnoniMaiker."
            case .unsupportedVersion(let version): "La copia è di una versione più recente dell'app (formato \(version)): aggiorna l'app."
            case .wrongPassword: "Password sbagliata, oppure la copia è danneggiata."
            case .weakPassword: "La password deve avere almeno \(Backup.minimumPasswordLength) caratteri."
            case .keyDerivationFailed: "Non sono riuscito a ricavare la chiave dalla password."
            }
        }
    }

    struct Header: Codable {
        var version = 1
        var created: Date
        var kdf = "PBKDF2-HMAC-SHA256"
        var iterations: UInt32
        var salt: Data
    }

    struct Payload: Codable {
        var summary: BackupSummary
        var files: [String: Data]
    }

    /// Una copia aperta con la password: il riepilogo e i file da ripristinare.
    public struct Contents: Sendable {
        public let summary: BackupSummary
        public let files: [String: Data]
    }

    /// La copia di tutti i file (in chiaro), sigillata con la password.
    public static func make(files: [String: Data], summary: BackupSummary, password: String,
                            iterations: UInt32 = defaultIterations) throws -> Data {
        guard password.count >= minimumPasswordLength else { throw BackupError.weakPassword }
        let header = Header(created: summary.created, iterations: iterations,
                            salt: SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) })
        let headerData = try JSONEncoder().encode(header)
        var prefix = magic
        withUnsafeBytes(of: UInt32(headerData.count).bigEndian) { prefix.append(contentsOf: $0) }
        prefix.append(headerData)
        let key = try deriveKey(password, salt: header.salt, iterations: iterations)
        let payload = try JSONEncoder().encode(Payload(summary: summary, files: files))
        guard let sealed = try AES.GCM.seal(payload, using: key, authenticating: prefix).combined else { throw BackupError.keyDerivationFailed }
        return prefix + sealed
    }

    /// Apre una copia con la password.
    public static func open(_ data: Data, password: String) throws -> Contents {
        let bytes = [UInt8](data)
        guard bytes.count > magic.count + 4, Data(bytes[0..<magic.count]) == magic else { throw BackupError.notABackup }
        let lengthStart = magic.count
        let length = Int(UInt32(bytes[lengthStart]) << 24 | UInt32(bytes[lengthStart + 1]) << 16
                         | UInt32(bytes[lengthStart + 2]) << 8 | UInt32(bytes[lengthStart + 3]))
        let headerStart = lengthStart + 4
        guard length > 0, headerStart + length < bytes.count else { throw BackupError.notABackup }
        let headerData = Data(bytes[headerStart..<(headerStart + length)])
        guard let header = try? JSONDecoder().decode(Header.self, from: headerData) else { throw BackupError.notABackup }
        guard header.version <= 1 else { throw BackupError.unsupportedVersion(header.version) }
        let prefix = Data(bytes[0..<(headerStart + length)])
        let key = try deriveKey(password, salt: header.salt, iterations: header.iterations)
        let payload: Payload
        do {
            let box = try AES.GCM.SealedBox(combined: Data(bytes[(headerStart + length)...]))
            payload = try JSONDecoder().decode(Payload.self, from: AES.GCM.open(box, using: key, authenticating: prefix))
        } catch {
            throw BackupError.wrongPassword
        }
        return Contents(summary: payload.summary, files: payload.files)
    }

    /// PBKDF2-HMAC-SHA256 sulla password normalizzata (NFC: la stessa password scritta su tastiere diverse dà la stessa chiave).
    static func deriveKey(_ password: String, salt: Data, iterations: UInt32) throws -> SymmetricKey {
        let passwordBytes = Array(password.precomposedStringWithCanonicalMapping.utf8)
        var derived = [UInt8](repeating: 0, count: 32)
        let status = passwordBytes.withUnsafeBufferPointer { passwordBuffer in
            salt.withUnsafeBytes { saltBuffer in
                passwordBuffer.baseAddress!.withMemoryRebound(to: CChar.self, capacity: passwordBytes.count) { passwordPointer in
                    CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), passwordPointer, passwordBytes.count,
                                         saltBuffer.bindMemory(to: UInt8.self).baseAddress, salt.count,
                                         CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), iterations, &derived, derived.count)
                }
            }
        }
        guard status == kCCSuccess else { throw BackupError.keyDerivationFailed }
        return SymmetricKey(data: derived)
    }

    /// Un suggerimento sulla robustezza della password (non un giudizio definitivo).
    public static func strength(of password: String) -> (score: Int, label: String) {
        var classes = 0
        if password.rangeOfCharacter(from: .lowercaseLetters) != nil { classes += 1 }
        if password.rangeOfCharacter(from: .uppercaseLetters) != nil { classes += 1 }
        if password.rangeOfCharacter(from: .decimalDigits) != nil { classes += 1 }
        if password.rangeOfCharacter(from: CharacterSet.alphanumerics.inverted) != nil { classes += 1 }
        let length = password.count
        let score = length < minimumPasswordLength ? 0 : min(3, (length >= 16 ? 2 : 1) + (classes >= 3 ? 1 : 0))
        let label = ["Troppo corta", "Accettabile", "Buona", "Ottima"][score]
        return (score, label)
    }
}
