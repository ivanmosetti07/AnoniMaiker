import { rmSync } from "node:fs";
import { afterAll, describe, expect, test } from "vitest";
import { AnonymizationSettings, Anonymizer, ForcedTerm, type KnownValue } from "../src/core/anonimizzazione";
import { FileReveal, WordFile, anonymizeFile } from "../src/core/documenti";
import { TextDocument } from "../src/core/documenti/textDocument";
import { EngineError, PIICategory, PIIEngine } from "../src/core/motore";
import { FormatTest } from "./formatTestSupport";
import { TestEngine } from "./support/motoreSupport";

const directories: string[] = [];
function anonymizer(): Anonymizer {
  const { anonymizer, directory } = TestEngine.anonymizer();
  directories.push(directory);
  return anonymizer;
}
afterAll(() => {
  for (const d of directories) rmSync(d, { recursive: true, force: true });
});

test("missingEngineIsReported", async () => {
  const engine = new PIIEngine("/non/esiste");
  expect(engine.isInstalled).toBe(false);
  await expect(engine.prepare()).rejects.toSatisfy((e: unknown) => e instanceof EngineError && e.equals(EngineError.notInstalled));
});

describe.skipIf(!TestEngine.isAvailable)("EngineTests", () => {
  /** Casi della pipeline Python originale (modello v1.5.0): il porting deve dare lo stesso testo. */
  test("sameResultsAsTheOriginalPipeline", async () => {
    const cases: [string, string][] = [
      ["Il Sig. Mario Rossi, C.F. RSSMRA85H12F205Y, P.IVA 12345678903, è titolare dell'immobile al Foglio 12, particella 345, sub. 6.",
        "Il Sig. [FULLNAME_1], C.F. [CF_1], P.IVA [PIVA_1], è titolare dell'immobile al Foglio [CATASTO_1], particella [CATASTO_2], sub. [CATASTO_3]."],
      ["Bonifico di € 12.500,00 sull'IBAN IT60X0542811101000000123456 intestato a Edilnord S.r.l., via Garibaldi 24, 20121 Milano (MI).",
        "Bonifico di [AMOUNT_1] sull'IBAN [IBAN_1] intestato a [ORG_1]., [STREET_1] [BUILDINGNUM_1], [ZIPCODE_1] [CITY_1] ([PROVINCE_1])."],
      ["Per info scrivi a luca.verdi@studioverdi.it o chiama il 333 123 4567; targa del veicolo AB123CD, carta 4111 1111 1111 1111.",
        "Per info scrivi a [EMAIL_1] o chiama il [TELEPHONENUM_1]; targa del veicolo [TARGA_1], carta [CREDITCARDNUMBER_1]."],
      ["Ciao Marco, ci vediamo domani alle 18.30 davanti al bar di Piazza Navona? Porta il contratto firmato da Elena.",
        "Ciao [FULLNAME_1], ci vediamo domani alle [TIME_1] davanti al bar di [STREET_1]? Porta il contratto firmato da [FULLNAME_2]."],
      ["Coordinate: IT60 X054 2811\n1010 0000 0123 456 presso la filiale.", "Coordinate: [IBAN_1] presso la filiale."],
      ["Connessione in ingresso da 8.8.8.8 registrata nel log; rete 192.168.1.0/24 e range 192.168.1.1-192.168.1.20.",
        "Connessione in ingresso da [IPADDR_1] registrata nel log; rete [IPADDR_2] e range [IPADDR_3]."],
    ];
    for (const [text, expected] of cases) {
      expect((await Anonymizer.trial(text, TestEngine.engine)).text).toBe(expected);
    }
  });

  /** Andata e ritorno di un documento Markdown: niente dati veri nel file anonimizzato, riconversione identica. */
  test("markdownRoundTrip", async () => {
    const a = anonymizer();
    const original = [
      "# Verbale incontro con Edilnord S.r.l.",
      "",
      "Presenti: **Mario Rossi** (mario.rossi@edilnord.it, 333 123 4567) e Giulia Bianchi.",
      "Il cliente chiede di pagare € 12.500,00 entro il 30/11/2026 sull'IBAN IT60X0542811101000000123456.",
      "",
      "- Prossimo passo: inviare il contratto a Mario Rossi, via Garibaldi 24, Milano.",
    ].join("\n");
    const source = new TextDocument(original, "markdown");
    const { document: anonymized, report } = await a.anonymizeDocument(source);
    for (const secret of ["Mario Rossi", "mario.rossi@edilnord.it", "333 123 4567", "Giulia Bianchi", "IT60X0542811101000000123456", "Edilnord", "Garibaldi"]) {
      expect(anonymized.text.includes(secret), `«${secret}» è rimasto in chiaro`).toBe(false);
    }
    // Dati di lavoro in chiaro, stessa persona = stesso segnaposto.
    expect(anonymized.text.includes("€ 12.500,00") && anonymized.text.includes("30/11/2026") && anonymized.text.includes("Milano")).toBe(true);
    expect(anonymized.text.split("[FULLNAME_1]").length).toBe(3);
    expect(report.counts.FULLNAME === 2 && report.counts.ORG === 1 && report.newEntries === report.placeholders.length).toBe(true);

    const { document: revealed, result } = await a.revealDocument(anonymized);
    expect(revealed.text === original && result.unknown.length === 0).toBe(true);
  });

  /** La risposta di un'AI, scritta con i segnaposto: torna con i dati veri; quelli inventati si segnalano. */
  test("anAnswerFromTheAIComesBackReadable", async () => {
    const a = anonymizer();
    const sent = await a.anonymize("Scrivi una mail a Mario Rossi di Edilnord S.r.l. per il preventivo.");
    expect(sent.text.includes("[FULLNAME_1]") && sent.text.includes("[ORG_1]")).toBe(true);
    const answer = "Gentile **[FULLNAME_1]**,\n\ncome d'accordo con \\[ORG\\_1\\] le invio il preventivo. Saluti, [FULLNAME_7]";
    const back = await a.reveal(answer);
    expect(back.text).toBe("Gentile **Mario Rossi**,\n\ncome d'accordo con Edilnord S.r.l. le invio il preventivo. Saluti, [FULLNAME_7]");
    expect(back.unknown).toEqual(["[FULLNAME_7]"]);
  });

  /** Nella scheda di un cliente i dati che il CRM conosce si nascondono anche scritti in minuscolo, dove il modello
   *  non li vede; le voci restano legate al cliente. */
  test("clientDataKnownToTheCRMIsHidden", async () => {
    const a = anonymizer();
    const client = globalThis.crypto.randomUUID().toUpperCase();
    const known: KnownValue[] = [{ label: "ORG", value: "Zetaflux S.r.l." }, { label: "FULLNAME", value: "Gianni Bruno" },
      { label: "EMAIL", value: "gianni@zetaflux.it" }];
    const text = "ieri ho sentito quelli di zetaflux: gianni bruno vuole il preventivo entro venerdì.";
    const settings = new AnonymizationSettings({ maskKnownValues: false });
    const result = await a.anonymize(text, { settings, client, known });
    expect(!result.text.toLowerCase().includes("zetaflux") && !result.text.toLowerCase().includes("gianni")).toBe(true);
    const vault = await a.store.snapshot();
    const linked = new Set(vault.entriesOf(client).map((e) => e.value));
    for (const value of ["Zetaflux S.r.l.", "Gianni Bruno", "gianni@zetaflux.it"]) {
      expect(linked.has(value), `Voci del cliente: ${[...linked]} · testo: ${result.text}`).toBe(true);
    }
    // Riconvertito torna identico, minuscole comprese.
    const back = await a.reveal(result.text);
    expect(back.unknown.length === 0 && back.text === text).toBe(true);
  });

  test("wordWithTheRealEngine", async () => {
    const a = anonymizer();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const body = `<?xml version="1.0"?><w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t xml:space="preserve">Il contratto con Edilnord S.r.l. lo firma il sig. Mario </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Rossi</w:t></w:r><w:r><w:t xml:space="preserve">, nato a Torino.</w:t></w:r></w:p></w:body></w:document>`;
    const source = FormatTest.office([["[Content_Types].xml", FormatTest.contentTypes], ["word/document.xml", body]]);
    const outcome = await anonymizeFile(a, source, "docx");
    const xml = FormatTest.part(outcome.data, "word/document.xml");
    expect(xml.includes("[ORG_1]") && xml.includes("il sig. [FULLNAME_1]</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t></w:t>"), xml).toBe(true);
    expect(!xml.includes("Rossi") && !xml.includes("Edilnord")).toBe(true);
    const back = await FileReveal.reveal(outcome.data, "docx", await a.store.snapshot());
    expect(new WordFile(back.data).plainText).toBe(new WordFile(source).plainText);
  });

  /** Eccezioni e categorie scelte valgono anche con il modello; un testo già anonimizzato non cambia. */
  test("settingsAreRespected", async () => {
    const a = anonymizer();
    const text = "Studio Alfa S.r.l. lavora per Edilnord S.r.l.: referente Mario Rossi.";
    const settings = new AnonymizationSettings({ exceptions: ["Studio Alfa"] });
    const result = await a.anonymize(text, { settings });
    expect(result.text.startsWith("Studio Alfa S.r.l. lavora per [ORG_1]")).toBe(true);
    const personalOnly = await a.anonymize(text, { settings: new AnonymizationSettings({ hidden: PIICategory.personal }) });
    expect(personalOnly.text.includes("Edilnord S.r.l.") && personalOnly.text.includes("[FULLNAME_1]")).toBe(true);
    const twice = await a.anonymize(result.text, { settings });
    expect(twice.text).toBe(result.text);
  });

  // In più rispetto a Swift: un testo lungo passa a blocchi, con l'avanzamento, e si può annullare.
  test("longTextInChunksWithProgressAndCancel", async () => {
    const text = Array.from({ length: 300 }, (_, i) => (i % 50 === 0 ? "Mario Rossi" : "parola")).join(" ");
    const steps: number[] = [];
    const result = await Anonymizer.trial(text, { entities: (s) => TestEngine.engine.entities(s, (p) => steps.push(p)) });
    expect(steps).toEqual([1 / 3, 2 / 3, 1]);
    expect(result.text.split("[FULLNAME_1]").length).toBe(7);
    const controller = new AbortController();
    controller.abort();
    await expect(anonymizer().anonymize(text, { signal: controller.signal })).rejects.toThrow();
  });
});

