import { hkdfSync, randomBytes } from "node:crypto";
import { AESGCM, decodeBase64, decodeInt, encodeBase64, isPlainObject } from "./swiftCoding";

// MARK: - La chiave del dizionario
//
// Il dizionario si cifra con una chiave casuale (AES-GCM a 256 bit). Quella chiave non sta mai in chiaro su disco: la
// sigilla un custode. Sul Mac è la Secure Enclave; su Windows è DPAPI (legata all'utente del PC), che usa il processo
// principale di Electron con `safeStorage`: una copia dei file non si apre su un altro PC. Dove il custode non c'è (e
// nelle prove) il custode è un file leggibile solo dal tuo utente, identico a quello del Mac.

/// Chi custodisce la chiave del dizionario: il valore di `protection` in `chiave.json`.
/// - `secureEnclave`: la Secure Enclave di un Mac (su Windows non si apre mai).
/// - `file`: un file accanto al dizionario, con i permessi del solo utente (stesso formato del Mac).
/// - `windowsDPAPI`: DPAPI di Windows, tramite `safeStorage` di Electron.
export type KeyProtectionKind = "secureEnclave" | "file" | "windowsDPAPI";

/// La descrizione di un custode («Secure Enclave di questo Mac»…).
export function describeProtection(kind: KeyProtectionKind): string {
  switch (kind) {
    case "secureEnclave":
      return "Secure Enclave di questo Mac";
    case "file":
      return "file protetto dai permessi del tuo utente";
    case "windowsDPAPI":
      return "protezione dati di Windows (DPAPI) per il tuo utente";
  }
}

/// Un custode della chiave dei dati: sigilla e apre la chiave grezza (32 byte). Sincrono, come la Secure Enclave.
///
/// Su Windows lo realizza il processo principale con `safeStorage` (il core non importa mai `electron`):
///
/// ```ts
/// // main: la chiave in base64 dentro una stringa, perché safeStorage cifra stringhe
/// ipcMain.on("custode:disponibile", (e) => { e.returnValue = safeStorage.isEncryptionAvailable(); });
/// ipcMain.on("custode:sigilla", (e, raw: Uint8Array) => {
///   e.returnValue = { ok: true, data: safeStorage.encryptString(Buffer.from(raw).toString("base64")) };
/// });
/// ipcMain.on("custode:apri", (e, sealed: Uint8Array) => {
///   e.returnValue = { ok: true, data: Buffer.from(safeStorage.decryptString(Buffer.from(sealed)), "base64") };
/// });
/// // preload: setDefaultKeyProtection(windowsKeyProtection(Platform.keyCustody))
/// ```
///
/// Con `kind === "file"` `seal`/`unseal` non si usano: quel custode lo gestisce `KeyCustody` come sul Mac.
export interface KeyProtection {
  readonly kind: KeyProtectionKind;
  readonly description: string;
  isAvailable(): boolean;
  seal(dataKey: Uint8Array): Uint8Array;
  unseal(sealed: Uint8Array): Uint8Array;
}

/// Il custode file (lo stesso del Mac: la chiave del custode sta in `chiave.json`).
export const fileKeyProtection: KeyProtection = {
  kind: "file",
  description: describeProtection("file"),
  isAvailable: () => true,
  seal: (dataKey) => dataKey,
  unseal: (sealed) => sealed,
};

/// Le funzioni sincrone del custode di Windows (quelle di `Platform.keyCustody` nel preload).
export interface WindowsKeyCustody {
  isAvailable(): boolean;
  seal(raw: Uint8Array): Uint8Array;
  unseal(sealed: Uint8Array): Uint8Array;
}

/// Il custode DPAPI, dalle funzioni che il processo principale espone.
export function windowsKeyProtection(custody: WindowsKeyCustody): KeyProtection {
  return {
    kind: "windowsDPAPI",
    description: describeProtection("windowsDPAPI"),
    isAvailable: () => custody.isAvailable(),
    seal: (dataKey) => custody.seal(dataKey),
    unseal: (sealed) => custody.unseal(sealed),
  };
}

/// Un custode in chiaro, solo per le prove: si comporta come DPAPI ma non protegge niente.
export class PlainKeyProtection implements KeyProtection {
  readonly kind: KeyProtectionKind = "windowsDPAPI";
  readonly description = "custode di prova (in chiaro)";
  constructor(private readonly available = true) {}
  isAvailable(): boolean {
    return this.available;
  }
  seal(dataKey: Uint8Array): Uint8Array {
    return Uint8Array.from(dataKey);
  }
  unseal(sealed: Uint8Array): Uint8Array {
    return Uint8Array.from(sealed);
  }
}

let defaultProtection: KeyProtection = fileKeyProtection;

/// Il custode di serie (come `.secureEnclave` sul Mac). Il preload lo imposta all'avvio col custode DPAPI.
export function setDefaultKeyProtection(protection: KeyProtection): void {
  defaultProtection = protection;
}

export function defaultKeyProtection(): KeyProtection {
  return defaultProtection;
}

