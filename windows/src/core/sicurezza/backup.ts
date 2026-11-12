import { pbkdf2Sync, randomBytes } from "node:crypto";
import {
  AESGCM,
  characterCount,
  decodeBase64,
  decodeInt,
  decodeSwiftDate,
  encodeBase64,
  encodeSwiftDate,
  isPlainObject,
} from "./swiftCoding";

// MARK: - La copia di sicurezza, protetta da una password
//
// Un file solo con tutto: dizionario, CRM e documenti. Si cifra con una chiave ricavata dalla password (PBKDF2-SHA256,
// 600.000 iterazioni), non col custode del PC: così si riapre su un altro computer, Mac o PC. Senza la password non si
// apre, e nessuno la può recuperare.
//
// Formato (identico al Mac, byte per byte): «ANONBK01» · lunghezza dell'intestazione (4 byte, big endian) ·
// intestazione JSON (versione, sale, iterazioni, data) · contenuto sigillato con AES-GCM (nonce ‖ cifrato ‖ tag).
// L'intestazione è autenticata insieme al contenuto: se cambia, la copia non si apre.

/// Cosa c'è in una copia (si legge solo dopo averla aperta con la password).
export interface BackupSummary {
  created: Date;
  appVersion: string;
  dictionaryEntries: number;
  companies: number;
  contacts: number;
  deals: number;
  activities: number;
  documents: number;
  /// I progetti (nelle copie delle versioni senza progetti manca).
  projects?: number;
}

