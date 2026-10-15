import CryptoKit
import Foundation

// MARK: - La chiave del dizionario
//
// Il dizionario si cifra con una chiave casuale (AES-GCM a 256 bit). Quella chiave non sta mai in chiaro su disco: la
// sigilla un custode. Di serie è la Secure Enclave del Mac: una copia dei file (un backup, una cartella sincronizzata)
// non si apre su un altro Mac. Dove la Secure Enclave non c'è (e nelle prove) il custode è un file leggibile solo dal
// tuo utente. Più avanti potranno aggiungersi altri custodi (una password di recupero) senza ricifrare il dizionario.

/// Chi custodisce la chiave del dizionario.
public enum KeyProtection: String, Codable, Sendable {
    /// La Secure Enclave di questo Mac.
    case secureEnclave
    /// Un file accanto al dizionario, con i permessi del solo utente.
    case file

    public var description: String {
        switch self {
        case .secureEnclave: "Secure Enclave di questo Mac"
        case .file: "file protetto dai permessi del tuo utente"
        }
    }
}

/// `chiave.json`: la chiave dei dati sigillata dal custode.
struct KeyFile: Codable {
    var version = 1
    var protection: KeyProtection
    var salt: Data
    /// La chiave dei dati, sigillata con la chiave del custode (AES-GCM).
    var sealedDataKey: Data
    /// Solo Secure Enclave: la chiave privata in forma cifrata, utilizzabile solo dalla Secure Enclave di questo Mac.
    var enclaveKey: Data?
    /// Solo Secure Enclave: la chiave pubblica con cui la Secure Enclave ricava la chiave del custode (ECDH + HKDF).
    var peerPublicKey: Data?
    /// Solo file: la chiave del custode.
    var fileKey: Data?
}

enum KeyCustody {
    // Il nome di prima dell'app (AnoniMaiker): cambiarlo renderebbe illeggibili le chiavi già sigillate.
    static let info = Data("Anonimizzatore AI · chiave del dizionario".utf8)

    enum CustodyError: LocalizedError {
        case incomplete
        case sealFailed

        var errorDescription: String? {
            switch self {
            case .incomplete: "il file della chiave è incompleto"
            case .sealFailed: "non sono riuscito a sigillare la chiave"
            }
        }
    }

    /// Una chiave dei dati nuova, sigillata dal custode richiesto (o dal file, se la Secure Enclave non c'è).
    static func create(preferring protection: KeyProtection) throws -> (key: SymmetricKey, file: KeyFile) {
        let dataKey = SymmetricKey(size: .bits256)
        let salt = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
        if protection == .secureEnclave, SecureEnclave.isAvailable {
            let enclave = try SecureEnclave.P256.KeyAgreement.PrivateKey()
            // La chiave software serve solo a ricavare la chiave del custode: si tiene la parte pubblica, la privata si butta.
            let peer = P256.KeyAgreement.PrivateKey()
            let custodian = try enclaveCustodian(enclave, peer: peer.publicKey, salt: salt)
            let file = KeyFile(protection: .secureEnclave, salt: salt, sealedDataKey: try seal(dataKey, with: custodian),
                               enclaveKey: enclave.dataRepresentation, peerPublicKey: peer.publicKey.x963Representation)
            return (dataKey, file)
        }
        let fileKey = SymmetricKey(size: .bits256)
        let custodian = HKDF<SHA256>.deriveKey(inputKeyMaterial: fileKey, salt: salt, info: info, outputByteCount: 32)
        let file = KeyFile(protection: .file, salt: salt, sealedDataKey: try seal(dataKey, with: custodian),
                           fileKey: fileKey.withUnsafeBytes { Data($0) })
        return (dataKey, file)
    }

    /// La chiave dei dati, aperta dal suo custode.
    static func open(_ file: KeyFile) throws -> SymmetricKey {
        let custodian: SymmetricKey
        switch file.protection {
        case .secureEnclave:
            guard let enclaveData = file.enclaveKey, let peerData = file.peerPublicKey else { throw CustodyError.incomplete }
            let enclave = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: enclaveData)
            let peer = try P256.KeyAgreement.PublicKey(x963Representation: peerData)
            custodian = try enclaveCustodian(enclave, peer: peer, salt: file.salt)
        case .file:
            guard let fileKey = file.fileKey else { throw CustodyError.incomplete }
            custodian = HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: fileKey), salt: file.salt, info: info, outputByteCount: 32)
        }
        let raw = try AES.GCM.open(AES.GCM.SealedBox(combined: file.sealedDataKey), using: custodian)
        return SymmetricKey(data: raw)
    }

    private static func enclaveCustodian(_ enclave: SecureEnclave.P256.KeyAgreement.PrivateKey, peer: P256.KeyAgreement.PublicKey,
                                         salt: Data) throws -> SymmetricKey {
        try enclave.sharedSecretFromKeyAgreement(with: peer)
            .hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt, sharedInfo: info, outputByteCount: 32)
    }

    private static func seal(_ key: SymmetricKey, with custodian: SymmetricKey) throws -> Data {
        guard let combined = try AES.GCM.seal(key.withUnsafeBytes { Data($0) }, using: custodian).combined else { throw CustodyError.sealFailed }
        return combined
    }
}
