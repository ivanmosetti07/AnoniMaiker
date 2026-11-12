import { describe, expect, test } from "vitest";
import { Revealer } from "../src/core/anonimizzazione";
import { Vault } from "../src/core/dizionario";

/** La riconversione: tollerante con le AI e con il Markdown, onesta sui segnaposto che non conosce. */
describe("RevealTests", () => {
  const vault = (): Vault => {
    const vault = new Vault();
    vault.placeholder("FULLNAME", "Mario Rossi");
    vault.placeholder("CF", "RSSMRA85H12F205Y");
    vault.placeholder("ID_DOC", "CA12345AB");
    return vault;
  };

  const reveal = (text: string): string => Revealer.reveal(text, vault()).text;

  test("placeholdersBecomeTheRealData", () => {
    expect(reveal("Gentile [FULLNAME_1], il CF è [CF_1].")).toBe("Gentile Mario Rossi, il CF è RSSMRA85H12F205Y.");
    // Grassetto mantenuto, parentesi con spazi, forma senza parentesi, lettera accentata attaccata.
    expect(reveal("**[FULLNAME_1]**")).toBe("**Mario Rossi**");
    expect(reveal("[ FULLNAME_1 ] e FULLNAME_1 e CF_1è")).toBe("Mario Rossi e Mario Rossi e CF_1è");
    // FULLNAME_10 non è FULLNAME_1.
    expect(reveal("[FULLNAME_10]")).toBe("[FULLNAME_10]");
  });

  /** Il Markdown copiato da ChatGPT mette «\» davanti a parentesi e trattini bassi. */
  test("escapedMarkdownIsUnderstood", () => {
    expect(reveal(String.raw`Gentile \[FULLNAME\_1\], documento \[ID\_DOC\_1\]`)).toBe("Gentile Mario Rossi, documento CA12345AB");
    expect(reveal(String.raw`Firmato: FULLNAME\_1`)).toBe("Firmato: Mario Rossi");
  });

  test("unknownPlaceholdersStayAndAreReported", () => {
    const result = Revealer.reveal("[FULLNAME_1] e [FULLNAME_9], poi di nuovo [FULLNAME_9] e [EMAIL_2]", vault());
    expect(result.text).toBe("Mario Rossi e [FULLNAME_9], poi di nuovo [FULLNAME_9] e [EMAIL_2]");
    expect(result.unknown).toEqual(["[FULLNAME_9]", "[EMAIL_2]"]);
    expect(result.replaced).toEqual(new Map([["[FULLNAME_1]", 1]]));
    expect(result.count).toBe(1);
  });

  /** Solo le categorie del motore: costanti di codice e parole con il trattino basso restano come sono. */
  test("onlyEngineCategoriesArePlaceholders", () => {
    const result = Revealer.reveal("let MAX_SIZE_1 = 3; [NOTE_1] e snake_case_2", vault());
    expect(result.text === "let MAX_SIZE_1 = 3; [NOTE_1] e snake_case_2" && result.unknown.length === 0).toBe(true);
  });

  /** Le posizioni dei dati rimessi, per evidenziarli (anche dopo un'emoji, che in UTF-16 vale 2). */
  test("spansPointAtTheRevealedValues", () => {
    const result = Revealer.reveal("🙂 [FULLNAME_1] ha il CF [CF_1]", vault());
    expect(result.spans.map((s) => result.text.substr(s.location, s.length))).toEqual(["Mario Rossi", "RSSMRA85H12F205Y"]);
    expect(result.spans[0].location).toBe(3);
    expect(Revealer.placeholderRanges("a [FULLNAME_1] b [CF_2]").length).toBe(2);
  });
});
