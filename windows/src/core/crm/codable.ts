import { decodeInt, decodeSwiftDate, decodeUUID, encodeSwiftDate, isPlainObject } from "../sicurezza/swiftCoding";

// MARK: - La lettura tollerante dei dati del CRM
//
// Come l'estensione di `KeyedDecodingContainer` sul Mac: `value(key, default:)` è `(try? decodeIfPresent(…)) ?? default`.
// Un campo che manca, è null o ha il tipo sbagliato prende il suo valore di partenza. Un elenco si legge tutto o niente:
// se un elemento non si legge (per esempio senza `id`), l'elenco intero torna al valore di partenza, come in Swift.

/// Un decodificatore: il valore letto, o null se il JSON non ha la forma giusta.
export type Decode<T> = (value: unknown) => T | null;

export type JSONObject = Record<string, unknown>;

/// Un errore di lettura (in Swift `DecodingError`).
export class DecodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodingError";
  }
}

export function container(json: unknown): JSONObject {
  if (!isPlainObject(json)) throw new DecodingError("mi aspettavo un oggetto JSON");
  return json;
}

/// `c.value(.key, default: …)`.
export function value<T>(c: JSONObject, key: string, decode: Decode<T>, fallback: T): T {
  const raw = c[key];
  if (raw === undefined || raw === null) return fallback;
  const decoded = decode(raw);
  return decoded === null ? fallback : decoded;
}

/// `try c.decode(…, forKey: .key)`: il campo deve esserci.
export function required<T>(c: JSONObject, key: string, decode: Decode<T>): T {
  const decoded = c[key] === undefined || c[key] === null ? null : decode(c[key]);
  if (decoded === null) throw new DecodingError(`campo «${key}» mancante o non valido`);
  return decoded;
}

export const decodeString: Decode<string> = (v) => (typeof v === "string" ? v : null);
export const decodeBool: Decode<boolean> = (v) => (typeof v === "boolean" ? v : null);
/// `Decimal`: un numero JSON.
export const decodeDecimal: Decode<number> = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export { decodeInt, decodeUUID };
export const decodeDate: Decode<Date> = decodeSwiftDate;

/// Un enum con valore grezzo stringa: solo i casi conosciuti.
export function decodeEnum<T extends string>(cases: readonly T[]): Decode<T> {
  return (v) => (typeof v === "string" && (cases as readonly string[]).includes(v) ? (v as T) : null);
}

/// Un elenco: tutto o niente (un elemento che non si legge fa fallire l'elenco intero).
export function decodeArray<T>(element: (value: unknown) => T): Decode<T[]> {
  return (v) => {
    if (!Array.isArray(v)) return null;
    try {
      return v.map((item) => element(item));
    } catch {
      return null;
    }
  };
}

export const encodeDate = encodeSwiftDate;
