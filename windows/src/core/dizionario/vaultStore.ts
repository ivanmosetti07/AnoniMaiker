import { FolderError, SecureFolder, type KeyProtection, type KeyProtectionKind } from "../sicurezza";
import { Vault } from "./vault";

// MARK: - Il dizionario su disco, cifrato
//
// Sta nella cartella cifrata dell'app (`dizionario.sigillato`). Ogni modifica si salva subito: è il dizionario che
// permette di riconvertire i file. Un dizionario che non si riesce ad aprire non si sovrascrive mai.

/** Quello che serve della cartella cifrata (`SecureFolder`): nelle prove basta una cartella finta in memoria. */
export interface VaultFolder {
  readonly directory: string;
  readonly protection: KeyProtectionKind | null;
  read(name: string): Uint8Array | null;
  write(data: Uint8Array, name: string): void;
  unlock(): void;
}

/** Come l'attore di Swift: le operazioni passano una alla volta, e nessuno vede un dizionario a metà. */
export class VaultStore {
  static readonly fileName = "dizionario";

  readonly folder: VaultFolder;
  /** Il file cifrato del dizionario («dizionario», o quello di un progetto). */
  readonly fileName: string;
  private vault = new Vault();
  private isOpen = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(folder: VaultFolder, fileName: string = VaultStore.fileName) {
    this.folder = folder;
    this.fileName = fileName;
  }

  /** Un dizionario con la sua cartella (per le prove e la riga di comando). */
  static at(directory: string = SecureFolder.defaultDirectory, protection?: KeyProtection): VaultStore {
    return new VaultStore(new SecureFolder(directory, protection));
  }

  get directory(): string {
    return this.folder.directory;
  }

  /** Chi custodisce la chiave, una volta aperto. */
  get protection(): KeyProtectionKind | null {
    return this.folder.protection;
  }

  private exclusive<T>(body: () => T): Promise<T> {
    const run = this.queue.then(body, body);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private openUnlocked(): Vault {
    if (this.isOpen) return this.vault;
    const data = this.folder.read(this.fileName);
    if (data !== null) {
      try {
        this.vault = Vault.decode(data);
      } catch (error) {
        throw FolderError.unreadable(this.fileName, (error as Error).message);
      }
    } else {
      this.folder.unlock();
    }
    this.isOpen = true;
    return this.vault;
  }

  /** Apre il dizionario; la prima volta crea la chiave. Restituisce una copia. */
  open(): Promise<Vault> {
    return this.exclusive(() => this.openUnlocked().copy());
  }

  /** Il dizionario com'è adesso (una copia). */
  snapshot(): Promise<Vault> {
    return this.open();
  }

  /** Modifica il dizionario e, se è cambiato, lo salva subito cifrato. */
  update<T>(body: (vault: Vault) => T): Promise<T> {
    return this.exclusive(() => {
      const copy = this.openUnlocked().copy();
      const result = body(copy);
      if (!copy.equals(this.vault)) {
        this.folder.write(copy.encode(), this.fileName);
        this.vault = copy;
      }
      return result;
    });
  }

  /** Toglie una voce (il numero resta occupato). */
  remove(placeholder: string): Promise<void> {
    return this.update((vault) => vault.remove(placeholder));
  }

  /** Dopo un ripristino: rilegge dal disco. */
  reload(): Promise<Vault> {
    return this.exclusive(() => {
      this.isOpen = false;
      this.vault = new Vault();
      return this.openUnlocked().copy();
    });
  }
}
