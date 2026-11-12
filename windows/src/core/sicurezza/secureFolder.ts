import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { defaultKeyProtection, KeyCustody, KeyFile, type KeyProtection, type KeyProtectionKind } from "./keyCustody";
import { AESGCM } from "./swiftCoding";

// MARK: - La cartella cifrata dell'app
//
// `%APPDATA%\AnoniMaiker\`: una chiave dei dati (sigillata dal custode in `chiave.json`) e i file cifrati con lei: il
// dizionario, il CRM, i documenti dei clienti. Un file che non si riesce ad aprire non si sovrascrive mai. Con una
// cartella che non si apre (su un PC nuovo) si può solo ripristinare una copia di sicurezza: i file vecchi si mettono
// da parte, non si cancellano.
//
// Le operazioni sono sincrone (le funzioni `*Sync` di Node): chi la usa (dizionario e CRM) aggiorna i suoi file senza
// sospendersi a metà, quindi due salvataggi non si sovrappongono mai. È la stessa garanzia del lock sul Mac.

export type FolderErrorCode = "keyMissing" | "cannotUnlock" | "unreadable" | "invalidName" | "sealFailed";

export class FolderError extends Error {
  private constructor(
    readonly code: FolderErrorCode,
    message: string,
    /// Il nome del file (`unreadable`, `invalidName`) o il motivo (`cannotUnlock`).
    readonly detail?: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "FolderError";
  }

  static keyMissing(): FolderError {
    return new FolderError(
      "keyMissing",
      "I dati cifrati ci sono ma la loro chiave no (chiave.json): non li apro e non li sovrascrivo. Puoi ripristinare una copia di sicurezza.",
    );
  }

  static cannotUnlock(reason: string): FolderError {
    return new FolderError(
      "cannotUnlock",
      `Non riesco ad aprire la chiave dei dati (${reason}). Se vengono da un altro PC, la sua protezione non è questa: ripristina una copia di sicurezza.`,
      reason,
    );
  }

  static unreadable(name: string, reason: string): FolderError {
    return new FolderError("unreadable", `Il file «${name}» non è leggibile (${reason}): non lo sovrascrivo.`, name, reason);
  }

  static invalidName(name: string): FolderError {
    return new FolderError("invalidName", `Nome di file non valido: ${name}`, name);
  }

  static sealFailed(): FolderError {
    return new FolderError("sealFailed", "Cifratura non riuscita.");
  }

