import Foundation
import Testing
@testable import AnonymizerKit

/// Quali entità diventano segnaposto: categorie scelte, eccezioni, dati già noti.
@Suite struct MaskingTests {
    private let text = PIIText("Mario Rossi paga € 1.250,00 il 12/10/2026 alle 18.30 a Milano, via Garibaldi 24, a Edilnord S.r.l.; "
        + "server 192.168.1.10 e 8.8.8.8; link https://x.it/?u=anna@studio.it e 3 righe.")

    private func entity(_ label: String, _ value: String) -> PIIEntity {
        let range = text.string.range(of: value)!
        let start = text.string.unicodeScalars.distance(from: text.string.unicodeScalars.startIndex, to: range.lowerBound)
        return PIIEntity(label: label, start: start, end: start + value.unicodeScalars.count, score: 0.9, validated: false, source: .model)
    }

    private var found: [PIIEntity] {
        [entity("FULLNAME", "Mario Rossi"), entity("AMOUNT", "€ 1.250,00"), entity("DATE", "12/10/2026"), entity("TIME", "18.30"),
         entity("CITY", "Milano"), entity("STREET", "via Garibaldi"), entity("BUILDINGNUM", "24"), entity("ORG", "Edilnord S.r.l."),
         entity("IPADDR", "192.168.1.10"), entity("IPADDR", "8.8.8.8"), entity("URL", "https://x.it/?u=anna@studio.it"),
         entity("BUILDINGNUM", "3 ")]
    }

    private func hidden(_ labels: Set<String>, exceptions: [String] = []) -> [String] {
        Masking.withoutExceptions(Masking.masked(found, in: text, labels: labels), in: text,
                                  exceptions: Masking.normalizedExceptions(exceptions))
            .map { "\($0.label):\(text.slice($0.start, $0.end))" }
    }

