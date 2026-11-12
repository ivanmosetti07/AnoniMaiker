import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// MARK: - Il JSON e la cifratura come li scrive il Mac
//
// I file cifrati e le copie di sicurezza contengono JSON scritto da `JSONEncoder` di Swift con le impostazioni di serie:
// le date sono secondi (Double) dal 1° gennaio 2001, i `Data` sono base64, gli UUID sono in maiuscolo. AES-GCM nel
// formato «combined» di CryptoKit: nonce (12 byte) ‖ testo cifrato ‖ tag (16 byte).

/// Secondi fra il 1° gennaio 1970 e il 1° gennaio 2001 (la data di riferimento di Foundation).
export const referenceDateOffset = 978_307_200;

/// Una data come la scrive `JSONEncoder` (`.deferredToDate`): secondi dal 2001.
export function encodeSwiftDate(date: Date): number {
  return date.getTime() / 1000 - referenceDateOffset;
}

/// Una data letta da `JSONDecoder`; null se non è un numero. JavaScript tiene i millesimi: oltre si arrotonda al
/// millesimo più vicino.
export function decodeSwiftDate(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(Math.round((value + referenceDateOffset) * 1000));
  return Number.isNaN(date.getTime()) ? null : date;
}

/// `Data` in JSON: base64 con il riempimento, come `Data.base64EncodedString()`.
export function encodeBase64(data: Uint8Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
}

/// Come `Data(base64Encoded:)`: rifiuta quello che non è base64 valido (Buffer invece lo accetterebbe a metà).
export function decodeBase64(value: unknown): Buffer | null {
  if (typeof value !== "string" || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  return Buffer.from(value, "base64");
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/// Un UUID come `UUID(uuidString:)` (maiuscole o minuscole), restituito come lo scrive Swift (`uuidString`, maiuscolo).
export function decodeUUID(value: unknown): string | null {
  return typeof value === "string" && uuidPattern.test(value) ? value.toUpperCase() : null;
}

/// Un UUID nuovo, nel formato di `UUID().uuidString`.
export function newUUID(): string {
  return globalThis.crypto.randomUUID().toUpperCase();
}

/// Un intero come lo accetta `JSONDecoder` (un numero senza parte decimale).
export function decodeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/// Il numero di caratteri come lo conta Swift (`String.count`: grafemi, non unità UTF-16).
export function characterCount(text: string): number {
  let count = 0;
  for (const _ of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) count += 1;
  return count;
}

// MARK: AES-GCM come CryptoKit

export class AESGCM {
  static readonly nonceLength = 12;
  static readonly tagLength = 16;

  /// `AES.GCM.seal(data, using: key, authenticating: aad).combined`.
  static seal(data: Uint8Array, key: Uint8Array, authenticating?: Uint8Array): Buffer {
    const nonce = randomBytes(AESGCM.nonceLength);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: AESGCM.tagLength });
    if (authenticating) cipher.setAAD(authenticating);
    const body = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]);
  }

  /// `AES.GCM.open(AES.GCM.SealedBox(combined:), using: key, authenticating: aad)`.
  static open(combined: Uint8Array, key: Uint8Array, authenticating?: Uint8Array): Buffer {
    if (combined.length < AESGCM.nonceLength + AESGCM.tagLength) throw new Error("dati cifrati troppo corti");
    const bytes = Buffer.from(combined.buffer, combined.byteOffset, combined.byteLength);
    const nonce = bytes.subarray(0, AESGCM.nonceLength);
    const tag = bytes.subarray(bytes.length - AESGCM.tagLength);
    const body = bytes.subarray(AESGCM.nonceLength, bytes.length - AESGCM.tagLength);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: AESGCM.tagLength });
    if (authenticating) decipher.setAAD(authenticating);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      throw new Error("autenticazione dei dati cifrati non riuscita");
    }
  }
}