/// Quello che serve di un dizionario e di un CRM per contarne il contenuto.
interface CountableVault {
  readonly count: number;
}
interface CountableCRM {
  readonly companies: readonly unknown[];
  readonly contacts: readonly unknown[];
  readonly deals: readonly unknown[];
  readonly activities: readonly unknown[];
  readonly documents: readonly unknown[];
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export const BackupSummary = {
  create(fields: Omit<BackupSummary, "created"> & { created?: Date }): BackupSummary {
    const summary: BackupSummary = { ...fields, created: fields.created ?? new Date() };
    if (summary.projects === undefined) delete summary.projects;
    return summary;
  },

  /// Il riepilogo di tutti i progetti insieme.
  ofProjects(projects: number, vaults: CountableVault[], crms: CountableCRM[], appVersion: string, created: Date = new Date()): BackupSummary {
    return {
      created,
      appVersion,
      dictionaryEntries: sum(vaults.map((vault) => vault.count)),
      companies: sum(crms.map((crm) => crm.companies.length)),
      contacts: sum(crms.map((crm) => crm.contacts.length)),
      deals: sum(crms.map((crm) => crm.deals.length)),
      activities: sum(crms.map((crm) => crm.activities.length)),
      documents: sum(crms.map((crm) => crm.documents.length)),
      projects,
    };
  },

  of(vault: CountableVault, crm: CountableCRM, appVersion: string, created: Date = new Date()): BackupSummary {
    return {
      created,
      appVersion,
      dictionaryEntries: vault.count,
      companies: crm.companies.length,
      contacts: crm.contacts.length,
      deals: crm.deals.length,
      activities: crm.activities.length,
      documents: crm.documents.length,
    };
  },

  /// «120 voci nel dizionario, 12 aziende, 30 contatti…»
  description(summary: BackupSummary): string {
    const part = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
    const head = summary.projects !== undefined ? [part(summary.projects, "progetto", "progetti")] : [];
    return [
      ...head,
      part(summary.dictionaryEntries, "voce nel dizionario", "voci nel dizionario"),
      part(summary.companies, "azienda", "aziende"),
      part(summary.contacts, "persona", "persone"),
      part(summary.deals, "trattativa", "trattative"),
      part(summary.activities, "nota o attività", "note e attività"),
      part(summary.documents, "documento", "documenti"),
    ].join(", ");
  },

  /// Il JSON di `BackupSummary` (Codable sintetizzato: `projects` si omette se manca).
  toJSON(summary: BackupSummary): Record<string, unknown> {
    const json: Record<string, unknown> = {
      created: encodeSwiftDate(summary.created),
      appVersion: summary.appVersion,
      dictionaryEntries: summary.dictionaryEntries,
      companies: summary.companies,
      contacts: summary.contacts,
      deals: summary.deals,
      activities: summary.activities,
      documents: summary.documents,
    };
    if (summary.projects !== undefined) json.projects = summary.projects;
    return json;
  },

  /// Come il decoder sintetizzato: tutti i campi obbligatori, `projects` facoltativo.
  fromJSON(json: unknown): BackupSummary {
    if (!isPlainObject(json)) throw new Error("riepilogo non valido");
    const created = decodeSwiftDate(json.created);
    const ints = ["dictionaryEntries", "companies", "contacts", "deals", "activities", "documents"].map((key) => decodeInt(json[key]));
    if (!created || typeof json.appVersion !== "string" || ints.some((value) => value === null)) throw new Error("riepilogo non valido");
    const [dictionaryEntries, companies, contacts, deals, activities, documents] = ints as number[];
    const summary: BackupSummary = { created, appVersion: json.appVersion, dictionaryEntries, companies, contacts, deals, activities, documents };
    if (json.projects !== undefined && json.projects !== null) {
      const projects = decodeInt(json.projects);
      if (projects === null) throw new Error("riepilogo non valido");
      summary.projects = projects;
    }
    return summary;
  },
};

export type BackupErrorCode = "notABackup" | "unsupportedVersion" | "wrongPassword" | "weakPassword" | "keyDerivationFailed";

export class BackupError extends Error {
  private constructor(
    readonly code: BackupErrorCode,
    message: string,
    readonly version?: number,
  ) {
    super(message);
    this.name = "BackupError";
  }
  static notABackup(): BackupError {
    return new BackupError("notABackup", "Questo file non è una copia di sicurezza di AnoniMaiker.");
  }
  static unsupportedVersion(version: number): BackupError {
    return new BackupError(
      "unsupportedVersion",
      `La copia è di una versione più recente dell'app (formato ${version}): aggiorna l'app.`,
      version,
    );
  }
  static wrongPassword(): BackupError {
    return new BackupError("wrongPassword", "Password sbagliata, oppure la copia è danneggiata.");
  }
  static weakPassword(): BackupError {
    return new BackupError("weakPassword", `La password deve avere almeno ${Backup.minimumPasswordLength} caratteri.`);
  }
  static keyDerivationFailed(): BackupError {
    return new BackupError("keyDerivationFailed", "Non sono riuscito a ricavare la chiave dalla password.");
  }
}

/// L'intestazione in chiaro (ma autenticata).
interface Header {
  version: number;
  created: Date;
  kdf: string;
  iterations: number;
  salt: Uint8Array;
}

/// Una copia aperta con la password: il riepilogo e i file da ripristinare.
export interface BackupContents {
  readonly summary: BackupSummary;
  readonly files: Record<string, Buffer>;
}

export class Backup {
  static readonly fileExtension = "anonimizzatore";
  static readonly defaultIterations = 600_000;
  static readonly minimumPasswordLength = 10;
  static readonly magic = Buffer.from("ANONBK01", "utf8");

  /// La copia di tutti i file (in chiaro), sigillata con la password.
  static make(
    files: Record<string, Uint8Array>,
    summary: BackupSummary,
    password: string,
    iterations: number = Backup.defaultIterations,
  ): Buffer {
    if (characterCount(password) < Backup.minimumPasswordLength) throw BackupError.weakPassword();
    const header: Header = { version: 1, created: summary.created, kdf: "PBKDF2-HMAC-SHA256", iterations, salt: randomBytes(32) };
    const headerData = Buffer.from(
      JSON.stringify({
        version: header.version,
        created: encodeSwiftDate(header.created),
        kdf: header.kdf,
        iterations: header.iterations,
        salt: encodeBase64(header.salt),
      }),
      "utf8",
    );
    const length = Buffer.alloc(4);
    length.writeUInt32BE(headerData.length);
    const prefix = Buffer.concat([Backup.magic, length, headerData]);
    const key = Backup.deriveKey(password, header.salt, iterations);
    const encodedFiles: Record<string, string> = {};
    for (const [name, data] of Object.entries(files)) encodedFiles[name] = encodeBase64(data);
    const payload = Buffer.from(JSON.stringify({ summary: BackupSummary.toJSON(summary), files: encodedFiles }), "utf8");
    return Buffer.concat([prefix, AESGCM.seal(payload, key, prefix)]);
  }

