import { describe, expect, test } from "vitest";
import { PIICategory, PIIDetectors, PIIText, Validators } from "../src/core/motore";

/** Rete regex e codici di controllo: girano senza il modello. */
describe("DetectorsTests", () => {
  function labels(text: string): string[] {
    const source = new PIIText(text);
    return PIIDetectors.detect(source).sort((a, b) => a.start - b.start).map((e) => `${e.label}:${source.slice(e.start, e.end)}`);
  }

  test("checksums", () => {
    expect(PIIDetectors.cfOK("RSSMRA85H12F205Y") && !PIIDetectors.cfOK("RSSMRA85H12F205X")).toBe(true);
    expect(PIIDetectors.cfOK("BNCLCU90A41H50MO")).toBe(true);                    // omocodia: cifre sostituite da lettere
    expect(PIIDetectors.pivaOK("12345678903") && !PIIDetectors.pivaOK("12345678901")).toBe(true);
    expect(PIIDetectors.ibanOK("IT60X0542811101000000123456") && PIIDetectors.ibanOK("IT60 X054 2811 1010 0000 0123 456")).toBe(true);
    expect(PIIDetectors.ibanOK("IT99X9999999999999999999999")).toBe(false);
    expect(PIIDetectors.luhnOK("4111 1111 1111 1111") && !PIIDetectors.luhnOK("4111 1111 1111 1112")).toBe(true);
  });

  test("regexNetwork", () => {
    expect(labels("Accredito su ES91 2100 0418 4502 0005 1332 come da mandato.")).toEqual(["IBAN:ES91 2100 0418 4502 0005 1332"]);
    expect(labels("Coordinate: IT60 X054 2811\n1010 0000 0123 456 presso la filiale.")).toEqual(["IBAN:IT60 X054 2811\n1010 0000 0123 456"]);
    // La scadenza attaccata alla carta resta fuori; una carta con il Luhn sbagliato non è una carta.
    expect(labels("Carta 4111 1111 1111 1111 12/26 intestata.")).toContain("CREDITCARDNUMBER:4111 1111 1111 1111");
    expect(labels("Carta 4111 1111 1111 1112.").some((l) => l.startsWith("CREDITCARDNUMBER"))).toBe(false);
    expect(labels("Cell. +39-333-123-4567 per contatti.")).toEqual(["TELEPHONENUM:+39-333-123-4567"]);
    expect(labels("Vedi https://www.studiorossi.it/contatti. Grazie")).toContain("URL:https://www.studiorossi.it/contatti");
    expect(labels("Aggiornata alla versione 2.3.55.987 del pacchetto.")).toEqual([]);
    expect(labels("rete 192.168.1.0/24 e range 192.168.1.1-192.168.1.20")).toEqual(["IPADDR:192.168.1.0/24", "IPADDR:192.168.1.1-192.168.1.20"]);
    expect(labels("Prot. n. 456/2024 e Rep. 45 del notaio.")).toEqual(["DOCID:Prot. n. 456/2024", "DOCID:Rep. 45"]);
    expect(labels("Targa AB-123-CD e importo € 1.250,00")).toContain("TARGA:AB-123-CD");
    expect(labels("Targa AB-123-CD e importo € 1.250,00")).toContain("AMOUNT:€ 1.250,00");
  });

  test("categoriesAreConsistent", () => {
    expect(new Set(PIICategory.all)).toEqual(new Set([...PIICategory.personal, ...PIICategory.companies, ...PIICategory.workingData]));
    expect(PIICategory.defaultHidden.has("ORG") && PIICategory.defaultHidden.has("FULLNAME")).toBe(true);
    expect(PIICategory.workingData.some((l) => PIICategory.defaultHidden.has(l))).toBe(false);
    expect(PIICategory.name("CF", 1) === "codice fiscale" && PIICategory.title("CF") === "Codici fiscali").toBe(true);
  });

  // In più rispetto a Swift: le regole di ICU che JavaScript non ha da solo (cifre, \b e \w Unicode, posizioni).
  test("icuSemanticsAndCodePoints", () => {
    // Una lettera accentata attaccata non è un confine di parola (ICU): niente codice fiscale dentro una parola.
    expect(labels("èRSSMRA85H12F205Y")).toEqual([]);
    expect(new Set(labels("è RSSMRA85H12F205Y"))).toEqual(new Set(["CF:RSSMRA85H12F205Y"]));
    // Le posizioni sono in code point anche dopo un'emoji (2 unità UTF-16).
    const text = new PIIText("🙂🙂 mail a anna@studio.it");
    const [email] = PIIDetectors.detect(text);
    expect([email.start, email.end, text.slice(email.start, email.end)]).toEqual([10, 24, "anna@studio.it"]);
    expect(Validators.isValidEmail("a@b.it") && Validators.isValidEmail("a@b.it\n") && !Validators.isValidEmail("a@b")).toBe(true);
    expect(Validators.isValidTaxCode("RSS MRA 85H12 F205Y") && Validators.isValidTaxCode("12345678903")).toBe(true);
  });
});
