import CryptoKit
import Foundation
import Testing
@testable import AnonymizerKit

/// Gli aggiornamenti: versioni, release di GitHub, firma dei DMG.
@Suite struct UpdatesTests {
    @Test func versionsCompareAsNumbers() {
        #expect(Updates.isNewer("0.10", than: "0.9"))
        #expect(Updates.isNewer("v1.0", than: "0.9.9"))
        #expect(Updates.isNewer("0.5.1", than: "0.5"))
        #expect(!Updates.isNewer("0.5", than: "0.5.0"))
        #expect(!Updates.isNewer("0.4", than: "0.5"))
        #expect(!Updates.isNewer("0.6-beta", than: "0.6"))
        #expect(Updates.isNewer("0.6", than: "0.6-beta"))
    }

    @Test func githubReleaseIsRead() throws {
        let json = """
        {"tag_name":"v0.6","name":"AnoniMaiker 0.6","body":"Novità","html_url":"https://github.com/x/y/releases/tag/v0.6",
         "draft":false,"prerelease":false,"published_at":"2026-10-20T10:00:00Z",
         "assets":[{"name":"AnoniMaiker-0.6.dmg","size":123,"browser_download_url":"https://example.com/AnoniMaiker-0.6.dmg"},
                   {"name":"AnoniMaiker-0.6.dmg.sig","size":88,"browser_download_url":"https://example.com/AnoniMaiker-0.6.dmg.sig"}]}
        """
        let release = try #require(try Updates.parse(Data(json.utf8)))
        #expect(release.version == "0.6")
        #expect(release.dmg.lastPathComponent == "AnoniMaiker-0.6.dmg")
        #expect(release.signature?.lastPathComponent == "AnoniMaiker-0.6.dmg.sig")
        #expect(release.dmgSize == 123)
        #expect(release.published != nil)

        let prerelease = json.replacingOccurrences(of: "\"prerelease\":false", with: "\"prerelease\":true")
        #expect(try Updates.parse(Data(prerelease.utf8)) == nil)
        let noDMG = #"{"tag_name":"v1","html_url":"https://github.com","assets":[]}"#
        #expect(throws: Updates.UpdateError.noDownload) { try Updates.parse(Data(noDMG.utf8)) }
    }

    @Test func onlyFilesSignedWithTheKeyPass() throws {
        let file = FileManager.default.temporaryDirectory.appending(path: "aggiornamento-\(UUID().uuidString).dmg")
        defer { try? FileManager.default.removeItem(at: file) }
        try Data(repeating: 7, count: 20 << 20).write(to: file)
        let key = Curve25519.Signing.PrivateKey()
        let publicKey = key.publicKey.rawRepresentation.base64EncodedString()
        let signature = try Updates.sign(file, privateKey: key.rawRepresentation.base64EncodedString())
        #expect(Updates.verify(file, signature: signature, publicKey: publicKey))
        // Un'altra chiave (anche quella dell'app) o un file cambiato non passano.
        #expect(!Updates.verify(file, signature: signature))
        #expect(!Updates.verify(file, signature: signature, publicKey: Curve25519.Signing.PrivateKey().publicKey.rawRepresentation.base64EncodedString()))
        try Data(repeating: 8, count: 1).write(to: file)
        #expect(!Updates.verify(file, signature: signature, publicKey: publicKey))
        #expect(!Updates.verify(file, signature: "non base64", publicKey: publicKey))
    }

    @Test func appKeyIsValid() throws {
        let raw = try #require(Data(base64Encoded: Updates.publicKey))
        _ = try Curve25519.Signing.PublicKey(rawRepresentation: raw)
    }

    @Test func translocatedAppsCannotBeReplaced() {
        #expect(throws: UpdateInstaller.InstallError.translocated) {
            try UpdateInstaller.checkReplaceable(URL(filePath: "/private/var/folders/x/AppTranslocation/ABC/d/AnoniMaiker.app"))
        }
    }
}