/// `chiave.json`: la chiave dei dati sigillata dal custode. Stessi campi del Mac (`Data` in base64, i campi assenti
/// non si scrivono).
export interface KeyFile {
  version: number;
  protection: string;
  salt: Uint8Array;
  /// La chiave dei dati, sigillata con la chiave del custode (AES-GCM) o, su Windows, da DPAPI.
  sealedDataKey: Uint8Array;
  /// Solo Secure Enclave: la chiave privata in forma cifrata, utilizzabile solo dalla Secure Enclave di quel Mac.
  enclaveKey?: Uint8Array;
  /// Solo Secure Enclave: la chiave pubblica con cui la Secure Enclave ricava la chiave del custode (ECDH + HKDF).
  peerPublicKey?: Uint8Array;
  /// Solo file: la chiave del custode.
  fileKey?: Uint8Array;
}

export const KeyFile = {
  encode(file: KeyFile): string {
    const json: Record<string, unknown> = {
      version: file.version,
      protection: file.protection,
      salt: encodeBase64(file.salt),
      sealedDataKey: encodeBase64(file.sealedDataKey),
    };
    if (file.enclaveKey) json.enclaveKey = encodeBase64(file.enclaveKey);
    if (file.peerPublicKey) json.peerPublicKey = encodeBase64(file.peerPublicKey);
    if (file.fileKey) json.fileKey = encodeBase64(file.fileKey);
    return JSON.stringify(json);
  },

  /// Come `JSONDecoder().decode(KeyFile.self, …)`: i campi obbligatori devono esserci e avere il tipo giusto.
  decode(text: string): KeyFile {
    const json: unknown = JSON.parse(text);
    if (!isPlainObject(json)) throw new Error("il file della chiave non è valido");
    const version = decodeInt(json.version);
    const salt = decodeBase64(json.salt);
    const sealedDataKey = decodeBase64(json.sealedDataKey);
    if (version === null || typeof json.protection !== "string" || !salt || !sealedDataKey) {
      throw new Error("il file della chiave non è valido");
    }
    const optional = (key: string): Uint8Array | undefined => {
      if (json[key] === undefined || json[key] === null) return undefined;
      const data = decodeBase64(json[key]);
      if (!data) throw new Error("il file della chiave non è valido");
      return data;
    };
    return {
      version,
      protection: json.protection,
      salt,
      sealedDataKey,
      enclaveKey: optional("enclaveKey"),
      peerPublicKey: optional("peerPublicKey"),
      fileKey: optional("fileKey"),
    };
  },
};

export class CustodyError extends Error {
  private constructor(
    readonly code: "incomplete" | "sealFailed" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "CustodyError";
  }
  static incomplete(): CustodyError {
    return new CustodyError("incomplete", "il file della chiave è incompleto");
  }
  static sealFailed(): CustodyError {
    return new CustodyError("sealFailed", "non sono riuscito a sigillare la chiave");
  }
  /// Solo Windows: il custode scritto in `chiave.json` non c'è su questo PC (per esempio la Secure Enclave di un Mac).
  static unavailable(description: string): CustodyError {
    return new CustodyError("unavailable", `il custode della chiave (${description}) non è disponibile su questo PC`);
  }
}

export class KeyCustody {
  // Il nome di prima dell'app (AnoniMaiker): cambiarlo renderebbe illeggibili le chiavi già sigillate.
  static readonly info = Buffer.from("Anonimizzatore AI · chiave del dizionario", "utf8");

  /// Una chiave dei dati nuova, sigillata dal custode richiesto (o dal file, se il custode non c'è).
  static create(preferring: KeyProtection): { key: Buffer; file: KeyFile } {
    const dataKey = randomBytes(32);
    const salt = randomBytes(32);
    if (preferring.kind !== "file" && preferring.kind !== "secureEnclave" && preferring.isAvailable()) {
      let sealed: Uint8Array;
      try {
        sealed = preferring.seal(dataKey);
      } catch {
        throw CustodyError.sealFailed();
      }
      return { key: dataKey, file: { version: 1, protection: preferring.kind, salt, sealedDataKey: sealed } };
    }
    const fileKey = randomBytes(32);
    const custodian = KeyCustody.fileCustodian(fileKey, salt);
    const file: KeyFile = { version: 1, protection: "file", salt, sealedDataKey: AESGCM.seal(dataKey, custodian), fileKey };
    return { key: dataKey, file };
  }

  /// La chiave dei dati, aperta dal suo custode (fra quelli disponibili su questo PC).
  static open(file: KeyFile, protections: KeyProtection[] = []): Buffer {
    switch (file.protection) {
      case "file": {
        if (!file.fileKey) throw CustodyError.incomplete();
        const custodian = KeyCustody.fileCustodian(file.fileKey, file.salt);
        return AESGCM.open(file.sealedDataKey, custodian);
      }
      case "secureEnclave":
        if (!file.enclaveKey || !file.peerPublicKey) throw CustodyError.incomplete();
        throw CustodyError.unavailable(describeProtection("secureEnclave"));
      default: {
        const protection = protections.find((candidate) => candidate.kind === file.protection && candidate.kind !== "file");
        if (!protection || !protection.isAvailable()) {
          const known = ["windowsDPAPI"].includes(file.protection);
          throw CustodyError.unavailable(known ? describeProtection(file.protection as KeyProtectionKind) : file.protection);
        }
        const raw = Buffer.from(protection.unseal(file.sealedDataKey));
        if (raw.length !== 32) throw CustodyError.incomplete();
        return raw;
      }
    }
  }

  /// HKDF<SHA256> sulla chiave del custode file, come sul Mac.
  private static fileCustodian(fileKey: Uint8Array, salt: Uint8Array): Buffer {
    return Buffer.from(hkdfSync("sha256", fileKey, salt, KeyCustody.info, 32));
  }
}
