import { describe, expect, test } from "vitest";
import { AnonymizationSettings, ForcedTerm, Masking, anonymizeSegmented } from "../src/core/anonimizzazione";
import { SegmentedText } from "../src/core/documenti/segmentedText";
import { Vault } from "../src/core/dizionario";
import { PIICategory, PIIText, type PIIEntity } from "../src/core/motore";
import { entity as at, regexAnonymizer } from "./support/motoreSupport";

/** Quali entità diventano segnaposto: categorie scelte, eccezioni, dati già noti. */
describe("MaskingTests", () => {
  const text = new PIIText("Mario Rossi paga € 1.250,00 il 12/10/2026 alle 18.30 a Milano, via Garibaldi 24, a Edilnord S.r.l.; "
    + "server 192.168.1.10 e 8.8.8.8; link https://x.it/?u=anna@studio.it e 3 righe.");

  const entity = (label: string, value: string): PIIEntity => at(text, label, value);

  const found = (): PIIEntity[] => [
    entity("FULLNAME", "Mario Rossi"), entity("AMOUNT", "€ 1.250,00"), entity("DATE", "12/10/2026"), entity("TIME", "18.30"),
    entity("CITY", "Milano"), entity("STREET", "via Garibaldi"), entity("BUILDINGNUM", "24"), entity("ORG", "Edilnord S.r.l."),
    entity("IPADDR", "192.168.1.10"), entity("IPADDR", "8.8.8.8"), entity("URL", "https://x.it/?u=anna@studio.it"),
    entity("BUILDINGNUM", "3 "),
  ];

  function hidden(labels: Set<string>, exceptions: string[] = []): string[] {
    return Masking.withoutExceptions(Masking.masked(found(), text, labels), text, Masking.normalizedExceptions(exceptions))
      .map((e) => `${e.label}:${text.slice(e.start, e.end)}`);
  }

  /** Di serie: dati personali e aziende. Importi, date, orari, città, siti e IP di casa restano in chiaro. */
  test("personalDataAndCompaniesByDefault", () => {
    expect(hidden(PIICategory.defaultHidden)).toEqual(["FULLNAME:Mario Rossi", "STREET:via Garibaldi", "BUILDINGNUM:24",
      "ORG:Edilnord S.r.l.", "IPADDR:8.8.8.8", "EMAIL:anna@studio.it"]);
    expect(hidden(new Set(PIICategory.personal)).includes("ORG:Edilnord S.r.l.")).toBe(false);
    expect(hidden(new Set([...PIICategory.defaultHidden, "AMOUNT"]))).toContain("AMOUNT:€ 1.250,00");
    expect(Masking.isLocalAddress("127.0.0.1") && Masking.isLocalAddress("172.20.0.5") && Masking.isLocalAddress("192.168.1.0/24")).toBe(true);
    expect(!Masking.isLocalAddress("8.8.8.8") && !Masking.isLocalAddress("172.32.0.1")).toBe(true);
  });

  /** La forma societaria resta intera: «S.r.l.» con il suo punto, così la riconversione non lo perde. */
  test("legalFormKeepsItsLastDot", () => {
    const text = new PIIText("Contratto con Edilnord S.r.l. e Rossi SpA.");
    const entities: PIIEntity[] = [{ label: "ORG", start: 14, end: 28, score: 0.9, validated: false, source: "modello" },
      { label: "ORG", start: 32, end: 41, score: 0.9, validated: false, source: "modello" }];
    const masked = Masking.masked(entities, text, PIICategory.defaultHidden).map((e) => text.slice(e.start, e.end));
    expect(masked).toEqual(["Edilnord S.r.l.", "Rossi SpA"]);
  });

  /** Senza il contesto di una frase il modello scambia orari e codici brevi per dati a forma fissa: quelli senza la
   *  forma giusta restano in chiaro; quelli veri (e i dati catastali con le loro parole) si nascondono. */
  test("modelPredictionsNeedTheRightShape", () => {
    const text = new PIIText("Ore 14:30 sala A123, cod. 12, carta 4532, targa AB, CF RSSMRA85H12F205Y, al Foglio 12 particella 345, tavolo 7");
    const e = (label: string, value: string, after?: string) => at(text, label, value, { after, score: 0.8 });
    const found = [e("CF", "14:30"), e("CF", "A123"), e("IBAN", "12"), e("CREDITCARDNUMBER", "4532"), e("TARGA", "AB"),
      e("CF", "RSSMRA85H12F205Y"), e("CATASTO", "12", "Foglio"), e("CATASTO", "345"), e("CATASTO", "7")];
    const kept = Masking.masked(found, text, PIICategory.defaultHidden).map((x) => `${x.label}:${text.slice(x.start, x.end)}`);
    expect(kept).toEqual(["CF:RSSMRA85H12F205Y", "CATASTO:12", "CATASTO:345"]);
  });

  /** «Mai nascondere»: senza badare a maiuscole, spazi e forma societaria. */
  test("exceptionsStayInClear", () => {
    const result = hidden(PIICategory.defaultHidden, ["edilnord", "  MARIO  rossi "]);
    expect(!result.includes("ORG:Edilnord S.r.l.") && !result.includes("FULLNAME:Mario Rossi")).toBe(true);
    expect(result).toContain("STREET:via Garibaldi");
  });

  /** I dati già nel dizionario si nascondono anche dove il modello non li vede (l'azienda anche senza «S.r.l.»). */
  test("knownValuesAreMaskedEverywhere", () => {
    const vault = new Vault();
    vault.placeholder("ORG", "Rossi Moto S.r.l.");
    vault.placeholder("FULLNAME", "Martina Verdi");
    vault.placeholder("FULLNAME", "Marco");
    vault.placeholder("CITY", "Roma");
    const page = "Rossi Moto di Roma: parla la titolare martina  verdi, già [FULLNAME_1]. Marco Bianchi commenta.";
    const masked = Masking.maskKnown(page, vault, PIICategory.defaultHidden, new Set());
    // «Marco» da solo è troppo comune; Roma è una città (in chiaro di serie).
    expect(masked.text).toBe("[ORG_1] di Roma: parla la titolare [FULLNAME_1], già [FULLNAME_1]. Marco Bianchi commenta.");
    expect(masked.used).toEqual(["[ORG_1]", "[FULLNAME_1]"]);
    // Un'eccezione vince anche sui dati noti.
    const excepted = Masking.maskKnown(page, vault, PIICategory.defaultHidden, Masking.normalizedExceptions(["Rossi Moto"]));
    expect(excepted.text.startsWith("Rossi Moto di Roma")).toBe(true);
  });

  /** Luoghi presi per persone, aziende o vie (un programma di eventi): restano in chiaro. */
  test("placesAreNotPeopleOrCompanies", () => {
    const text = new PIIText("Hotel → Terrazza; Hotel Palazzo Aureliano · Sala Traiano; Circo Massimo; Castel Sant'Angelo · Lungotevere; "
      + "Centro congressi Via Cavour; Mario Rossi abita in Via Roma 12; Villa Mario e Anna Fontana; Borgo Pio");
    const e = (label: string, value: string) => at(text, label, value);
    const found = [e("ORG", "Hotel"), e("ORG", "Hotel Palazzo Aureliano"), e("FULLNAME", "Circo Massimo"),
      e("FULLNAME", "Castel Sant"), e("STREET", "Lungotevere"), e("STREET", "Via Cavour"),
      e("FULLNAME", "Mario Rossi"), e("STREET", "Via Roma"), e("BUILDINGNUM", "12"),
      e("FULLNAME", "Villa Mario"), e("FULLNAME", "Anna Fontana"), e("FULLNAME", "Borgo Pio")];
    const hiddenValues = Masking.masked(found, text, PIICategory.defaultHidden).map((x) => text.slice(x.start, x.end));
    expect(hiddenValues).toEqual(["Hotel Palazzo Aureliano", "Mario Rossi", "Via Roma", "12", "Villa Mario", "Anna Fontana"]);

    // Anche le voci già finite nel dizionario («Hotel» come azienda) non si cercano più nei testi.
    const vault = new Vault();
    vault.placeholder("ORG", "Hotel");
    vault.placeholder("FULLNAME", "Circo Massimo");
    vault.placeholder("ORG", "Edilnord S.r.l.");
    const matches = Masking.knownMatches(new PIIText("Hotel e Circo Massimo con Edilnord"), vault.entries, PIICategory.defaultHidden, new Set());
    expect(matches.map((m) => m.placeholder)).toEqual(["[ORG_2]"]);
  });

  /** «Nascondi sempre»: parole che il motore non riconosce, nascoste ovunque con la loro categoria. */
  test("forcedTermsAreAlwaysHidden", async () => {
    const { anonymizer } = regexAnonymizer();
    const settings = new AnonymizationSettings({ hidden: ["EMAIL"], forcedTerms: [new ForcedTerm("On Location", "ORG"),
      new ForcedTerm("Progetto Aurora", "OTHER")] });
    const text = "Allestimento di ON  LOCATION per il progetto aurora. Onlocation e On Locationale restano.";
    const result = await anonymizer.anonymize(text, { settings });
    expect(result.text).toBe("Allestimento di [ORG_1] per il [OTHER_1]. Onlocation e On Locationale restano.");
    expect(result.report.summary).toBe("1 azienda, 1 altro dato");
    const revealed = (await anonymizer.reveal(result.text)).text;
    expect(revealed).toBe(text);

    // (Il caso delle tabelle, con «anonymizeFile», sta nelle prove dei formati.)

    // Le impostazioni salvate prima non hanno «nascondi sempre».
    const old = `{"hidden":["ORG"],"exceptions":["Studio Alfa"],"maskKnownValues":false}`;
    const decoded = AnonymizationSettings.fromJSON(JSON.parse(old));
    expect(decoded.forcedTerms.length === 0 && decoded.exceptions.join() === "Studio Alfa" && !decoded.maskKnownValues).toBe(true);
    expect([...decoded.hidden]).toEqual(["ORG"]);
  });

  // In più rispetto a Swift (lì lo provano i formati): il testo a segmenti, con un dato spezzato fra due unità e una
  // colonna riconosciuta dall'intestazione.
  test("segmentedTextUsesTheSameRules", async () => {
    const { anonymizer } = regexAnonymizer();
    const content = new SegmentedText();
    content.addSegment(["Email"], "\t");
    content.addSegment(["Cognome"], "\n");
    content.addSegment(["mario@", "rossi.it"], "\t");
    content.addSegment(["Rossi"], "\n", "FULLNAME");
    const { replacements, report } = await anonymizeSegmented(anonymizer, content, { settings: new AnonymizationSettings() });
    expect(content.applying(replacements)).toEqual(["Email", "Cognome", "[EMAIL_1]", "", "[FULLNAME_1]"]);
    expect(report.summary).toBe("1 nome, 1 email");
  });
});
