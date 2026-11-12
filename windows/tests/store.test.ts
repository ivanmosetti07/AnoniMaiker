import { existsSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { VaultStore } from "../src/core/dizionario";
import { FolderError, SecureFolder, fileKeyProtection } from "../src/core/sicurezza";
import { MemoryFolder, temporaryDirectory } from "./support/motoreSupport";

/** Il dizionario cifrato su disco: si riapre, non si legge senza chiave, non si sovrascrive mai se non si apre. */
describe("StoreTests", () => {
  const directories: string[] = [];
  const directory = (): string => {
    const d = temporaryDirectory();
    directories.push(d);
    return d;
  };
  const store = (d: string) => new VaultStore(new SecureFolder(d, fileKeyProtection));
  afterEach(() => {
    for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  test("savesEncryptedAndReopens", async () => {
    const d = directory();
    const vaultStore = store(d);
    await vaultStore.update((vault) => void vault.placeholder("FULLNAME", "Mario Rossi"));
    expect(vaultStore.protection).toBe("file");

    // Sul disco non c'è niente in chiaro.
    const sealed = readFileSync(join(d, "dizionario.sigillato"));
    expect(sealed.includes(Buffer.from("Mario Rossi"))).toBe(false);
    if (process.platform !== "win32") expect(statSync(join(d, "dizionario.sigillato")).mode & 0o777).toBe(0o600);

    // Un'altra apertura (un riavvio dell'app) ritrova la voce.
    expect((await store(d).snapshot()).value("[FULLNAME_1]")).toBe("Mario Rossi");
  });

  /** Senza chiave, o con un dizionario rovinato, l'app si ferma: non ricomincia da zero sopra i dati. */
  test("neverOverwritesWhatItCannotOpen", async () => {
    const d = directory();
    await store(d).update((vault) => void vault.placeholder("EMAIL", "a@b.it"));
    const vaultURL = join(d, "dizionario.sigillato");
    const original = readFileSync(vaultURL);

    // Dizionario alterato: errore, e il file resta com'era.
    const tampered = Buffer.from(original);
    tampered[tampered.length - 1] ^= 0xff;
    writeFileSync(vaultURL, tampered);
    await expect(store(d).snapshot()).rejects.toBeInstanceOf(FolderError);
    expect(readFileSync(vaultURL).equals(tampered)).toBe(true);

    // Chiave sparita: errore, nessuna chiave nuova sopra un dizionario esistente.
    writeFileSync(vaultURL, original);
    unlinkSync(join(d, "chiave.json"));
    await expect(store(d).snapshot()).rejects.toSatisfy((e: unknown) => e instanceof FolderError && e.equals(FolderError.keyMissing()));
    expect(existsSync(join(d, "chiave.json"))).toBe(false);
  });

  // (La custodia con la Secure Enclave è solo del Mac: su Windows c'è DPAPI, provata con la cartella cifrata.)

  /** Con la cartella finta in memoria: si salva solo quando il dizionario cambia, e un JSON rovinato non si sovrascrive. */
  test("savesOnlyWhatChangesAndKeepsWhatItCannotRead", async () => {
    const folder = new MemoryFolder();
    const vaultStore = new VaultStore(folder);
    const placeholder = await vaultStore.update((vault) => vault.placeholder("FULLNAME", "Mario Rossi").placeholder);
    expect(placeholder).toBe("[FULLNAME_1]");
    expect(folder.writes).toBe(1);
    await vaultStore.update((vault) => vault.placeholderFor("FULLNAME", "Mario Rossi"));
    expect(folder.writes).toBe(1);
    // La copia data fuori non tocca il dizionario.
    const copy = await vaultStore.snapshot();
    copy.placeholder("CITY", "Roma");
    expect((await vaultStore.snapshot()).count).toBe(1);
    // Due modifiche insieme passano una alla volta.
    await Promise.all([vaultStore.update((v) => v.placeholder("EMAIL", "a@b.it")), vaultStore.update((v) => v.placeholder("EMAIL", "c@d.it"))]);
    expect((await new VaultStore(folder).snapshot()).entries.map((e) => e.placeholder)).toEqual(["[EMAIL_1]", "[EMAIL_2]", "[FULLNAME_1]"]);

    folder.files.set("dizionario", new TextEncoder().encode("{rotto"));
    await expect(vaultStore.reload()).rejects.toBeInstanceOf(FolderError);
    await expect(new VaultStore(folder).update((v) => v.placeholder("CITY", "Roma"))).rejects.toBeInstanceOf(FolderError);
    expect(new TextDecoder().decode(folder.files.get("dizionario"))).toBe("{rotto");
  });
});
