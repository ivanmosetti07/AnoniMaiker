import { trimmed } from "../motore";
import { decodeSwiftDate, decodeUUID, encodeSwiftDate, isPlainObject } from "../sicurezza/swiftCoding";

// MARK: - Il dizionario unico: segnaposto ↔ valori veri
//
// Uno solo per tutta l'app: lo stesso dato ha lo stesso segnaposto in tutti i file, e qualsiasi file si riconverte da
// solo, anche se mescola più clienti. Ogni segnaposto è una grafia esatta («MARIO ROSSI» e «Mario Rossi» ne hanno due):
// così un file riconvertito torna identico, maiuscole comprese. Per la chat c'è anche la ricerca che non bada a
// maiuscole e spazi. Ogni voce ricorda a quali clienti del CRM appartiene. Un numero, una volta dato, non torna mai
// libero: se una voce si cancella, «[FULLNAME_7]» non diventerà mai un'altra persona.

/** Un UUID di cliente come lo scrive Swift (in maiuscolo): così il confronto non bada a maiuscole e minuscole. */
function clientID(client: string): string {
  return client.toUpperCase();
}

/** Una voce del dizionario: «[FULLNAME_1]» = «Mario Rossi». */
export class VaultEntry {
  readonly placeholder: string;
  readonly label: string;
  /** Si cambia solo dal dizionario. */
  value: string;
  /** I clienti del CRM a cui il dato appartiene (UUID in maiuscolo). */
  clients: Set<string>;
  readonly created: Date;
  lastUsed: Date;

  constructor(placeholder: string, label: string, value: string, clients: Iterable<string>, created: Date, lastUsed: Date) {
    this.placeholder = placeholder;
    this.label = label;
    this.value = value;
    this.clients = new Set(Array.from(clients, clientID));
    this.created = created;
    this.lastUsed = lastUsed;
  }

  get id(): string {
    return this.placeholder;
  }

  /** Il numero del segnaposto («[FULLNAME_12]» → 12). */
  get number(): number {
    return Vault.split(this.placeholder).number;
  }

  copy(): VaultEntry {
    return new VaultEntry(this.placeholder, this.label, this.value, this.clients, new Date(this.created), new Date(this.lastUsed));
  }

  equals(other: VaultEntry): boolean {
    return this.placeholder === other.placeholder && this.label === other.label && this.value === other.value
      && this.created.getTime() === other.created.getTime() && this.lastUsed.getTime() === other.lastUsed.getTime()
      && this.clients.size === other.clients.size && [...this.clients].every((c) => other.clients.has(c));
  }

  /** Come la scrive `JSONEncoder` di Swift. */
  toJSON(): Record<string, unknown> {
    return {
      placeholder: this.placeholder, label: this.label, value: this.value, clients: [...this.clients],
      created: encodeSwiftDate(this.created), lastUsed: encodeSwiftDate(this.lastUsed),
    };
  }

  static fromJSON(json: unknown): VaultEntry {
    if (!isPlainObject(json)) throw new VaultDecodingError("voce del dizionario non valida");
    const { placeholder, label, value, clients } = json;
    const created = decodeSwiftDate(json.created), lastUsed = decodeSwiftDate(json.lastUsed);
    if (typeof placeholder !== "string" || typeof label !== "string" || typeof value !== "string" || !Array.isArray(clients)
      || created === null || lastUsed === null) {
      throw new VaultDecodingError("voce del dizionario non valida");
    }
    const ids = clients.map(decodeUUID);
    if (ids.some((id) => id === null)) throw new VaultDecodingError("cliente della voce non valido");
    return new VaultEntry(placeholder, label, value, ids as string[], created, lastUsed);
  }
}

/** Il dizionario non si legge (come `DecodingError` di Swift). */
export class VaultDecodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultDecodingError";
  }
}

/** Come cercare un valore già noto: con la stessa grafia (file: riconversione identica), oppure senza badare a
 *  maiuscole e spazi (chat: «mario rossi» è «Mario Rossi»). */
export type VaultMatching = "exact" | "loose";

export class Vault {
  static readonly currentVersion = 1;

  private byPlaceholder = new Map<string, VaultEntry>();
  /** Categoria + valore esatto → segnaposto. */
  private byKey = new Map<string, string>();
  /** Categoria + valore senza badare a maiuscole e spazi → il primo segnaposto con quella forma. */
  private byLooseKey = new Map<string, string>();
  /** Ultimo numero dato per categoria: non scende mai. */
  private counters = new Map<string, number>();

  get isEmpty(): boolean {
    return this.byPlaceholder.size === 0;
  }

  get count(): number {
    return this.byPlaceholder.size;
  }

