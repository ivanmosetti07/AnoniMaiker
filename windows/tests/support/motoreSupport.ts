import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Anonymizer, RegexFinder } from "../../src/core/anonimizzazione";
import { VaultStore, type VaultFolder } from "../../src/core/dizionario";
import { PIIEngine, PIIText, type PIIEntity } from "../../src/core/motore";
import { SecureFolder, fileKeyProtection } from "../../src/core/sicurezza";

/** Una cartella cifrata finta, in memoria (stessi metodi di `SecureFolder`). */
export class MemoryFolder implements VaultFolder {
  readonly directory = "memoria";
  protection: "file" | null = null;
  files = new Map<string, Uint8Array>();
  writes = 0;

  read(name: string): Uint8Array | null {
    this.unlock();
    return this.files.get(name) ?? null;
  }

  write(data: Uint8Array, name: string): void {
    this.unlock();
    this.files.set(name, data.slice());
    this.writes += 1;
  }

  unlock(): void {
    this.protection = "file";
  }
}

/** Una cartella temporanea per le prove. */
export function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "anonimizzatore-prove-"));
}

/** Il motore vero (`windows/engine`). Senza, le prove che lo usano si saltano. */
export const TestEngine = {
  directory: join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "engine"),
  shared: null as PIIEngine | null,
  get engine(): PIIEngine {
    TestEngine.shared ??= new PIIEngine(TestEngine.directory);
    return TestEngine.shared;
  },
  get isAvailable(): boolean {
    return new PIIEngine(TestEngine.directory).isInstalled;
  },
  /** Un anonimizzatore col motore vero e un dizionario usa e getta su disco. */
  anonymizer(): { anonymizer: Anonymizer; directory: string } {
    const directory = temporaryDirectory();
    return { anonymizer: new Anonymizer(TestEngine.engine, new VaultStore(new SecureFolder(directory, fileKeyProtection))), directory };
  },
};

/** Per le prove dei formati: un anonimizzatore con la sola rete regex (niente modello) e un dizionario in memoria. */
export function regexAnonymizer(): { anonymizer: Anonymizer; folder: MemoryFolder } {
  const folder = new MemoryFolder();
  return { anonymizer: new Anonymizer(new RegexFinder(), new VaultStore(folder)), folder };
}

/** Le posizioni in code point di `value` dentro `text` (dalla `occurrence`-esima volta, o dopo `after`). */
export function entity(text: PIIText, label: string, value: string, options: { after?: string; occurrence?: number; score?: number } = {}): PIIEntity {
  let from = 0;
  if (options.after !== undefined) from = text.string.indexOf(options.after) + options.after.length;
  let index = text.string.indexOf(value, from);
  for (let n = 0; n < (options.occurrence ?? 0); n++) index = text.string.indexOf(value, index + value.length);
  if (index < 0) throw new Error(`«${value}» non c'è`);
  const start = Array.from(text.string.slice(0, index)).length;
  return { label, start, end: start + Array.from(value).length, score: options.score ?? 0.9, validated: false, source: "modello" };
}