    /// Di serie: dati personali e aziende. Importi, date, orari, città, siti e IP di casa restano in chiaro.
    @Test func personalDataAndCompaniesByDefault() {
        #expect(hidden(PIICategory.defaultHidden) == ["FULLNAME:Mario Rossi", "STREET:via Garibaldi", "BUILDINGNUM:24",
                                                      "ORG:Edilnord S.r.l.", "IPADDR:8.8.8.8", "EMAIL:anna@studio.it"])
        #expect(hidden(Set(PIICategory.personal)).contains("ORG:Edilnord S.r.l.") == false)
        #expect(hidden(PIICategory.defaultHidden.union(["AMOUNT"])).contains("AMOUNT:€ 1.250,00"))
        #expect(Masking.isLocalAddress("127.0.0.1") && Masking.isLocalAddress("172.20.0.5") && Masking.isLocalAddress("192.168.1.0/24"))
        #expect(!Masking.isLocalAddress("8.8.8.8") && !Masking.isLocalAddress("172.32.0.1"))
    }

    /// La forma societaria resta intera: «S.r.l.» con il suo punto, così la riconversione non lo perde.
    @Test func legalFormKeepsItsLastDot() {
        let text = PIIText("Contratto con Edilnord S.r.l. e Rossi SpA.")
        let entities = [PIIEntity(label: "ORG", start: 14, end: 28, score: 0.9, validated: false, source: .model),
                        PIIEntity(label: "ORG", start: 32, end: 41, score: 0.9, validated: false, source: .model)]
        let masked = Masking.masked(entities, in: text, labels: PIICategory.defaultHidden).map { text.slice($0.start, $0.end) }
        #expect(masked == ["Edilnord S.r.l.", "Rossi SpA"])
    }

    /// Senza il contesto di una frase il modello scambia orari e codici brevi per dati a forma fissa: quelli senza la
    /// forma giusta restano in chiaro; quelli veri (e i dati catastali con le loro parole) si nascondono.
    @Test func modelPredictionsNeedTheRightShape() {
        let text = PIIText("Ore 14:30 sala A123, cod. 12, carta 4532, targa AB, CF RSSMRA85H12F205Y, al Foglio 12 particella 345, tavolo 7")
        func entity(_ label: String, _ value: String, after: String? = nil) -> PIIEntity {
            let base = after.flatMap { text.string.range(of: $0) }?.upperBound ?? text.string.startIndex
            let range = text.string.range(of: value, range: base..<text.string.endIndex)!
            let start = text.string.unicodeScalars.distance(from: text.string.unicodeScalars.startIndex, to: range.lowerBound)
            return PIIEntity(label: label, start: start, end: start + value.unicodeScalars.count, score: 0.8, validated: false, source: .model)
        }
        let found = [entity("CF", "14:30"), entity("CF", "A123"), entity("IBAN", "12"), entity("CREDITCARDNUMBER", "4532"), entity("TARGA", "AB"),
                     entity("CF", "RSSMRA85H12F205Y"), entity("CATASTO", "12", after: "Foglio"), entity("CATASTO", "345"), entity("CATASTO", "7")]
        let kept = Masking.masked(found, in: text, labels: PIICategory.defaultHidden).map { "\($0.label):\(text.slice($0.start, $0.end))" }
        #expect(kept == ["CF:RSSMRA85H12F205Y", "CATASTO:12", "CATASTO:345"])
    }

    /// «Mai nascondere»: senza badare a maiuscole, spazi e forma societaria.
    @Test func exceptionsStayInClear() {
        let result = hidden(PIICategory.defaultHidden, exceptions: ["edilnord", "  MARIO  rossi "])
        #expect(!result.contains("ORG:Edilnord S.r.l.") && !result.contains("FULLNAME:Mario Rossi"))
        #expect(result.contains("STREET:via Garibaldi"))
    }

    /// I dati già nel dizionario si nascondono anche dove il modello non li vede (l'azienda anche senza «S.r.l.»).
    @Test func knownValuesAreMaskedEverywhere() {
        var vault = Vault()
        vault.placeholder(label: "ORG", value: "Rossi Moto S.r.l.")
        vault.placeholder(label: "FULLNAME", value: "Martina Verdi")
        vault.placeholder(label: "FULLNAME", value: "Marco")
        vault.placeholder(label: "CITY", value: "Roma")
        let page = "Rossi Moto di Roma: parla la titolare martina  verdi, già [FULLNAME_1]. Marco Bianchi commenta."
        let masked = Masking.maskKnown(page, vault: vault, labels: PIICategory.defaultHidden, exceptions: [])
        // «Marco» da solo è troppo comune; Roma è una città (in chiaro di serie).
        #expect(masked.text == "[ORG_1] di Roma: parla la titolare [FULLNAME_1], già [FULLNAME_1]. Marco Bianchi commenta.")
        #expect(masked.used == ["[ORG_1]", "[FULLNAME_1]"])
        // Un'eccezione vince anche sui dati noti.
        let excepted = Masking.maskKnown(page, vault: vault, labels: PIICategory.defaultHidden,
                                         exceptions: Masking.normalizedExceptions(["Rossi Moto"]))
        #expect(excepted.text.hasPrefix("Rossi Moto di Roma"))
    }

    /// Luoghi presi per persone, aziende o vie (un programma di eventi): restano in chiaro.
    @Test func placesAreNotPeopleOrCompanies() {
        let text = PIIText("Hotel → Terrazza; Hotel Palazzo Aureliano · Sala Traiano; Circo Massimo; Castel Sant'Angelo · Lungotevere; "
            + "Centro congressi Via Cavour; Mario Rossi abita in Via Roma 12; Villa Mario e Anna Fontana; Borgo Pio")
        func entity(_ label: String, _ value: String, occurrence: Int = 0) -> PIIEntity {
            var ranges: [Range<String.Index>] = []
            var from = text.string.startIndex
            while let range = text.string.range(of: value, range: from..<text.string.endIndex) { ranges.append(range); from = range.upperBound }
            let range = ranges[occurrence]
            let start = text.string.unicodeScalars.distance(from: text.string.unicodeScalars.startIndex, to: range.lowerBound)
            return PIIEntity(label: label, start: start, end: start + value.unicodeScalars.count, score: 0.9, validated: false, source: .model)
        }
        let found = [entity("ORG", "Hotel"), entity("ORG", "Hotel Palazzo Aureliano"), entity("FULLNAME", "Circo Massimo"),
                     entity("FULLNAME", "Castel Sant"), entity("STREET", "Lungotevere"), entity("STREET", "Via Cavour"),
                     entity("FULLNAME", "Mario Rossi"), entity("STREET", "Via Roma"), entity("BUILDINGNUM", "12"),
                     entity("FULLNAME", "Villa Mario"), entity("FULLNAME", "Anna Fontana"), entity("FULLNAME", "Borgo Pio")]
        let hidden = Masking.masked(found, in: text, labels: PIICategory.defaultHidden).map { text.slice($0.start, $0.end) }
        #expect(hidden == ["Hotel Palazzo Aureliano", "Mario Rossi", "Via Roma", "12", "Villa Mario", "Anna Fontana"])

        // Anche le voci già finite nel dizionario («Hotel» come azienda) non si cercano più nei testi.
        var vault = Vault()
        vault.placeholder(label: "ORG", value: "Hotel")
        vault.placeholder(label: "FULLNAME", value: "Circo Massimo")
        vault.placeholder(label: "ORG", value: "Edilnord S.r.l.")
        let matches = Masking.knownMatches(in: PIIText("Hotel e Circo Massimo con Edilnord"), entries: vault.entries,
                                           labels: PIICategory.defaultHidden, exceptions: [])
        #expect(matches.map(\.placeholder) == ["[ORG_2]"])
    }
}
