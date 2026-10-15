import Foundation
import Testing
@testable import AnonymizerKit

/// Rete regex e codici di controllo: girano senza il modello.
@Suite struct DetectorsTests {
    private func labels(_ text: String) -> [String] {
        let source = PIIText(text)
        return PIIDetectors.detect(source).sorted { $0.start < $1.start }.map { "\($0.label):\(source.slice($0.start, $0.end))" }
    }

    @Test func checksums() {
        #expect(PIIDetectors.cfOK("RSSMRA85H12F205Y") && !PIIDetectors.cfOK("RSSMRA85H12F205X"))
        #expect(PIIDetectors.cfOK("BNCLCU90A41H50MO"))                    // omocodia: cifre sostituite da lettere
        #expect(PIIDetectors.pivaOK("12345678903") && !PIIDetectors.pivaOK("12345678901"))
        #expect(PIIDetectors.ibanOK("IT60X0542811101000000123456") && PIIDetectors.ibanOK("IT60 X054 2811 1010 0000 0123 456"))
        #expect(!PIIDetectors.ibanOK("IT99X9999999999999999999999"))
        #expect(PIIDetectors.luhnOK("4111 1111 1111 1111") && !PIIDetectors.luhnOK("4111 1111 1111 1112"))
    }

    @Test func regexNetwork() {
        #expect(labels("Accredito su ES91 2100 0418 4502 0005 1332 come da mandato.") == ["IBAN:ES91 2100 0418 4502 0005 1332"])
        #expect(labels("Coordinate: IT60 X054 2811\n1010 0000 0123 456 presso la filiale.") == ["IBAN:IT60 X054 2811\n1010 0000 0123 456"])
        // La scadenza attaccata alla carta resta fuori; una carta con il Luhn sbagliato non è una carta.
        #expect(labels("Carta 4111 1111 1111 1111 12/26 intestata.").contains("CREDITCARDNUMBER:4111 1111 1111 1111"))
        #expect(!labels("Carta 4111 1111 1111 1112.").contains { $0.hasPrefix("CREDITCARDNUMBER") })
        #expect(labels("Cell. +39-333-123-4567 per contatti.") == ["TELEPHONENUM:+39-333-123-4567"])
        #expect(labels("Vedi https://www.studiorossi.it/contatti. Grazie").contains("URL:https://www.studiorossi.it/contatti"))
        #expect(labels("Aggiornata alla versione 2.3.55.987 del pacchetto.").isEmpty)
        #expect(labels("rete 192.168.1.0/24 e range 192.168.1.1-192.168.1.20") == ["IPADDR:192.168.1.0/24", "IPADDR:192.168.1.1-192.168.1.20"])
        #expect(labels("Prot. n. 456/2024 e Rep. 45 del notaio.") == ["DOCID:Prot. n. 456/2024", "DOCID:Rep. 45"])
        #expect(labels("Targa AB-123-CD e importo € 1.250,00").contains("TARGA:AB-123-CD"))
        #expect(labels("Targa AB-123-CD e importo € 1.250,00").contains("AMOUNT:€ 1.250,00"))
    }

    @Test func categoriesAreConsistent() {
        #expect(Set(PIICategory.all) == Set(PIICategory.personal + PIICategory.companies + PIICategory.workingData))
        #expect(PIICategory.defaultHidden.contains("ORG") && PIICategory.defaultHidden.contains("FULLNAME"))
        #expect(PIICategory.defaultHidden.isDisjoint(with: PIICategory.workingData))
        #expect(PIICategory.name("CF", count: 1) == "codice fiscale" && PIICategory.title("CF") == "Codici fiscali")
    }
}
