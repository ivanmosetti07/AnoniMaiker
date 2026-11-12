import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentDocument, ChatConversation, ChatMessage, ChatShield, ProjectAgent } from "../src/core/chat";
import { Company, Contact, CRMDatabase, CRMStore, Deal } from "../src/core/crm";
import { TextDocument } from "../src/core/documenti";
import { Vault, VaultStore } from "../src/core/dizionario";
import { CRMExtraction, ProjectSpace, ProjectStore } from "../src/core/progetti";
import { ChatStore } from "../src/core/chat";
import { SecureFolder, fileKeyProtection } from "../src/core/sicurezza";

/// I progetti: migrazione dai dati di prima, archivi separati, CRM che si riempie dai documenti, chat sui documenti.

const directories: string[] = [];
function folder(): [SecureFolder, string] {
  const directory = join(tmpdir(), `anonimizzatore-progetti-${randomUUID()}`);
  directories.push(directory);
  return [new SecureFolder(directory, fileKeyProtection), directory];
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("ProjectTests", () => {
  /// I dati di prima: ogni cliente diventa un progetto con le sue cose; il resto va in «Generale».
  test("legacyDataBecomesProjects", async () => {
    const [secure, directory] = folder();
    const edilnord = Company.create();
    edilnord.name = "Edilnord S.r.l.";
    const alfa = Company.create();
    alfa.name = "Studio Alfa";
    const crm = new CRMDatabase();
    crm.saveCompany(edilnord);
    crm.saveCompany(alfa);
    crm.saveContact(Contact.create("Mario", "Rossi", edilnord.id));
    crm.saveContact(Contact.create("Anna", "Neri"));
    crm.saveDeal(Deal.create("Ristrutturazione", edilnord.id));
    secure.write(crm.data(), CRMStore.fileName);
    const vault = new Vault();
    vault.placeholder("FULLNAME", "Mario Rossi", { client: edilnord.id });
    vault.placeholder("FULLNAME", "Luca Verdi");
    vault.placeholder("ORG", "Studio Alfa", { client: alfa.id });
    secure.write(vault.encode(), VaultStore.fileName);
    const chat = ChatConversation.create({ clientID: edilnord.id, messages: [ChatMessage.create("user", "Ciao", "Ciao")] });
    secure.write(ChatConversation.encodeList([chat]), ChatStore.fileName);

    const store = new ProjectStore(secure);
    const projects = await store.open();
    expect(new Set(projects.map((p) => p.name))).toEqual(new Set(["Edilnord S.r.l.", "Studio Alfa", "Generale"]));
    const edilnordSpace = store.space(projects.find((p) => p.name === "Edilnord S.r.l.")!.id);
    const edilnordCRM = await edilnordSpace.crm.snapshot();
    expect(edilnordCRM.contacts.map(Contact.fullName)).toEqual(["Mario Rossi"]);
    expect(edilnordCRM.deals.length).toBe(1);
    const edilnordVault = await edilnordSpace.vault.snapshot();
    expect(edilnordVault.entries.map((e) => e.placeholder)).toEqual(["[FULLNAME_1]"]);
    expect((await edilnordSpace.chat.open()).length).toBe(1);
    // Un numero già dato non torna libero: la prossima persona di Edilnord è [FULLNAME_3].
    const next = await edilnordSpace.vault.update((v) => v.placeholder("FULLNAME", "Giulia Bianchi").placeholder);
    expect(next).toBe("[FULLNAME_3]");

    const general = store.space(projects.find((p) => p.name === "Generale")!.id);
    expect((await general.crm.snapshot()).contacts.map(Contact.fullName)).toEqual(["Anna Neri"]);
    expect((await general.vault.snapshot()).entries.map((e) => e.value)).toEqual(["Luca Verdi"]);
    // I file di prima non ci sono più, e riaprendo non si migra due volte.
    expect(secure.read(CRMStore.fileName)).toBeNull();
    expect((await new ProjectStore(new SecureFolder(directory, fileKeyProtection)).open()).length).toBe(3);
  });

  test("projectsAreSeparateAndDeletable", async () => {
    const [secure] = folder();
    const store = new ProjectStore(secure);
    expect(await store.open()).toEqual([]);
    const first = await store.create("  Evento Roma  ");
    const second = await store.create("");
    expect(first.name === "Evento Roma" && second.name === "Nuovo progetto").toBe(true);
    await store.space(first.id).vault.update((v) => v.placeholder("FULLNAME", "Mario Rossi"));
    expect((await store.space(second.id).vault.snapshot()).isEmpty).toBe(true);
    // Lo stesso archivio per lo stesso progetto (due archivi sullo stesso file perderebbero modifiche).
    expect(store.space(first.id)).toBe(store.space(first.id));

    const added = await store.space(first.id).crm.addTextDocument("Nota", new TextDocument("x", "plainText"), "nota.txt", null);
    const blob = `documenti/${added.document.versions[0].id}`;
    expect(secure.read(blob)).not.toBeNull();
    const left = await store.delete(first.id);
    expect(left.map((p) => p.id)).toEqual([second.id]);
    expect(secure.read(blob)).toBeNull();
    expect(secure.read(ProjectSpace.fileName(first.id, "dizionario"))).toBeNull();
    expect((await store.rename(second.id, "Fiera Milano"))[0]?.name).toBe("Fiera Milano");
  });

  /// Persone e aziende dei documenti entrano da sole nel CRM del progetto.
  test("crmFillsItselfFromDocuments", () => {
    const vault = new Vault();
    const mario = vault.placeholder("FULLNAME", "Mario Rossi").placeholder;
    const email = vault.placeholder("EMAIL", "mario@rossi.it").placeholder;
    const phone = vault.placeholder("TELEPHONENUM", "+39 333 123 4567").placeholder;
    const org = vault.placeholder("ORG", "Edilnord S.r.l.").placeholder;
    const anna = vault.placeholder("FULLNAME", "Anna").placeholder;
    const neri = vault.placeholder("FULLNAME", "Neri").placeholder;
    const luca = vault.placeholder("FULLNAME", "Luca Verdi").placeholder;
    const giulia = vault.placeholder("FULLNAME", "Giulia Bianchi").placeholder;
    const hotel = vault.placeholder("ORG", "Hotel").placeholder;
    const text = [
      "Nome\tEmail\tTelefono\tAzienda",
      `${mario}\t${email}\t${phone}\t${org}`,
      `${anna}\t${neri}\t\t`,
      `Riunione con ${luca} e ${giulia} in ${hotel}.`,
      `${mario} conferma.`,
    ].join("\n");
    const database = new CRMDatabase();
    const existing = Contact.create("Luca", "Verdi");
    existing.email = "luca@verdi.it";
    database.saveContact(existing);
    const report = CRMExtraction.apply(text, vault, "Partecipanti.xlsx", database);
    expect(new Set(database.contacts.map(Contact.fullName))).toEqual(new Set(["Mario Rossi", "Anna Neri", "Luca Verdi", "Giulia Bianchi"]));
    expect(database.companies.map((c) => c.name)).toEqual(["Edilnord S.r.l."]);
    const rossi = database.contacts.find((c) => Contact.fullName(c) === "Mario Rossi")!;
    expect(rossi.email === "mario@rossi.it" && rossi.phone === "+39 333 123 4567").toBe(true);
    expect(rossi.companyID).toBe(database.companies[0].id);
    expect(rossi.notes).toBe("Trovato in «Partecipanti.xlsx».");
    // Due persone sulla stessa riga: email e telefoni non si attribuiscono; chi c'era già non si duplica.
    expect(database.contacts.find((c) => Contact.fullName(c) === "Luca Verdi")!.email).toBe("luca@verdi.it");
    expect(report.newPeople === 3 && report.newCompanies === 1).toBe(true);
    expect(report.summary).toBe("3 persone e 1 azienda nuove nel CRM");
    // Una seconda volta non aggiunge niente.
    expect(CRMExtraction.apply(text, vault, "x", database).isEmpty).toBe(true);
  });

  test("agentRepliesAreRead", () => {
    const reply = "Mi servono i documenti.\nLEGGI D2\n**LEGGI D3, D5**";
    const reads = ProjectAgent.parse(reply);
    expect(reads.reads).toEqual(["D2", "D3", "D5"]);
    expect(reads.text).toBe("Mi servono i documenti.");

    const proposal = [
      "Ho corretto la data.",
      "<<<MODIFICA d2>>>",
      "Gentile [FULLNAME_1],",
      "la riunione è il 3 ottobre.",
      "<<<FINE>>>",
      "E ti propongo una lettera:",
      "<<<NUOVO Lettera per [ORG_1]>>>",
      "Spett.le [ORG_1]",
      "<<<FINE>>>",
    ].join("\n");
    const parsed = ProjectAgent.parse(proposal);
    expect(parsed.reads).toEqual([]);
    expect(parsed.proposals.length).toBe(2);
    expect(parsed.proposals[0].ref).toBe("D2");
    expect(parsed.proposals[0].content).toBe("Gentile [FULLNAME_1],\nla riunione è il 3 ottobre.");
    expect(parsed.proposals[1].ref === null && parsed.proposals[1].title === "Lettera per [ORG_1]").toBe(true);
    expect(parsed.text).toBe("Ho corretto la data.\n\nE ti propongo una lettera:");

    const documents: AgentDocument[] = [{ ref: "D1", id: randomUUID().toUpperCase(), title: "Contratto [ORG_1]", format: "docx" }];
    const instructions = ProjectAgent.instructions("Evento", documents);
    expect(instructions).toContain("- D1: «Contratto [ORG_1]» (Word)");
    const question = ChatMessage.create("user", "Riassumi", "Riassumi");
    const transcript = ChatShield.transcript([], question, instructions, ["Assistente: LEGGI D1"]);
    expect(transcript.indexOf("Lavori nel progetto")).toBeLessThan(transcript.indexOf("Richiesta:"));
    expect(transcript.endsWith("Non usare strumenti e non modificare file.")).toBe(true);
    const long = ProjectAgent.documentsBlock([{ document: documents[0], text: "a".repeat(ProjectAgent.maxDocumentLength + 10) }]);
    expect(long).toContain("documento tagliato");
  });

  // In più rispetto a Swift: l'elenco dei progetti ha il JSON del Mac (date dal 2001, UUID in maiuscolo).
  test("projectIndexHasTheMacFormat", async () => {
    const [secure] = folder();
    const store = new ProjectStore(secure);
    const project = await store.create("Evento", new Date(Date.UTC(2001, 0, 1, 0, 0, 10)));
    const json = JSON.parse(secure.read(ProjectStore.indexName)!.toString("utf8"));
    expect(json).toEqual([{ id: project.id, name: "Evento", notes: "", created: 10, updated: 10 }]);
    expect(project.id).toBe(project.id.toUpperCase());
    expect(ProjectSpace.fileName(project.id, "crm")).toBe(`progetti/${project.id}_crm`);
  });
});
