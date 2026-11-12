import { cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { CRMDatabase, CRMStore, Company, DocumentVersion, CRMDocument } from "../src/core/crm";
import { TextDocument } from "../src/core/documenti";
import { VaultStore } from "../src/core/dizionario";
import {
  AESGCM,
  Backup,
  BackupError,
  BackupSummary,
  FolderError,
  KeyCustody,
  KeyFile,
  PlainKeyProtection,
  SecureFolder,
  fileKeyProtection,
} from "../src/core/sicurezza";

/// La cartella cifrata e la copia di sicurezza con password: si riapre su un altro computer, mai senza la password giusta.

const fixtures = join(__dirname, "fixtures", "mac");
/// La password delle copie fatte dallo script Swift di prova (con una lettera accentata: conta la normalizzazione NFC).
const macPassword = "una password lunga é";

const directories: string[] = [];
function temporaryDirectory(): string {
  const directory = join(tmpdir(), `anonimizzatore-prove-${randomUUID()}`);
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/// Una cartella con dizionario, CRM e un documento.
async function filledFolder(): Promise<[SecureFolder, string]> {
  const directory = temporaryDirectory();
  const folder = new SecureFolder(directory, fileKeyProtection);
  await new VaultStore(folder).update((vault) => {
    vault.placeholder("FULLNAME", "Mario Rossi");
  });
  const crm = new CRMStore(folder);
  const company = Company.create("Edilnord S.r.l.", "client");
  await crm.update((db) => db.saveCompany(company));
  await crm.addTextDocument("Verbale", new TextDocument("Incontro con Mario Rossi.", "markdown"), "verbale.md", company.id);
  return [folder, directory];
}

describe("BackupTests", () => {
  it("a backup opens on another computer with the password", async () => {
    const [folder] = await filledFolder();
    const summary = BackupSummary.of(await new VaultStore(folder).snapshot(), await new CRMStore(folder).snapshot(), "prova");
    const backup = Backup.make(folder.allFiles(), summary, "una password lunga", 1_000);
    // Nella copia non c'è niente in chiaro.
    expect(backup.includes(Buffer.from("Mario Rossi"))).toBe(false);
    expect(backup.includes(Buffer.from("Edilnord"))).toBe(false);

    const contents = Backup.open(backup, "una password lunga");
    expect(contents.summary.dictionaryEntries).toBe(1);
    expect(contents.summary.companies).toBe(1);
    expect(contents.summary.documents).toBe(1);
    expect(new Set(Object.keys(contents.files)).size).toBe(3);

    // Un altro computer: cartella nuova, chiave nuova, stessi dati.
    const otherFolder = new SecureFolder(temporaryDirectory(), fileKeyProtection);
    otherFolder.replaceAll(contents.files);
    expect((await new VaultStore(otherFolder).snapshot()).value("[FULLNAME_1]")).toBe("Mario Rossi");
    const crm = new CRMStore(otherFolder);
    const database = await crm.snapshot();
    const document = database.documents[0];
    expect(database.companies[0]?.name).toBe("Edilnord S.r.l.");
    expect((await crm.text(CRMDocument.original(document)!, document)).text).toBe("Incontro con Mario Rossi.");
  });

  it("wrong passwords and other files are refused", () => {
    const summary = BackupSummary.create({ appVersion: "prova", dictionaryEntries: 0, companies: 0, contacts: 0, deals: 0, activities: 0, documents: 0 });
    const backup = Backup.make({ crm: Buffer.from("{}") }, summary, "password giusta!", 1_000);
    expect(() => Backup.open(backup, "password sbagliata")).toThrow(BackupError.wrongPassword().message);
    // L'intestazione è autenticata: cambiarla (per esempio le iterazioni) rende la copia inapribile.
    const tampered = Buffer.from(backup);
    const headerStart = Backup.magic.length + 4;
    expect(tampered.subarray(headerStart, headerStart + 60).toString("utf8")).toContain("{");
    tampered[headerStart + 1] = tampered[headerStart + 1] === 0x61 ? 0x62 : 0x61;
    expect(() => Backup.open(tampered, "password giusta!")).toThrow(BackupError);
    expect(() => Backup.open(Buffer.from("non sono una copia"), "password giusta!")).toThrow(BackupError.notABackup().message);
    expect(() => Backup.make({}, summary, "corta")).toThrow(BackupError.weakPassword().message);
    expect(Backup.strength("corta").score).toBe(0);
    expect(Backup.strength("Una-Password-Robusta-2026").score).toBe(3);
  });

  /// Su un PC nuovo la cartella copiata non si apre: il ripristino mette da parte i file vecchi, non li cancella.
  it("restoring over an unopenable folder sets the old files aside", async () => {
    const [folder, directory] = await filledFolder();
    const files = folder.allFiles();
    // La chiave di «un altro Mac»: non si apre.
    writeFileSync(join(directory, "chiave.json"), `{"version":1,"protection":"secureEnclave","salt":"AAAA","sealedDataKey":"AAAA"}`);
    const stranger = new SecureFolder(directory, fileKeyProtection);
    expect(() => stranger.unlock()).toThrow(FolderError);

    const aside = stranger.replaceAll(files);
    expect(aside).not.toBeNull();
    expect(existsSync(join(aside!, "chiave.json"))).toBe(true);
    expect(existsSync(join(aside!, "dizionario.sigillato"))).toBe(true);
    expect((await new VaultStore(stranger).snapshot()).value("[FULLNAME_1]")).toBe("Mario Rossi");
    // La cartella messa da parte non conta fra i dati.
    expect(stranger.sealedNames().every((name) => !name.includes("Sostituiti"))).toBe(true);
  });

  it("only simple names inside the folder", () => {
    const folder = new SecureFolder(temporaryDirectory(), fileKeyProtection);
    for (const name of ["../fuori", "documenti/../../x", "altro/x", "a/b/c", "", "con spazio"]) {
      expect(() => folder.write(new Uint8Array(), name)).toThrow(FolderError.invalidName(name).message);
    }
    folder.write(Buffer.from("ok"), `documenti/${randomUUID().toUpperCase()}`);
    expect(folder.sealedNames().length).toBe(1);
  });
});

describe("Formato della copia (uguale al Mac)", () => {
  it("una copia fatta qui ha il formato del Mac e si apre", () => {
    const created = new Date(Date.UTC(2026, 10, 12, 10, 0, 0, 500));
    const summary = BackupSummary.create({
      created,
      appVersion: "0.15",
      dictionaryEntries: 2,
      companies: 1,
      contacts: 0,
      deals: 0,
      activities: 0,
      documents: 0,
      projects: 3,
    });
    const files = { crm: Buffer.from('{"version":1}'), "documenti/ABC": Buffer.from([0, 1, 2, 255]) };
    const backup = Backup.make(files, summary, "Pässwörd lunga", 1_000);

    // «ANONBK01» · lunghezza (big endian) · intestazione JSON · nonce ‖ cifrato ‖ tag.
    expect(backup.subarray(0, 8).toString("utf8")).toBe("ANONBK01");
    const length = backup.readUInt32BE(8);
    const header = JSON.parse(backup.subarray(12, 12 + length).toString("utf8"));
    expect(Object.keys(header).sort()).toEqual(["created", "iterations", "kdf", "salt", "version"]);
    expect(header).toMatchObject({ version: 1, kdf: "PBKDF2-HMAC-SHA256", iterations: 1_000 });
    expect(header.created).toBe(created.getTime() / 1000 - 978_307_200);
    expect(Buffer.from(header.salt, "base64").length).toBe(32);

    // Si apre a mano, come farebbe CryptoKit: PBKDF2 sulla password NFC, AES-GCM con l'intestazione come dati autenticati.
    const prefix = backup.subarray(0, 12 + length);
    const key = Backup.deriveKey("Pässwörd lunga".normalize("NFD"), Buffer.from(header.salt, "base64"), 1_000);
    const payload = JSON.parse(AESGCM.open(backup.subarray(12 + length), key, prefix).toString("utf8"));
    expect(Object.keys(payload).sort()).toEqual(["files", "summary"]);
    expect(payload.files).toEqual({ crm: Buffer.from('{"version":1}').toString("base64"), "documenti/ABC": "AAEC/w==" });
    expect(payload.summary).toMatchObject({ appVersion: "0.15", dictionaryEntries: 2, projects: 3 });

    // E con l'app: stessa password scritta in un'altra normalizzazione.
    const contents = Backup.open(backup, "Pässwörd lunga".normalize("NFD"));
    expect(contents.summary).toEqual(summary);
    expect(contents.files["documenti/ABC"]).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(BackupSummary.description(contents.summary)).toBe(
      "3 progetti, 2 voci nel dizionario, 1 azienda, 0 persone, 0 trattative, 0 note e attività, 0 documenti",
    );
  });

  /// La copia `fixtures/mac/mac.anonimizzatore` è fatta sul Mac col codice Swift vero (Backup.swift, SecureFolder.swift,
  /// CRMModel.swift copiati in uno script di prova).
  it("una copia fatta sul Mac si apre qui, CRM compreso", () => {
    const contents = Backup.open(readFileSync(join(fixtures, "mac.anonimizzatore")), macPassword);
    expect(contents.summary.appVersion).toBe("mac-prova");
    expect(contents.summary.projects).toBeUndefined();
    expect(Object.keys(contents.files).sort()).toEqual(["crm", "dizionario", "documenti/9D648020-9DF8-43EA-9DB1-307BB5F5BA6B"]);
    expect(contents.files["documenti/9D648020-9DF8-43EA-9DB1-307BB5F5BA6B"]).toEqual(
      Buffer.from("Perché Mario Rossi è d'accordo.", "latin1"),
    );
    const database = CRMDatabase.fromData(contents.files.crm);
    expect(comparable(database)).toBe(readFileSync(join(fixtures, "mac-crm.json"), "utf8"));
    expect(database.deals[0].amount).toBe(12500.5);
    expect(database.companies[0].name).toBe("Edilnord S.r.l. – Società “Àccènti”");
    expect(CRMDocument.answers(database.documents[0])[0].format).toBe("plainText");
    expect(() => Backup.open(readFileSync(join(fixtures, "mac.anonimizzatore")), "una password lunga e")).toThrow(BackupError);
  });

  /// Una cartella del Mac col custode file (quello delle prove) si apre anche qui: stessa `chiave.json`.
  it("una cartella del Mac col custode file si apre qui", () => {
    const directory = temporaryDirectory();
    cpSync(join(fixtures, "mac-cartella"), directory, { recursive: true });
    const folder = new SecureFolder(directory, fileKeyProtection);
    const database = CRMDatabase.fromData(folder.read("crm")!);
    expect(folder.protection).toBe("file");
    expect(comparable(database)).toBe(readFileSync(join(fixtures, "mac-crm.json"), "utf8"));
    expect(folder.sealedNames()).toEqual(["crm", "dizionario", "documenti/9D648020-9DF8-43EA-9DB1-307BB5F5BA6B"]);
  });

  /// Con `ANONIMAIKER_VERIFICA_MAC=<cartella>` la prova scrive una cartella e una copia fatte qui, dai dati del Mac, per
  /// farle aprire allo script Swift.
  it.runIf(Boolean(process.env.ANONIMAIKER_VERIFICA_MAC))("scrive una copia di Windows per il Mac", () => {
    const out = process.env.ANONIMAIKER_VERIFICA_MAC!;
    const mac = Backup.open(readFileSync(join(fixtures, "mac.anonimizzatore")), macPassword);
    const database = CRMDatabase.fromData(mac.files.crm);
    const files = { ...mac.files, crm: database.data() };
    rmSync(join(out, "win-cartella"), { recursive: true, force: true });
    const folder = new SecureFolder(join(out, "win-cartella"), fileKeyProtection);
    folder.replaceAll(files);
    const summary = BackupSummary.of({ count: 1 }, database, "windows-prova");
    writeFileSync(join(out, "win.anonimizzatore"), Backup.make(folder.allFiles(), summary, macPassword, 1_000));
  });
});

describe("Il custode della chiave", () => {
  it("chiave.json col custode file ha i campi del Mac", () => {
    const directory = temporaryDirectory();
    new SecureFolder(directory, fileKeyProtection).unlock();
    const json = JSON.parse(readFileSync(join(directory, "chiave.json"), "utf8"));
    expect(Object.keys(json).sort()).toEqual(["fileKey", "protection", "salt", "sealedDataKey", "version"]);
    expect(json.protection).toBe("file");
    expect(Buffer.from(json.sealedDataKey, "base64").length).toBe(12 + 32 + 16);
  });

  // Su Windows i permessi POSIX non esistono (la cartella è già del solo utente, in %APPDATA%).
  it.skipIf(process.platform === "win32")("i file sono leggibili solo dal tuo utente", () => {
    const directory = temporaryDirectory();
    new SecureFolder(directory, fileKeyProtection).write(Buffer.from("x"), "documenti/ABC");
    expect(statSync(join(directory, "chiave.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, "documenti", "ABC.sigillato")).mode & 0o777).toBe(0o600);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
  });

  it("il custode di Windows sigilla la chiave e la cartella si riapre solo con lui", () => {
    const directory = temporaryDirectory();
    const custody = new PlainKeyProtection();
    const folder = new SecureFolder(directory, custody);
    folder.write(Buffer.from("segreto"), "crm");
    expect(folder.protection).toBe("windowsDPAPI");
    const file = KeyFile.decode(readFileSync(join(directory, "chiave.json"), "utf8"));
    expect(file.protection).toBe("windowsDPAPI");
    expect(file.fileKey).toBeUndefined();
    expect(KeyCustody.open(file, [custody]).length).toBe(32);

    expect(new SecureFolder(directory, new PlainKeyProtection()).read("crm")?.toString()).toBe("segreto");
    // Senza il custode (o se non è disponibile) non si apre, e non si sovrascrive.
    expect(() => new SecureFolder(directory, fileKeyProtection).read("crm")).toThrow(FolderError);
    expect(() => new SecureFolder(directory, new PlainKeyProtection(false)).write(Buffer.from("x"), "crm")).toThrow(FolderError);
    expect(new SecureFolder(directory, custody).read("crm")?.toString()).toBe("segreto");
  });

  it("se il custode di Windows non c'è si usa il file", () => {
    const folder = new SecureFolder(temporaryDirectory(), new PlainKeyProtection(false));
    folder.unlock();
    expect(folder.protection).toBe("file");
  });

  it("dati senza chiave non si aprono e non si sovrascrivono", () => {
    const directory = temporaryDirectory();
    const folder = new SecureFolder(directory, fileKeyProtection);
    folder.write(Buffer.from("x"), "crm");
    rmSync(join(directory, "chiave.json"));
    const again = new SecureFolder(directory, fileKeyProtection);
    expect(() => again.write(Buffer.from("y"), "crm")).toThrow(FolderError.keyMissing().message);
  });

  it("un file cifrato rovinato non si legge", () => {
    const directory = temporaryDirectory();
    const folder = new SecureFolder(directory, fileKeyProtection);
    folder.write(Buffer.from("x"), "crm");
    const sealed = readFileSync(join(directory, "crm.sigillato"));
    sealed[sealed.length - 1] ^= 1;
    writeFileSync(join(directory, "crm.sigillato"), sealed);
    expect(() => folder.read("crm")).toThrow(FolderError);
    expect(() => folder.allFiles()).toThrow(FolderError);
  });

  it("la cartella di serie segue ANONIMAIKER_DATI", () => {
    const previous = process.env.ANONIMAIKER_DATI;
    process.env.ANONIMAIKER_DATI = join(tmpdir(), "prova-dati");
    expect(SecureFolder.defaultDirectory).toBe(join(tmpdir(), "prova-dati"));
    if (previous === undefined) delete process.env.ANONIMAIKER_DATI;
    else process.env.ANONIMAIKER_DATI = previous;
  });
});

/// Il CRM come lo confronta lo script Swift: chiavi in ordine, date in millisecondi dal 1970 arrotondati.
function comparable(database: CRMDatabase): string {
  const dateKeys = new Set(["created", "updated", "date", "due", "expectedClose"]);
  const convert = (value: unknown, key?: string): unknown => {
    if (Array.isArray(value)) return value.map((item) => convert(item));
    if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(entries.map(([k, v]) => [k, convert(v, k)]));
    }
    if (key && dateKeys.has(key) && typeof value === "number") return Math.round((value + 978_307_200) * 1000);
    return value;
  };
  return JSON.stringify(convert(database.encode()));
}

// Le versioni dei documenti si chiamano come il loro file cifrato.
it("il nome del file cifrato di una versione", () => {
  const version = DocumentVersion.create("original");
  expect(DocumentVersion.blobName(version)).toBe(`documenti/${version.id}`);
});