  /// Stesso caso e stessi valori (come `Equatable` in Swift).
  equals(other: FolderError): boolean {
    return this.code === other.code && this.detail === other.detail && this.reason === other.reason;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SecureFolder {
  static readonly sealedExtension = "sigillato";
  static readonly keyName = "chiave.json";
  /// Le sottocartelle con file cifrati (le altre, come quelle messe da parte, si ignorano).
  static readonly managedFolders = ["documenti", "progetti"];

  readonly directory: string;
  private readonly preferred: KeyProtection | undefined;
  private key: Buffer | null = null;
  private currentProtection: KeyProtectionKind | null = null;

  /// Senza custode si usa quello di serie (`setDefaultKeyProtection`), letto al primo sblocco.
  constructor(directory: string = SecureFolder.defaultDirectory, protection?: KeyProtection) {
    this.directory = directory;
    this.preferred = protection;
  }

  /// `%APPDATA%\AnoniMaiker` su Windows (`~/.anonimaiker` altrove, per le prove). `ANONIMAIKER_DATI` nell'ambiente
  /// indica un'altra cartella (i dati veri non si toccano).
  static get defaultDirectory(): string {
    const override = process.env.ANONIMAIKER_DATI;
    if (override) return override;
    if (process.platform === "win32") {
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "AnoniMaiker");
    }
    return join(homedir(), ".anonimaiker");
  }

  /// Chi custodisce la chiave, una volta sbloccata.
  get protection(): KeyProtectionKind | null {
    return this.currentProtection;
  }

  get keyURL(): string {
    return join(this.directory, SecureFolder.keyName);
  }

  private get protectionInUse(): KeyProtection {
    return this.preferred ?? defaultKeyProtection();
  }

  // MARK: Chiave

  /// Sblocca la chiave; la prima volta (cartella senza dati) la crea.
  unlock(): void {
    this.unlockedKey();
  }

  private unlockedKey(): Buffer {
    if (this.key) return this.key;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (existsSync(this.keyURL)) {
      try {
        const file = KeyFile.decode(readFileSync(this.keyURL, "utf8"));
        const opened = KeyCustody.open(file, [this.protectionInUse]);
        this.key = opened;
        this.currentProtection = file.protection as KeyProtectionKind;
        return opened;
      } catch (error) {
        throw FolderError.cannotUnlock(describe(error));
      }
    }
    if (this.sealedNamesUnlocked().length > 0) throw FolderError.keyMissing();
    return this.createKey();
  }

  private createKey(): Buffer {
    const created = KeyCustody.create(this.protectionInUse);
    SecureFolder.write(Buffer.from(KeyFile.encode(created.file), "utf8"), this.keyURL);
    this.key = created.key;
    this.currentProtection = created.file.protection as KeyProtectionKind;
    return created.key;
  }

  // MARK: File

  /// Il contenuto in chiaro di un file cifrato («dizionario», «crm», «documenti/…»); null se non c'è.
  read(name: string): Buffer | null {
    const key = this.unlockedKey();
    const url = this.sealedURL(name);
    if (!existsSync(url)) return null;
    try {
      return AESGCM.open(readFileSync(url), key);
    } catch (error) {
      throw FolderError.unreadable(name, describe(error));
    }
  }

  /// Scrive un file cifrato (in modo atomico, leggibile solo dal tuo utente).
  write(data: Uint8Array, name: string): void {
    this.writeUnlocked(data, name);
  }

  private writeUnlocked(data: Uint8Array, name: string): void {
    const key = this.unlockedKey();
    const url = this.sealedURL(name);
    mkdirSync(dirname(url), { recursive: true, mode: 0o700 });
    let sealed: Buffer;
    try {
      sealed = AESGCM.seal(data, key);
    } catch {
      throw FolderError.sealFailed();
    }
    SecureFolder.write(sealed, url);
  }

  delete(name: string): void {
    const url = this.sealedURL(name);
    if (existsSync(url)) unlinkSync(url);
  }

  /// I nomi dei file cifrati presenti, senza estensione («crm», «documenti/…»).
  sealedNames(): string[] {
    return this.sealedNamesUnlocked();
  }

  private sealedNamesUnlocked(): string[] {
    const names: string[] = [];
    const suffix = "." + SecureFolder.sealedExtension;
    for (const item of SecureFolder.list(this.directory, false)) {
      if (item.endsWith(suffix)) names.push(item.slice(0, -suffix.length));
    }
    for (const folder of SecureFolder.managedFolders) {
      for (const item of SecureFolder.list(join(this.directory, folder), true)) {
        if (item.endsWith(suffix)) names.push(folder + "/" + item.slice(0, -suffix.length));
      }
    }
    return names.sort();
  }

  /// Tutti i file, in chiaro (per la copia di sicurezza).
  allFiles(): Record<string, Buffer> {
    const key = this.unlockedKey();
    const files: Record<string, Buffer> = {};
    for (const name of this.sealedNamesUnlocked()) {
      const url = this.sealedURL(name);
      try {
        files[name] = AESGCM.open(readFileSync(url), key);
      } catch (error) {
        throw FolderError.unreadable(name, describe(error));
      }
    }
    return files;
  }

  // MARK: Ripristino

  /// Sostituisce tutto con i file dati (in chiaro), cifrati con una chiave nuova di questo PC. Quello che c'era (anche se
  /// non si apriva) finisce in una cartella «Sostituiti il …»: niente si cancella. Restituisce quella cartella.
  replaceAll(files: Record<string, Uint8Array>, now: Date = new Date()): string | null {
    for (const name of Object.keys(files)) this.sealedURL(name);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const current = SecureFolder.list(this.directory, false);
    const movable = current.filter(
      (item) =>
        item === SecureFolder.keyName ||
        item.endsWith("." + SecureFolder.sealedExtension) ||
        SecureFolder.managedFolders.includes(item),
    );
    let aside: string | null = null;
    if (movable.length > 0) {
      const folder = join(this.directory, `Sostituiti il ${SecureFolder.asideStamp(now)}`);
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      for (const item of movable) renameSync(join(this.directory, item), join(folder, item));
      aside = folder;
    }
    this.key = null;
    this.currentProtection = null;
    this.createKey();
    for (const [name, data] of Object.entries(files)) this.writeUnlocked(data, name);
    return aside;
  }

  // MARK: Supporto

  /// Solo nomi semplici dentro la cartella: lettere, numeri, «-», «_» e una sottocartella gestita.
  private sealedURL(name: string): string {
    const parts = name.split("/");
    const valid =
      parts.length > 0 &&
      parts.length <= 2 &&
      parts.every((part) => /^[\p{L}\p{M}\p{N}_-]+$/u.test(part)) &&
      (parts.length === 1 || SecureFolder.managedFolders.includes(parts[0]));
    if (!valid) throw FolderError.invalidName(name);
    return join(this.directory, ...parts) + "." + SecureFolder.sealedExtension;
  }

  /// «2026-11-12 18.05.09», l'ora del PC.
  private static asideStamp(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`
    );
  }

  /// Il contenuto di una cartella (anche delle sottocartelle, con «/»); vuoto se non c'è.
  private static list(directory: string, recursive: boolean): string[] {
    try {
      return (readdirSync(directory, { recursive, encoding: "utf8" }) as string[]).map((item) => item.split(sep).join("/"));
    } catch {
      return [];
    }
  }

  /// Scrittura atomica (file temporaneo accanto e poi rinomina), leggibile solo dal tuo utente.
  static write(data: Uint8Array, url: string): void {
    const temporary = `${url}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      writeFileSync(temporary, data, { mode: 0o600 });
      renameSync(temporary, url);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    chmodSync(url, 0o600);
  }
}
