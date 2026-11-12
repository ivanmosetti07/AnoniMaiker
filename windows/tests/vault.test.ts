import { describe, expect, test } from "vitest";
import { Vault, VaultDecodingError } from "../src/core/dizionario";

const reload = (vault: Vault): Vault => Vault.decode(vault.encode());
const uuid = (): string => globalThis.crypto.randomUUID().toUpperCase();

/** Il dizionario unico: stesso dato, stesso segnaposto; numeri mai riusati; clienti; salvataggio. */
describe("VaultTests", () => {
  test("theSameValueKeepsItsPlaceholder", () => {
    const vault = new Vault();
    const assign = (label: string, value: string): string => {
      const result = vault.placeholder(label, value);
      return result.placeholder + (result.isNew ? " nuovo" : "");
    };
    expect(assign("FULLNAME", "Mario Rossi")).toBe("[FULLNAME_1] nuovo");
    expect(assign("FULLNAME", "  Mario Rossi ")).toBe("[FULLNAME_1]");
    // Ogni grafia ha il suo segnaposto: riconvertendo, le maiuscole tornano com'erano.
    expect(assign("FULLNAME", "MARIO ROSSI")).toBe("[FULLNAME_2] nuovo");
    expect(assign("FULLNAME", "Anna Neri")).toBe("[FULLNAME_3] nuovo");
    expect(assign("CITY", "Roma")).toBe("[CITY_1] nuovo");
    // Stesso testo, categoria diversa: è un altro dato.
    expect(assign("ORG", "Mario Rossi")).toBe("[ORG_1] nuovo");
    expect(vault.entries.map((e) => e.placeholder)).toEqual(["[CITY_1]", "[FULLNAME_1]", "[FULLNAME_2]", "[FULLNAME_3]", "[ORG_1]"]);
    expect(vault.value("[FULLNAME_2]")).toBe("MARIO ROSSI");
  });

  /** Per la chat: senza badare a maiuscole e spazi, «mario  rossi» è la prima grafia nota di Mario Rossi. */
  test("looseMatchingFindsTheFirstSpelling", () => {
    const vault = new Vault();
    vault.placeholder("FULLNAME", "Mario Rossi");
    vault.placeholder("FULLNAME", "MARIO ROSSI");
    expect(vault.placeholder("FULLNAME", "mario  rossi", { matching: "loose" })).toEqual({ placeholder: "[FULLNAME_1]", isNew: false });
    expect(vault.placeholderFor("FULLNAME", "mario rossi")).toBeNull();
    // Tolta la prima grafia, la ricerca trova l'altra; anche dopo il salvataggio.
    vault.remove("[FULLNAME_1]");
    expect(vault.placeholderFor("FULLNAME", "Mario rossi", "loose")).toBe("[FULLNAME_2]");
    expect(reload(vault).placeholderFor("FULLNAME", "mario ROSSI", "loose")).toBe("[FULLNAME_2]");
  });

  /** Un numero cancellato non torna libero: un file vecchio non riavrà mai la persona sbagliata. */
  test("removedNumbersAreNeverReused", () => {
    const vault = new Vault();
    vault.placeholder("FULLNAME", "Mario Rossi");
    vault.placeholder("FULLNAME", "Anna Neri");
    vault.remove("[FULLNAME_2]");
    expect(vault.value("[FULLNAME_2]")).toBeNull();
    expect(vault.placeholder("FULLNAME", "Luca Bianchi").placeholder).toBe("[FULLNAME_3]");
    // Anche dopo il salvataggio.
    const reloaded = reload(vault);
    expect(reloaded.equals(vault)).toBe(true);
    expect(reloaded.placeholder("FULLNAME", "Sara Verdi").placeholder).toBe("[FULLNAME_4]");
    // Il dato cancellato, se ritorna, prende un numero nuovo.
    expect(reloaded.placeholder("FULLNAME", "Anna Neri").placeholder).toBe("[FULLNAME_5]");
  });

  test("entriesRememberTheirClients", () => {
    const vault = new Vault();
    const rossi = uuid(), bianchi = uuid();
    vault.placeholder("FULLNAME", "Mario Rossi", { client: rossi });
    vault.placeholder("FULLNAME", "Mario Rossi", { client: bianchi });
    vault.placeholder("EMAIL", "info@bianchi.it");
    vault.link("[EMAIL_1]", bianchi);
    expect(vault.entry("[FULLNAME_1]")?.clients).toEqual(new Set([rossi, bianchi]));
    expect(vault.entry("[EMAIL_1]")?.clients).toEqual(new Set([bianchi]));
  });

  test("aNewerVaultIsNotOpened", () => {
    const json = `{"version": 99, "entries": [], "counters": {}}`;
    expect(() => Vault.decode(json)).toThrow(VaultDecodingError);
  });

  // In più rispetto a Swift: il formato su disco è quello di `JSONEncoder` (date in secondi dal 2001, UUID in maiuscolo).
  test("readsAVaultWrittenByTheMac", () => {
    const json = `{"version":1,"counters":{"FULLNAME":3},"entries":[{"placeholder":"[FULLNAME_2]","label":"FULLNAME","value":"Mario Rossi",`
      + `"clients":["1b4e28ba-2fa1-11d2-883f-0016d3cca427"],"created":784111777.5,"lastUsed":784111800}]}`;
    const vault = Vault.decode(json);
    const entry = vault.entry("[FULLNAME_2]")!;
    expect(entry.created.toISOString()).toBe("2025-11-06T08:49:37.500Z");
    expect([...entry.clients]).toEqual(["1B4E28BA-2FA1-11D2-883F-0016D3CCA427"]);
    expect(vault.entriesOf("1b4e28ba-2fa1-11d2-883f-0016d3cca427").length).toBe(1);
    expect(vault.placeholder("FULLNAME", "Anna Neri").placeholder).toBe("[FULLNAME_4]");
    const again = JSON.parse(new TextDecoder().decode(vault.encode()));
    expect(again.entries[0].created).toBe(784111777.5);
    expect(again.version).toBe(1);
  });
});
