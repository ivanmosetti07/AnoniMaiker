import Foundation
import Testing
@testable import AnonymizerKit

/// Il motore vero (`Engine/` nella cartella del progetto, preparato da `Scripts/prepara-motore.sh`). Senza, si saltano.
enum TestEngine {
    static let directory = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().appending(path: "Engine")
    static let shared = PIIEngine(directory: directory)
    static var isAvailable: Bool { shared.isInstalled }

    static func anonymizer() -> (Anonymizer, URL) {
        let directory = FileManager.default.temporaryDirectory.appending(path: "anonimizzatore-prove-\(UUID().uuidString)")
        return (Anonymizer(engine: shared, store: VaultStore(directory: directory, protection: .file)), directory)
    }
}

@Suite(.enabled(if: TestEngine.isAvailable), .serialized) struct EngineTests {
    /// Casi della pipeline Python originale (modello v1.5.0): il porting deve dare lo stesso testo.
    @Test func sameResultsAsTheOriginalPipeline() async throws {
        let cases = [
            ("Il Sig. Mario Rossi, C.F. RSSMRA85H12F205Y, P.IVA 12345678903, è titolare dell'immobile al Foglio 12, particella 345, sub. 6.",
             "Il Sig. [FULLNAME_1], C.F. [CF_1], P.IVA [PIVA_1], è titolare dell'immobile al Foglio [CATASTO_1], particella [CATASTO_2], sub. [CATASTO_3]."),
            ("Bonifico di € 12.500,00 sull'IBAN IT60X0542811101000000123456 intestato a Edilnord S.r.l., via Garibaldi 24, 20121 Milano (MI).",
             "Bonifico di [AMOUNT_1] sull'IBAN [IBAN_1] intestato a [ORG_1]., [STREET_1] [BUILDINGNUM_1], [ZIPCODE_1] [CITY_1] ([PROVINCE_1])."),
            ("Per info scrivi a luca.verdi@studioverdi.it o chiama il 333 123 4567; targa del veicolo AB123CD, carta 4111 1111 1111 1111.",
             "Per info scrivi a [EMAIL_1] o chiama il [TELEPHONENUM_1]; targa del veicolo [TARGA_1], carta [CREDITCARDNUMBER_1]."),
            ("Ciao Marco, ci vediamo domani alle 18.30 davanti al bar di Piazza Navona? Porta il contratto firmato da Elena.",
             "Ciao [FULLNAME_1], ci vediamo domani alle [TIME_1] davanti al bar di [STREET_1]? Porta il contratto firmato da [FULLNAME_2]."),
            ("Coordinate: IT60 X054 2811\n1010 0000 0123 456 presso la filiale.", "Coordinate: [IBAN_1] presso la filiale."),
            ("Connessione in ingresso da 8.8.8.8 registrata nel log; rete 192.168.1.0/24 e range 192.168.1.1-192.168.1.20.",
             "Connessione in ingresso da [IPADDR_1] registrata nel log; rete [IPADDR_2] e range [IPADDR_3]."),
        ]
        for (text, expected) in cases {
            #expect(try await Anonymizer.trial(text, engine: TestEngine.shared).text == expected)
        }
    }

    /// Andata e ritorno di un documento Markdown: niente dati veri nel file anonimizzato, riconversione identica.
    @Test func markdownRoundTrip() async throws {
        let (anonymizer, directory) = TestEngine.anonymizer()
        defer { try? FileManager.default.removeItem(at: directory) }
        let original = """
        # Verbale incontro con Edilnord S.r.l.

        Presenti: **Mario Rossi** (mario.rossi@edilnord.it, 333 123 4567) e Giulia Bianchi.
        Il cliente chiede di pagare € 12.500,00 entro il 30/11/2026 sull'IBAN IT60X0542811101000000123456.

        - Prossimo passo: inviare il contratto a Mario Rossi, via Garibaldi 24, Milano.
        """
        let source = TextDocument(text: original, kind: .markdown)
        let (anonymized, report) = try await anonymizer.anonymize(source)
        for secret in ["Mario Rossi", "mario.rossi@edilnord.it", "333 123 4567", "Giulia Bianchi", "IT60X0542811101000000123456", "Edilnord", "Garibaldi"] {
            #expect(!anonymized.text.contains(secret), "«\(secret)» è rimasto in chiaro")
        }
        // Dati di lavoro in chiaro, stessa persona = stesso segnaposto.
        #expect(anonymized.text.contains("€ 12.500,00") && anonymized.text.contains("30/11/2026") && anonymized.text.contains("Milano"))
        #expect(anonymized.text.components(separatedBy: "[FULLNAME_1]").count == 3)
        #expect(report.counts["FULLNAME"] == 2 && report.counts["ORG"] == 1 && report.newEntries == report.placeholders.count)

        let (revealed, result) = try await anonymizer.reveal(anonymized)
        #expect(revealed.text == original && result.unknown.isEmpty)
    }

    /// La risposta di un'AI, scritta con i segnaposto: torna con i dati veri; quelli inventati si segnalano.
    @Test func anAnswerFromTheAIComesBackReadable() async throws {
        let (anonymizer, directory) = TestEngine.anonymizer()
        defer { try? FileManager.default.removeItem(at: directory) }
        let sent = try await anonymizer.anonymize("Scrivi una mail a Mario Rossi di Edilnord S.r.l. per il preventivo.")
        #expect(sent.text.contains("[FULLNAME_1]") && sent.text.contains("[ORG_1]"))
        let answer = "Gentile **[FULLNAME_1]**,\n\ncome d'accordo con \\[ORG\\_1\\] le invio il preventivo. Saluti, [FULLNAME_7]"
        let back = try await anonymizer.reveal(answer)
        #expect(back.text == "Gentile **Mario Rossi**,\n\ncome d'accordo con Edilnord S.r.l. le invio il preventivo. Saluti, [FULLNAME_7]")
        #expect(back.unknown == ["[FULLNAME_7]"])
    }

    /// Nella scheda di un cliente i dati che il CRM conosce si nascondono anche scritti in minuscolo, dove il modello
    /// non li vede; le voci restano legate al cliente.
    @Test func clientDataKnownToTheCRMIsHidden() async throws {
        let (anonymizer, directory) = TestEngine.anonymizer()
        defer { try? FileManager.default.removeItem(at: directory) }
        let client = UUID()
        let known = [KnownValue(label: "ORG", value: "Zetaflux S.r.l."), KnownValue(label: "FULLNAME", value: "Gianni Bruno"),
                     KnownValue(label: "EMAIL", value: "gianni@zetaflux.it")]
        let text = "ieri ho sentito quelli di zetaflux: gianni bruno vuole il preventivo entro venerdì."
        let settings = AnonymizationSettings(maskKnownValues: false)
        let result = try await anonymizer.anonymize(text, settings: settings, client: client, known: known)
        #expect(!result.text.lowercased().contains("zetaflux") && !result.text.lowercased().contains("gianni"))
        let vault = try await anonymizer.store.snapshot()
        let linked = Set(vault.entries(of: client).map(\.value))
        #expect(linked.isSuperset(of: ["Zetaflux S.r.l.", "Gianni Bruno", "gianni@zetaflux.it"]), "Voci del cliente: \(linked) · testo: \(result.text)")
        // Riconvertito torna identico, minuscole comprese.
        let back = try await anonymizer.reveal(result.text)
        #expect(back.unknown.isEmpty && back.text == text)
    }

    /// Word con il modello vero: un nome spezzato fra due run («Mario » normale, «Rossi» in grassetto) diventa un
    /// segnaposto solo, nel primo run; l'azienda pure; riconvertito torna il testo di partenza.
    @Test func wordWithTheRealEngine() async throws {
        let (anonymizer, directory) = TestEngine.anonymizer()
        defer { try? FileManager.default.removeItem(at: directory) }
        let w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        let body = #"<?xml version="1.0"?><w:document xmlns:w="\#(w)"><w:body><w:p><w:r><w:t xml:space="preserve">Il contratto con Edilnord S.r.l. lo firma il sig. Mario </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Rossi</w:t></w:r><w:r><w:t xml:space="preserve">, nato a Torino.</w:t></w:r></w:p></w:body></w:document>"#
        let source = try FormatTest.office([("[Content_Types].xml", FormatTest.contentTypes), ("word/document.xml", body)])
        let outcome = try await anonymizer.anonymizeFile(source, format: .docx)
        let xml = try FormatTest.part(outcome.data, "word/document.xml")
        #expect(xml.contains("[ORG_1]") && xml.contains("il sig. [FULLNAME_1]</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t></w:t>"), "\(xml)")
        #expect(!xml.contains("Rossi") && !xml.contains("Edilnord"))
        let back = try await FileReveal.reveal(outcome.data, format: .docx, vault: anonymizer.store.snapshot())
        #expect(try WordFile(data: back.data).plainText == WordFile(data: source).plainText)
    }

    /// Eccezioni e categorie scelte valgono anche con il modello; un testo già anonimizzato non cambia.
    @Test func settingsAreRespected() async throws {
        let (anonymizer, directory) = TestEngine.anonymizer()
        defer { try? FileManager.default.removeItem(at: directory) }
        let text = "Studio Alfa S.r.l. lavora per Edilnord S.r.l.: referente Mario Rossi."
        let settings = AnonymizationSettings(exceptions: ["Studio Alfa"])
        let result = try await anonymizer.anonymize(text, settings: settings)
        #expect(result.text.hasPrefix("Studio Alfa S.r.l. lavora per [ORG_1]"))
        let personalOnly = try await anonymizer.anonymize(text, settings: AnonymizationSettings(hidden: Set(PIICategory.personal)))
        #expect(personalOnly.text.contains("Edilnord S.r.l.") && personalOnly.text.contains("[FULLNAME_1]"))
        let twice = try await anonymizer.anonymize(result.text, settings: settings)
        #expect(twice.text == result.text)
    }
}
