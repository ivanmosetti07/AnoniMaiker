import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Activity, ClientDossier, Company, Contact, CRMDatabase, CRMDocument, CRMStore, Deal } from "../src/core/crm";
import { FormatError, TextDocument } from "../src/core/documenti";
import { Vault } from "../src/core/dizionario";
import { Validators } from "../src/core/motore";
import { SecureFolder, encodeSwiftDate, fileKeyProtection } from "../src/core/sicurezza";

/// Il CRM: salvataggio cifrato, cancellazioni a cascata, documenti con le loro versioni, scheda del cliente, dati noti.

const directories: string[] = [];
function temporaryFolder(): [SecureFolder, string] {
  const directory = join(tmpdir(), `anonimizzatore-prove-${randomUUID()}`);
  directories.push(directory);
  return [new SecureFolder(directory, fileKeyProtection), directory];
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function sample(): [CRMDatabase, Company, Contact, Deal] {
  const database = new CRMDatabase();
  const company = Company.create("Edilnord S.r.l.", "client");
  company.vatNumber = "12345678903";
  company.taxCode = "12345678903";
  company.email = "info@edilnord.it";
  company.phone = "02 1234567";
  company.street = "via Garibaldi 24";
  company.zipCode = "20121";
  company.city = "Milano";
  company.province = "MI";
  const contact = Contact.create("Mario", "Rossi", company.id);
  contact.role = "Direttore acquisti";
  contact.email = "mario.rossi@edilnord.it";
  contact.mobile = "333 123 4567";
  const deal = Deal.create("Nuovo sito web", company.id);
  deal.stage = "proposal";
  deal.probability = 50;
  deal.amount = 12500;
  deal.contactID = contact.id;
  deal.expectedClose = new Date(2026, 10, 30);
  const call = Activity.create("call", "Chiesto lo sconto sul primo anno", company.id);
  call.contactID = contact.id;
  call.date = new Date(2026, 9, 12);
  const task = Activity.create("task", "Inviare il preventivo firmato", company.id);
  task.due = new Date(2026, 9, 1);
  database.saveCompany(company);
  database.saveContact(contact);
  database.saveDeal(deal);
  database.saveActivity(call);
  database.saveActivity(task);
  return [database, company, contact, deal];
}

describe("CRMTests", () => {
  it("saves encrypted and reopens", async () => {
    const [folder, directory] = temporaryFolder();
    const [database, company] = sample();
    await new CRMStore(folder).update((db) => Object.assign(db, database.clone()));
    const sealed = readFileSync(join(directory, "crm.sigillato"));
    expect(sealed.includes(Buffer.from("Edilnord"))).toBe(false);
    const reopened = await new CRMStore(new SecureFolder(directory, fileKeyProtection)).snapshot();
    expect(reopened.equals(database)).toBe(true);
    expect(reopened.company(company.id)?.name).toBe("Edilnord S.r.l.");
  });

  /// Un CRM salvato da una versione più vecchia (senza alcuni campi) si apre lo stesso.
  it("older data still opens", () => {
    const id = randomUUID().toUpperCase();
    const database = CRMDatabase.decode(JSON.parse(`{"version":1,"companies":[{"id":"${id}","name":"Vecchia S.r.l."}]}`));
    expect(database.company(id)?.name).toBe("Vecchia S.r.l.");
    expect(database.company(id)?.status).toBe("prospect");
    expect(database.contacts).toEqual([]);
  });

  it("deleting a company takes its data away", async () => {
    const [folder] = temporaryFolder();
    const [database, company] = sample();
    const other = Company.create("Altra S.p.A.");
    database.saveCompany(other);
    database.saveContact(Contact.create("Anna", "Neri", other.id));
    const store = new CRMStore(folder);
    await store.update((db) => Object.assign(db, database.clone()));
    await store.addTextDocument("Nota", new TextDocument("x", "plainText"), "nota.txt", company.id);
    expect(folder.sealedNames().length).toBe(2);
    expect(database.removalCounts(company.id)).toEqual({ contacts: 1, deals: 1, activities: 2, documents: 0 });

    const after = await store.deleteCompany(company.id);
    expect(after.companies.map((c) => c.name)).toEqual(["Altra S.p.A."]);
    expect(after.contacts.map(Contact.fullName)).toEqual(["Anna Neri"]);
    expect(after.deals).toEqual([]);
    expect(after.activities).toEqual([]);
    expect(after.documents).toEqual([]);
    expect(folder.sealedNames()).toEqual(["crm"]);
  });

  it("documents keep their versions", async () => {
    const [folder, directory] = temporaryFolder();
    const store = new CRMStore(folder);
    // Un file di Windows (Windows-1252): l'originale si conserva byte per byte.
    const file = join(directory, "Verbale Rossi.txt");
    mkdirSync(directory, { recursive: true });
    const bytes = Buffer.from("Perché Mario Rossi è d'accordo.", "latin1");
    writeFileSync(file, bytes);
    const { document } = await store.addDocumentFromFile(file, null);
    expect(document.title).toBe("Verbale Rossi");
    expect(CRMDocument.original(document)?.fileName).toBe("Verbale Rossi.txt");
    const original = await store.text(CRMDocument.original(document)!, document);
    expect(original.text).toBe("Perché Mario Rossi è d'accordo.");
    expect(Buffer.from(original.data())).toEqual(bytes);

    const anonymized = new TextDocument("Perché [FULLNAME_1] è d'accordo.", original.kind, original.encoding, original.hasBOM);
    await store.setAnonymized(anonymized, "1 nome", document.id);
    await store.setAnonymized(anonymized, "1 nome", document.id); // sostituisce, non si accumula
    await store.addAnswer(new TextDocument("Gentile [FULLNAME_1], grazie.", "plainText"), "risposta.txt", "", document.id);
    let current = (await store.snapshot()).document(document.id)!;
    expect(current.versions.map((v) => v.kind)).toEqual(["original", "anonymized", "aiAnswer"]);
    expect(folder.sealedNames().length).toBe(4);
    const anonymizedText = await store.text(CRMDocument.anonymized(current)!, current);
    expect(anonymizedText.text).toBe("Perché [FULLNAME_1] è d'accordo.");
    expect(anonymizedText.encoding).toBe("windowsCP1252");

    // L'originale non si toglie; una risposta sì.
    await store.removeVersion(CRMDocument.original(current)!.id, document.id);
    await store.removeVersion(CRMDocument.answers(current)[0].id, document.id);
    current = (await store.snapshot()).document(document.id)!;
    expect(current.versions.map((v) => v.kind)).toEqual(["original", "anonymized"]);
    expect(folder.sealedNames().length).toBe(3);

    await store.deleteDocument(document.id);
    expect(folder.sealedNames()).toEqual(["crm"]);
  });

  /// I documenti salvati dalla versione 0.2 (solo testo e Markdown, con «kind») si aprono ancora.
  it("documents from the first versions still open", () => {
    const id = randomUUID().toUpperCase();
    const version = randomUUID().toUpperCase();
    const json = `{"id":"${id}","title":"Verbale","kind":"markdown","versions":[{"id":"${version}","kind":"original","fileName":"v.md","encoding":4,"hasBOM":false}]}`;
    const document = CRMDocument.decode(JSON.parse(json));
    expect(document.format).toBe("markdown");
    expect(CRMDocument.original(document)?.id).toBe(version);
    expect(CRMDocument.formatOf(document, CRMDocument.original(document)!)).toBe("markdown");
  });

  /// Un file Excel nella scheda del cliente: l'originale resta identico; la risposta dell'AI può essere testo incollato.
  it("office files in the client record", async () => {
    const [folder, directory] = temporaryFolder();
    const store = new CRMStore(folder);
    // Basta un contenuto qualunque: l'archivio non apre il file, lo conserva.
    const workbook = Buffer.from("PK\u0003\u0004 finto xlsx", "latin1");
    mkdirSync(directory, { recursive: true });
    const file = join(directory, "Clienti 2026.xlsx");
    writeFileSync(file, workbook);
    const { document } = await store.addDocumentFromFile(file, null);
    expect(document.format).toBe("xlsx");
    expect(document.title).toBe("Clienti 2026");
    expect(Buffer.from(await store.data(CRMDocument.original(document)!))).toEqual(workbook);
    await store.addAnswer(new TextDocument("Riepilogo per [FULLNAME_1]", "markdown"), "", "", document.id);
    const current = (await store.snapshot()).document(document.id)!;
    expect(CRMDocument.formatOf(current, CRMDocument.answers(current)[0])).toBe("markdown");
    // I file del vecchio Office si rifiutano, spiegando cosa fare.
    const old = join(directory, "vecchio.xls");
    writeFileSync(old, "x");
    await expect(store.addDocumentFromFile(old, null)).rejects.toThrow(FormatError);
  });

  it("client dossier", () => {
    const [database, company] = sample();
    const now = new Date(2026, 9, 15);
    const dossier = ClientDossier.markdown(company.id, database, now)!;
    expect(dossier.startsWith("# Edilnord S.r.l.\n\nCliente")).toBe(true);
    expect(dossier).toContain("- Partita IVA: 12345678903");
    expect(dossier).toContain("- Sede: via Garibaldi 24, 20121 Milano (MI)");
    expect(dossier).toContain("- Mario Rossi — Direttore acquisti — mario.rossi@edilnord.it — 333 123 4567");
    expect(dossier).toContain(
      "- Nuovo sito web — Preventivo inviato — 12.500,00 € — probabilità 50% — chiusura prevista 30/11/2026 — referente Mario Rossi",
    );
    expect(dossier).toContain("- Inviare il preventivo firmato (entro il 01/10/2026, scaduta)");
    expect(dossier).toContain("- 12/10/2026 · Chiamata con Mario Rossi: Chiesto lo sconto sul primo anno");
  });

  it("known values of a client", () => {
    const [database, company] = sample();
    const known = database.knownValues(company.id).map((v) => `${v.label}:${v.value}`);
    // Partita IVA e codice fiscale uguali: una voce sola.
    expect(known).toEqual([
      "ORG:Edilnord S.r.l.",
      "PIVA:12345678903",
      "EMAIL:info@edilnord.it",
      "TELEPHONENUM:02 1234567",
      "FULLNAME:Mario Rossi",
      "EMAIL:mario.rossi@edilnord.it",
      "TELEPHONENUM:333 123 4567",
    ]);
  });

  /// Un cliente che esce dal CRM esce anche dal dizionario; le voci condivise con altri clienti restano.
  it("removing a client from the dictionary", () => {
    const vault = new Vault();
    const rossi = randomUUID().toUpperCase();
    const bianchi = randomUUID().toUpperCase();
    vault.placeholder("ORG", "Edilnord S.r.l.", { client: rossi });
    vault.placeholder("FULLNAME", "Mario Rossi", { client: rossi });
    vault.placeholder("FULLNAME", "Mario Rossi", { client: bianchi });
    expect(vault.entriesOf(rossi).length).toBe(2);
    expect(vault.removeClient(rossi)).toBe(1);
    expect(vault.value("[ORG_1]")).toBeNull();
    expect([...(vault.entry("[FULLNAME_1]")?.clients ?? [])]).toEqual([bianchi]);
  });

  it("validators", () => {
    expect(Validators.isValidVATNumber("12345678903") && !Validators.isValidVATNumber("12345678901")).toBe(true);
    expect(Validators.isValidTaxCode("RSSMRA85H12F205Y") && Validators.isValidTaxCode("12345678903")).toBe(true);
    expect(Validators.isValidIBAN("IT60 X054 2811 1010 0000 0123 456") && !Validators.isValidIBAN("IT00X0542811101000000123456")).toBe(true);
    expect(Validators.isValidEmail("a.b@c.it") && !Validators.isValidEmail("a.b@c")).toBe(true);
  });
});

describe("Il JSON del CRM (uguale al Mac)", () => {
  it("si scrive coi nomi, le date e i facoltativi di JSONEncoder", () => {
    const [database, , , deal] = sample();
    const json = database.encode() as { version: number; deals: Record<string, unknown>[]; contacts: Record<string, unknown>[] };
    expect(json.version).toBe(1);
    const encodedDeal = json.deals[0];
    expect(Object.keys(encodedDeal)).toEqual([
      "id", "title", "companyID", "contactID", "stage", "amount", "probability", "expectedClose", "notes", "created", "updated",
    ]);
    expect(encodedDeal.expectedClose).toBe(encodeSwiftDate(deal.expectedClose!));
    expect(encodedDeal.id).toMatch(/^[0-9A-F-]{36}$/);
    // I facoltativi vuoti non si scrivono (encodeIfPresent).
    const loose = Deal.create("Senza azienda");
    expect(Object.keys(Deal.encode(loose))).not.toContain("companyID");
    expect(Object.keys(Deal.encode(loose))).not.toContain("amount");
    // I documenti non scrivono più «kind».
    expect(Object.keys(CRMDocument.encode(CRMDocument.create("x", "pdf", null)))).toEqual([
      "id", "title", "format", "versions", "created", "updated",
    ]);
  });

  it("la lettura è tollerante come sul Mac", () => {
    const id = randomUUID();
    const database = CRMDatabase.decode({
      companies: [{ id, name: 42, status: "sconosciuto", created: "ieri", notes: null }],
      // Un contatto senza id fa cadere tutto l'elenco, come in Swift.
      contacts: [{ id: randomUUID(), firstName: "Anna" }, { firstName: "Senza id" }],
      deals: [{ id: randomUUID(), stage: "won", amount: "tanti" }],
      activities: [{ id: randomUUID(), isDone: 1, due: 815000000.5 }],
    });
    const company = database.companies[0];
    expect(company.id).toBe(id.toUpperCase());
    expect(company.name).toBe("");
    expect(company.status).toBe("prospect");
    expect(database.contacts).toEqual([]);
    expect(database.deals[0].probability).toBe(100);
    expect(database.deals[0].amount).toBeNull();
    expect(database.activities[0].isDone).toBe(false);
    expect(database.activities[0].due?.toISOString()).toBe("2026-10-29T20:53:20.500Z");
    expect(() => CRMDatabase.decode({ version: 2 })).toThrow("CRM di una versione più recente dell'app (2)");
  });
});