/** «Nascondi sempre» anche nelle tabelle, e vince sulle eccezioni: la metà con `anonymizeFile` di
 *  `forcedTermsAreAlwaysHidden` (MaskingTests.swift; la metà sul testo sta in masking.test.ts). */
test("forcedTermsAreAlwaysHidden (tabelle)", async () => {
  const { anonymizer, cleanup } = FormatTest.anonymizer();
  try {
    const settings = new AnonymizationSettings({ hidden: ["EMAIL"], forcedTerms: [new ForcedTerm("On Location", "ORG"),
      new ForcedTerm("Progetto Aurora", "OTHER")] });
    const text = "Allestimento di ON  LOCATION per il progetto aurora. Onlocation e On Locationale restano.";
    const result = await anonymizer.anonymize(text, { settings });
    expect(result.text).toBe("Allestimento di [ORG_1] per il [OTHER_1]. Onlocation e On Locationale restano.");

    settings.exceptions = ["On Location"];
    const csv = "Fornitore;Note\nOn Location;ok\n";
    const outcome = await anonymizeFile(anonymizer, new TextEncoder().encode(csv), "csv", { settings });
    expect(new TextDecoder().decode(outcome.data)).toBe("Fornitore;Note\n[ORG_2];ok\n");
  } finally {
    cleanup();
  }
});
