import { deflateSync, inflateSync } from "fflate";

// MARK: - Archivi ZIP (i file .xlsx e .docx)
//
// Excel e Word salvano i documenti come archivi ZIP di file XML. Qui si leggono e si riscrivono a mano: DEFLATE
// «grezzo» con fflate, CRC-32 calcolato qui. Le voci che non cambiano si ricopiano byte per byte, compresse com'erano.
// Niente ZIP64 (servirebbe sopra i 4 GB) e niente archivi cifrati.

export class ZipEntry {
  readonly name: string;
  /** Contenuto in chiaro. */
  private _data: Uint8Array;
  method: number;
  modificationTime: number;
  modificationDate: number;
  externalAttributes: number;
  /** I byte compressi originali, finché il contenuto non cambia. */
  original: { compressed: Uint8Array; crc: number } | null = null;

  constructor(name: string, data: Uint8Array, method = 8) {
    this.name = name;
    this._data = data;
    this.method = method;
    const { time, date } = ZipEntry.dosDateTime(new Date());
    this.modificationTime = time;
    this.modificationDate = date;
    this.externalAttributes = 0;
  }

  get data(): Uint8Array {
    return this._data;
  }

  /** Nuovo contenuto: al salvataggio si ricomprime. */
  replace(data: Uint8Array): void {
    this._data = data;
    this.original = null;
    if (this.method === 0) this.method = 8;
  }

  /** Una copia indipendente (in Swift `ZipEntry` è un valore). */
  copy(): ZipEntry {
    const entry = new ZipEntry(this.name, this._data, this.method);
    entry.modificationTime = this.modificationTime;
    entry.modificationDate = this.modificationDate;
    entry.externalAttributes = this.externalAttributes;
    entry.original = this.original;
    return entry;
  }