  /** Le voci in ordine di categoria e numero. */
  get entries(): VaultEntry[] {
    return [...this.byPlaceholder.values()].sort((a, b) =>
      a.label === b.label ? a.number - b.number : a.label < b.label ? -1 : 1);
  }

  entry(placeholder: string): VaultEntry | null {
    return this.byPlaceholder.get(placeholder) ?? null;
  }

  value(placeholder: string): string | null {
    return this.byPlaceholder.get(placeholder)?.value ?? null;
  }

  /** Il segnaposto già dato a un valore, se c'è (`placeholder(forLabel:value:matching:)` in Swift). */
  placeholderFor(label: string, value: string, matching: VaultMatching = "exact"): string | null {
    return this.byKey.get(Vault.key(label, value)) ?? (matching === "loose" ? this.byLooseKey.get(Vault.looseKey(label, value)) ?? null : null);
  }

  /** Spazi compattati, maiuscole e minuscole uguali. */
  static normalized(value: string): string {
    return trimmed(value).replace(/[\t\n\f\r\p{Z}]+/gu, " ").toLowerCase();
  }

  private static key(label: string, value: string): string {
    return label + "\u0000" + trimmed(value);
  }

  private static looseKey(label: string, value: string): string {
    return label + "\u0000" + Vault.normalized(value);
  }

  /** «[FULLNAME_12]» → («FULLNAME», 12). */
  static split(placeholder: string): { label: string; number: number } {
    const inner = placeholder.replace(/^[[\]]+|[[\]]+$/g, "");
    const underscore = inner.lastIndexOf("_");
    if (underscore < 0) return { label: inner, number: 0 };
    const digits = inner.slice(underscore + 1);
    return { label: inner.slice(0, underscore), number: /^[+-]?[0-9]+$/.test(digits) && Number.isSafeInteger(Number(digits)) ? Number(digits) : 0 };
  }

  /** Il segnaposto di un dato (nuovo se non c'era), legato al cliente se c'è. */
  placeholder(label: string, value: string, options: { client?: string | null; matching?: VaultMatching; now?: Date } = {}): { placeholder: string; isNew: boolean } {
    const { client = null, matching = "exact", now = new Date() } = options;
    const existing = this.placeholderFor(label, value, matching);
    if (existing !== null) {
      this.touch(existing, client, now);
      return { placeholder: existing, isNew: false };
    }
    const number = (this.counters.get(label) ?? 0) + 1;
    this.counters.set(label, number);
    const placeholder = `[${label}_${number}]`;
    this.byKey.set(Vault.key(label, value), placeholder);
    const loose = Vault.looseKey(label, value);
    if (!this.byLooseKey.has(loose)) this.byLooseKey.set(loose, placeholder);
    this.byPlaceholder.set(placeholder, new VaultEntry(placeholder, label, value, client !== null ? [client] : [], new Date(now), new Date(now)));
    return { placeholder, isNew: true };
  }

  /** Lega una voce a un cliente del CRM. */
  link(placeholder: string, client: string): void {
    this.byPlaceholder.get(placeholder)?.clients.add(clientID(client));
  }

  /** Una voce usata di nuovo (anche ritrovata fra i dati noti): data dell'ultimo uso e cliente. */
  touch(placeholder: string, client: string | null, now: Date = new Date()): void {
    const entry = this.byPlaceholder.get(placeholder);
    if (!entry) return;
    entry.lastUsed = new Date(now);
    if (client !== null) entry.clients.add(clientID(client));
  }

  /** Toglie una voce: i file che la usano non potranno più riavere quel dato. Il numero resta occupato. */
  remove(placeholder: string): void {
    const entry = this.byPlaceholder.get(placeholder);
    if (!entry) return;
    this.byPlaceholder.delete(placeholder);
    this.byKey.delete(Vault.key(entry.label, entry.value));
    const loose = Vault.looseKey(entry.label, entry.value);
    if (this.byLooseKey.get(loose) === placeholder) {
      // Un'altra grafia dello stesso dato, se c'è, prende il suo posto.
      const other = this.entries.find((e) => Vault.looseKey(e.label, e.value) === loose)?.placeholder;
      if (other !== undefined) this.byLooseKey.set(loose, other); else this.byLooseKey.delete(loose);
    }
  }

  /** Un dizionario con solo alcune voci, con gli stessi segnaposto. I contatori restano quelli di partenza: un numero
   *  già dato non torna libero neanche nel dizionario nuovo. */
  subset(include: (entry: VaultEntry) => boolean): Vault {
    const result = new Vault();
    result.counters = new Map(this.counters);
    for (const entry of this.byPlaceholder.values()) {
      if (!include(entry)) continue;
      result.byPlaceholder.set(entry.placeholder, entry.copy());
      result.byKey.set(Vault.key(entry.label, entry.value), entry.placeholder);
    }
    for (const entry of result.entries) {
      const loose = Vault.looseKey(entry.label, entry.value);
      if (!result.byLooseKey.has(loose)) result.byLooseKey.set(loose, entry.placeholder);
    }
    return result;
  }