  /// Apre una copia con la password.
  static open(data: Uint8Array, password: string): BackupContents {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const magic = Backup.magic;
    if (bytes.length <= magic.length + 4 || !bytes.subarray(0, magic.length).equals(magic)) throw BackupError.notABackup();
    const lengthStart = magic.length;
    const length = bytes.readUInt32BE(lengthStart);
    const headerStart = lengthStart + 4;
    if (length <= 0 || headerStart + length >= bytes.length) throw BackupError.notABackup();
    const header = Backup.decodeHeader(bytes.subarray(headerStart, headerStart + length));
    if (!header) throw BackupError.notABackup();
    if (header.version > 1) throw BackupError.unsupportedVersion(header.version);
    const prefix = bytes.subarray(0, headerStart + length);
    const key = Backup.deriveKey(password, header.salt, header.iterations);
    let summary: BackupSummary;
    const files: Record<string, Buffer> = {};
    try {
      const payload: unknown = JSON.parse(AESGCM.open(bytes.subarray(headerStart + length), key, prefix).toString("utf8"));
      if (!isPlainObject(payload) || !isPlainObject(payload.files)) throw new Error("contenuto non valido");
      summary = BackupSummary.fromJSON(payload.summary);
      for (const [name, value] of Object.entries(payload.files)) {
        const file = decodeBase64(value);
        if (!file) throw new Error("contenuto non valido");
        files[name] = file;
      }
    } catch {
      throw BackupError.wrongPassword();
    }
    return { summary, files };
  }

  /// Come `JSONDecoder().decode(Header.self, …)`: tutti i campi, coi tipi giusti; null se non va.
  private static decodeHeader(data: Buffer): Header | null {
    let json: unknown;
    try {
      json = JSON.parse(data.toString("utf8"));
    } catch {
      return null;
    }
    if (!isPlainObject(json)) return null;
    const version = decodeInt(json.version);
    const created = decodeSwiftDate(json.created);
    const iterations = decodeInt(json.iterations);
    const salt = decodeBase64(json.salt);
    if (version === null || !created || typeof json.kdf !== "string" || iterations === null || !salt) return null;
    if (iterations < 0 || iterations > 0xffff_ffff) return null;
    return { version, created, kdf: json.kdf, iterations, salt };
  }

  /// PBKDF2-HMAC-SHA256 sulla password normalizzata (NFC: la stessa password scritta su tastiere diverse dà la stessa chiave).
  static deriveKey(password: string, salt: Uint8Array, iterations: number): Buffer {
    try {
      return pbkdf2Sync(Buffer.from(password.normalize("NFC"), "utf8"), salt, iterations, 32, "sha256");
    } catch {
      throw BackupError.keyDerivationFailed();
    }
  }

  /// Un suggerimento sulla robustezza della password (non un giudizio definitivo).
  static strength(password: string): { score: number; label: string } {
    let classes = 0;
    if (/\p{Ll}/u.test(password)) classes += 1;
    if (/[\p{Lu}\p{Lt}]/u.test(password)) classes += 1;
    if (/\p{Nd}/u.test(password)) classes += 1;
    if (/[^\p{L}\p{M}\p{N}]/u.test(password)) classes += 1;
    const length = characterCount(password);
    const score = length < Backup.minimumPasswordLength ? 0 : Math.min(3, (length >= 16 ? 2 : 1) + (classes >= 3 ? 1 : 0));
    const label = ["Troppo corta", "Accettabile", "Buona", "Ottima"][score];
    return { score, label };
  }
}