  static dosDateTime(date: Date): { time: number; date: number } {
    const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff;
    const day = ((Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
    return { time, date: day };
  }
}

export type ZipErrorKind = "notAnArchive" | "unsupported" | "corrupted";

export class ZipError extends Error {
  readonly kind: ZipErrorKind;
  readonly detail: string;

  private constructor(kind: ZipErrorKind, detail = "") {
    super(ZipError.describe(kind, detail));
    this.name = "ZipError";
    this.kind = kind;
    this.detail = detail;
  }

  static notAnArchive(): ZipError {
    return new ZipError("notAnArchive");
  }

  static unsupported(reason: string): ZipError {
    return new ZipError("unsupported", reason);
  }

  static corrupted(name: string): ZipError {
    return new ZipError("corrupted", name);
  }

  private static describe(kind: ZipErrorKind, detail: string): string {
    switch (kind) {
      case "notAnArchive":
        return "Il file non è un documento Office valido (archivio ZIP non leggibile).";
      case "unsupported":
        return `Documento non gestito: ${detail}.`;
      case "corrupted":
        return `Il documento è danneggiato (${detail}).`;
    }
  }
}

const utf8Decoder = new TextDecoder("utf-8");
const utf8Encoder = new TextEncoder();

export abstract class ZipArchive {
  static readonly ZipError = ZipError;

  // MARK: Lettura

  static read(data: Uint8Array): ZipEntry[] {
    const bytes = data;
    const end = ZipArchive.endOfCentralDirectory(bytes);
    if (end === null) throw ZipError.notAnArchive();
    const count = u16(bytes, end + 10);
    let offset = u32(bytes, end + 16);
    if (count === 0xffff || offset === 0xffffffff) throw ZipError.unsupported("archivio ZIP64");
    const entries: ZipEntry[] = [];
    for (let k = 0; k < count; k++) {
      if (!(offset + 46 <= bytes.length && u32(bytes, offset) === 0x02014b50)) throw ZipError.corrupted("indice dell'archivio");
      const flags = u16(bytes, offset + 8);
      const method = u16(bytes, offset + 10);
      const time = u16(bytes, offset + 12);
      const date = u16(bytes, offset + 14);
      const crc = u32(bytes, offset + 16);
      const compressedSize = u32(bytes, offset + 20);
      const size = u32(bytes, offset + 24);
      const nameLength = u16(bytes, offset + 28);
      const extraLength = u16(bytes, offset + 30);
      const commentLength = u16(bytes, offset + 32);
      const attributes = u32(bytes, offset + 38);
      const localOffset = u32(bytes, offset + 42);
      if (!(offset + 46 + nameLength <= bytes.length)) throw ZipError.corrupted("indice dell'archivio");
      const name = utf8Decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      offset += 46 + nameLength + extraLength + commentLength;
      if ((flags & 1) !== 0) throw ZipError.unsupported("documento protetto da password");
      if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
        throw ZipError.unsupported("archivio ZIP64");
      }
      // L'intestazione locale può avere un campo extra diverso da quello dell'indice.
      if (!(localOffset + 30 <= bytes.length && u32(bytes, localOffset) === 0x04034b50)) throw ZipError.corrupted(name);
      const start = localOffset + 30 + u16(bytes, localOffset + 26) + u16(bytes, localOffset + 28);
      if (!(start + compressedSize <= bytes.length)) throw ZipError.corrupted(name);
      const compressed = bytes.slice(start, start + compressedSize);
      let content: Uint8Array;
      switch (method) {
        case 0:
          content = compressed;
          break;
        case 8:
          content = ZipArchive.inflate(compressed, size, name);
          break;
        default:
          throw ZipError.unsupported(`compressione ${method} in ${name}`);
      }
      if (ZipArchive.crc32(content) !== crc) throw ZipError.corrupted(name);
      const entry = new ZipEntry(name, content, method);
      entry.modificationTime = time;
      entry.modificationDate = date;
      entry.externalAttributes = attributes;
      entry.original = { compressed, crc };
      entries.push(entry);
    }
    return entries;
  }

  private static endOfCentralDirectory(bytes: Uint8Array): number | null {
    if (bytes.length < 22) return null;
    const lowest = Math.max(0, bytes.length - 22 - 65_535);
    for (let index = bytes.length - 22; index >= lowest; index--) {
      if (u32(bytes, index) === 0x06054b50) return index;
    }
    return null;
  }

  private static inflate(data: Uint8Array, size: number, name: string): Uint8Array {
    if (size <= 0) return new Uint8Array(0);
    let output: Uint8Array;
    try {
      output = inflateSync(data);
    } catch {
      throw ZipError.corrupted(name);
    }
    if (output.length !== size) throw ZipError.corrupted(name);
    return output;
  }

  // MARK: Scrittura

  static write(entries: ZipEntry[]): Uint8Array {
    const output = new ByteWriter();
    const central = new ByteWriter();
    for (const entry of entries) {
      const offset = output.length;
      let crc: number;
      let compressed: Uint8Array;
      let method = entry.method;
      if (entry.original) {
        ({ compressed, crc } = entry.original);
      } else {
        crc = ZipArchive.crc32(entry.data);
        const deflated = method === 8 ? ZipArchive.deflate(entry.data) : null;
        if (deflated) {
          compressed = deflated;
        } else {
          method = 0;
          compressed = entry.data;
        }
      }
      if (!(output.length < 0xffffffff && compressed.length < 0xffffffff)) throw ZipError.unsupported("archivio oltre i 4 GB");
      const name = utf8Encoder.encode(entry.name);
      const utf8Flag = /^[\x00-\x7f]*$/.test(entry.name) ? 0 : 0x0800;
      output.u32(0x04034b50);
      output.u16(20);
      output.u16(utf8Flag);
      output.u16(method);
      output.u16(entry.modificationTime);
      output.u16(entry.modificationDate);
      output.u32(crc);
      output.u32(compressed.length);
      output.u32(entry.data.length);
      output.u16(name.length);
      output.u16(0);
      output.bytes(name);
      output.bytes(compressed);

      central.u32(0x02014b50);
      central.u16(20);
      central.u16(20);
      central.u16(utf8Flag);
      central.u16(method);
      central.u16(entry.modificationTime);
      central.u16(entry.modificationDate);
      central.u32(crc);
      central.u32(compressed.length);
      central.u32(entry.data.length);
      central.u16(name.length);
      central.u16(0);
      central.u16(0);
      central.u16(0);
      central.u16(0);
      central.u32(entry.externalAttributes);
      central.u32(offset);
      central.bytes(name);
    }
    const centralOffset = output.length;
    const centralBytes = central.result();
    output.bytes(centralBytes);
    output.u32(0x06054b50);
    output.u16(0);
    output.u16(0);
    output.u16(entries.length);
    output.u16(entries.length);
    output.u32(centralBytes.length);
    output.u32(centralOffset);
    output.u16(0);
    return output.result();
  }

  /** DEFLATE grezzo; `null` se non conviene (il contenuto si salva così com'è). */
  private static deflate(data: Uint8Array): Uint8Array | null {
    if (data.length === 0) return null;
    const output = deflateSync(data, { level: 6 });
    if (!(output.length > 0 && output.length < data.length)) return null;
    return output;
  }

  // MARK: Supporto

  private static readonly crcTable: Uint32Array = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
      let value = index;
      for (let k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();

  static crc32(data: Uint8Array): number {
    const table = ZipArchive.crcTable;
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/** Un buffer che cresce, per scrivere l'archivio. */
class ByteWriter {
  private buffer = new Uint8Array(1024);
  length = 0;

  private reserve(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let capacity = this.buffer.length * 2;
    while (capacity < this.length + extra) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
  }

  u16(value: number): void {
    this.reserve(2);
    this.buffer[this.length++] = value & 0xff;
    this.buffer[this.length++] = (value >>> 8) & 0xff;
  }

  u32(value: number): void {
    this.reserve(4);
    this.buffer[this.length++] = value & 0xff;
    this.buffer[this.length++] = (value >>> 8) & 0xff;
    this.buffer[this.length++] = (value >>> 16) & 0xff;
    this.buffer[this.length++] = (value >>> 24) & 0xff;
  }

  bytes(data: Uint8Array): void {
    this.reserve(data.length);
    this.buffer.set(data, this.length);
    this.length += data.length;
  }

  result(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

// Le funzioni sugli array di voci (in Swift un'estensione di `[ZipEntry]`).

/** La voce con quel nome. */
export function entryNamed(entries: readonly ZipEntry[], name: string): ZipEntry | undefined {
  return entries.find((entry) => entry.name === name);
}

/** Nuovo contenuto per una voce: si sostituisce con una copia, così gli altri array che la condividono non cambiano. */
export function replaceEntry(entries: ZipEntry[], name: string, data: Uint8Array): void {
  const index = entries.findIndex((entry) => entry.name === name);
  if (index < 0) return;
  const entry = entries[index].copy();
  entry.replace(data);
  entries[index] = entry;
}
