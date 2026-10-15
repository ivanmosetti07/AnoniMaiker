import AnonymizerKit
import CryptoKit
import Foundation

// La firma dei DMG per gli aggiornamenti (Ed25519 sull'impronta SHA-256 del file). La chiave privata non sta mai in
// un file: Scripts/pubblica-rilascio.sh la tiene nel portachiavi e la passa nella variabile FIRMA_CHIAVE.
//   firma-rilascio genera              una chiave nuova: stampa la privata (da salvare) e la pubblica (da mettere nell'app)
//   firma-rilascio pubblica            la chiave pubblica di FIRMA_CHIAVE
//   firma-rilascio firma <file>        la firma del file, in base64
//   firma-rilascio verifica <file> <firma> [pubblica]   0 se la firma è valida (di serie con la chiave dell'app)

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func privateKey() -> String {
    guard let key = ProcessInfo.processInfo.environment["FIRMA_CHIAVE"], !key.isEmpty else { fail("Manca la chiave privata in FIRMA_CHIAVE.") }
    return key
}

let arguments = Array(CommandLine.arguments.dropFirst())
switch arguments.first {
case "genera":
    let key = Curve25519.Signing.PrivateKey()
    print("privata: \(key.rawRepresentation.base64EncodedString())")
    print("pubblica: \(key.publicKey.rawRepresentation.base64EncodedString())")
case "pubblica":
    guard let raw = Data(base64Encoded: privateKey()), let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw) else {
        fail("Chiave privata non valida.")
    }
    print(key.publicKey.rawRepresentation.base64EncodedString())
case "firma" where arguments.count == 2:
    do { print(try Updates.sign(URL(filePath: arguments[1]), privateKey: privateKey())) } catch { fail(error.localizedDescription) }
case "verifica" where arguments.count >= 3:
    let valid = Updates.verify(URL(filePath: arguments[1]), signature: arguments[2], publicKey: arguments.count > 3 ? arguments[3] : Updates.publicKey)
    print(valid ? "Firma valida ✓" : "Firma NON valida ✗")
    exit(valid ? 0 : 1)
default:
    fail("Uso: firma-rilascio genera | pubblica | firma <file> | verifica <file> <firma> [pubblica]")
}