  /** Le voci legate a un cliente del CRM. */
  entriesOf(client: string): VaultEntry[] {
    const id = clientID(client);
    return this.entries.filter((e) => e.clients.has(id));
  }

  /** Un cliente esce dal dizionario: le voci solo sue si tolgono, quelle condivise con altri clienti perdono il
   *  collegamento. Restituisce quante voci sono state tolte. */
  removeClient(client: string): number {
    const id = clientID(client);
    let removed = 0;
    for (const entry of this.entriesOf(id)) {
      if (entry.clients.size === 1) {
        this.remove(entry.placeholder);
        removed += 1;
      } else {
        this.byPlaceholder.get(entry.placeholder)?.clients.delete(id);
      }
    }
    return removed;
  }

  // MARK: Valore, non riferimento (come la struct di Swift)

  /** Una copia indipendente. */
  copy(): Vault {
    const result = new Vault();
    for (const [key, entry] of this.byPlaceholder) result.byPlaceholder.set(key, entry.copy());
    result.byKey = new Map(this.byKey);
    result.byLooseKey = new Map(this.byLooseKey);
    result.counters = new Map(this.counters);
    return result;
  }

  /** Come l'Equatable di Swift: tutte le voci, gli indici e i contatori. */
  equals(other: Vault): boolean {
    const sameMap = <V>(a: Map<string, V>, b: Map<string, V>, eq: (x: V, y: V) => boolean) =>
      a.size === b.size && [...a].every(([k, v]) => b.has(k) && eq(v, b.get(k)!));
    return sameMap(this.byPlaceholder, other.byPlaceholder, (x, y) => x.equals(y))
      && sameMap(this.byKey, other.byKey, (x, y) => x === y)
      && sameMap(this.byLooseKey, other.byLooseKey, (x, y) => x === y)
      && sameMap(this.counters, other.counters, (x, y) => x === y);
  }

  // MARK: Su disco: le voci e i contatori; l'indice per valore si ricostruisce.

  toJSON(): { version: number; entries: Record<string, unknown>[]; counters: Record<string, number> } {
    return {
      version: Vault.currentVersion,
      entries: this.entries.map((e) => e.toJSON()),
      counters: Object.fromEntries(this.counters),
    };
  }

  static fromJSON(json: unknown): Vault {
    if (!isPlainObject(json)) throw new VaultDecodingError("dizionario non valido");
    const version = json.version;
    if (typeof version !== "number" || !Number.isInteger(version)) throw new VaultDecodingError("versione del dizionario mancante");
    if (version > Vault.currentVersion) throw new VaultDecodingError(`Dizionario di una versione più recente dell'app (${version})`);
    const vault = new Vault();
    if (!isPlainObject(json.counters)) throw new VaultDecodingError("contatori del dizionario mancanti");
    for (const [label, value] of Object.entries(json.counters)) {
      if (typeof value !== "number" || !Number.isInteger(value)) throw new VaultDecodingError("contatore del dizionario non valido");
      vault.counters.set(label, value);
    }
    if (!Array.isArray(json.entries)) throw new VaultDecodingError("voci del dizionario mancanti");
    const entries = json.entries.map(VaultEntry.fromJSON).sort((a, b) => a.number - b.number);
    for (const entry of entries) {
      vault.byPlaceholder.set(entry.placeholder, entry);
      vault.byKey.set(Vault.key(entry.label, entry.value), entry.placeholder);
      const loose = Vault.looseKey(entry.label, entry.value);
      if (!vault.byLooseKey.has(loose)) vault.byLooseKey.set(loose, entry.placeholder);
      // Per sicurezza: un contatore non è mai sotto i numeri già dati.
      vault.counters.set(entry.label, Math.max(vault.counters.get(entry.label) ?? 0, entry.number));
    }
    return vault;
  }

  /** Il JSON in byte, come `JSONEncoder().encode(vault)`. */
  encode(): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(this));
  }

  /** Come `JSONDecoder().decode(Vault.self, from:)`. */
  static decode(data: Uint8Array | string): Vault {
    let json: unknown;
    try {
      json = JSON.parse(typeof data === "string" ? data : new TextDecoder("utf-8", { fatal: true }).decode(data));
    } catch (error) {
      throw new VaultDecodingError(`JSON non valido: ${(error as Error).message}`);
    }
    return Vault.fromJSON(json);
  }
}
