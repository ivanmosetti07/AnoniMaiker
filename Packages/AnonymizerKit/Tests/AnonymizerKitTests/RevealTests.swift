import Foundation
import Testing
@testable import AnonymizerKit

/// La riconversione: tollerante con le AI e con il Markdown, onesta sui segnaposto che non conosce.
@Suite struct RevealTests {
    private var vault: Vault {
        var vault = Vault()
        vault.placeholder(label: "FULLNAME", value: "Mario Rossi")
        vault.placeholder(label: "CF", value: "RSSMRA85H12F205Y")
        vault.placeholder(label: "ID_DOC", value: "CA12345AB")
        return vault
    }

    private func reveal(_ text: String) -> String { Revealer.reveal(text, vault: vault).text }

    @Test func placeholdersBecomeTheRealData() {
        #expect(reveal("Gentile [FULLNAME_1], il CF è [CF_1].") == "Gentile Mario Rossi, il CF è RSSMRA85H12F205Y.")
        // Grassetto mantenuto, parentesi con spazi, forma senza parentesi, lettera accentata attaccata.
        #expect(reveal("**[FULLNAME_1]**") == "**Mario Rossi**")
        #expect(reveal("[ FULLNAME_1 ] e FULLNAME_1 e CF_1è") == "Mario Rossi e Mario Rossi e CF_1è")
        // FULLNAME_10 non è FULLNAME_1.
        #expect(reveal("[FULLNAME_10]") == "[FULLNAME_10]")
    }

    /// Il Markdown copiato da ChatGPT mette «\» davanti a parentesi e trattini bassi.
    @Test func escapedMarkdownIsUnderstood() {
        #expect(reveal(#"Gentile \[FULLNAME\_1\], documento \[ID\_DOC\_1\]"#) == "Gentile Mario Rossi, documento CA12345AB")
        #expect(reveal(#"Firmato: FULLNAME\_1"#) == "Firmato: Mario Rossi")
    }

    @Test func unknownPlaceholdersStayAndAreReported() {
        let result = Revealer.reveal("[FULLNAME_1] e [FULLNAME_9], poi di nuovo [FULLNAME_9] e [EMAIL_2]", vault: vault)
        #expect(result.text == "Mario Rossi e [FULLNAME_9], poi di nuovo [FULLNAME_9] e [EMAIL_2]")
        #expect(result.unknown == ["[FULLNAME_9]", "[EMAIL_2]"])
        #expect(result.replaced == ["[FULLNAME_1]": 1] && result.count == 1)
    }

    /// Solo le categorie del motore: costanti di codice e parole con il trattino basso restano come sono.
    @Test func onlyEngineCategoriesArePlaceholders() {
        let result = Revealer.reveal("let MAX_SIZE_1 = 3; [NOTE_1] e snake_case_2", vault: vault)
        #expect(result.text == "let MAX_SIZE_1 = 3; [NOTE_1] e snake_case_2" && result.unknown.isEmpty)
    }

    /// Le posizioni dei dati rimessi, per evidenziarli (anche dopo un'emoji, che in UTF-16 vale 2).
    @Test func spansPointAtTheRevealedValues() {
        let result = Revealer.reveal("🙂 [FULLNAME_1] ha il CF [CF_1]", vault: vault)
        let ns = result.text as NSString
        #expect(result.spans.map { ns.substring(with: $0) } == ["Mario Rossi", "RSSMRA85H12F205Y"])
        #expect(Revealer.placeholderRanges(in: "a [FULLNAME_1] b [CF_2]").count == 2)
    }
}
