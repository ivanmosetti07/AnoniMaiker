import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { Masking, Revealer, type AnonymizationSettings } from "../anonimizzazione";
import type { Vault } from "../dizionario";

// MARK: - Documenti di testo: .txt e .md
//
// Si legge la codifica dell'originale (UTF-8 con o senza BOM, UTF-16, oppure Windows-1252 e Latin-1 dei file vecchi) e
// si riscrive uguale: a-capo, BOM e codifica non cambiano. Se un dato vero non sta nella codifica originale (un nome
// con lettere che Latin-1 non ha), il file riconvertito si salva in UTF-8.

export type TextDocumentKind = "plainText" | "markdown";

/** Le codifiche gestite (in Swift `String.Encoding`). */
export type TextEncoding = "utf8" | "utf16LittleEndian" | "utf16BigEndian" | "windowsCP1252" | "isoLatin1";

export type DocumentErrorKind = "unsupported" | "unreadable";

export class DocumentError extends Error {
  readonly kind: DocumentErrorKind;
  readonly detail: string;

  private constructor(kind: DocumentErrorKind, detail = "") {
    super(
      kind === "unsupported"
        ? `I file .${detail} arriveranno nelle prossime versioni: per ora .txt e .md.`
        : "Non riesco a leggere il testo di questo file.",
    );
    this.name = "DocumentError";
    this.kind = kind;
    this.detail = detail;
  }

  static unsupported(ext: string): DocumentError {
    return new DocumentError("unsupported", ext);
  }

  static unreadable(): DocumentError {
    return new DocumentError("unreadable");
  }
}

export class TextDocument {
  text: string;
  kind: TextDocumentKind;
  encoding: TextEncoding;
  hasBOM: boolean;

  static readonly DocumentError = DocumentError;

  constructor(text: string, kind: TextDocumentKind, encoding: TextEncoding = "utf8", hasBOM = false) {
    this.text = text;
    this.kind = kind;
    this.encoding = encoding;
    this.hasBOM = hasBOM;
  }

  static kindTitle(kind: TextDocumentKind): string {
    return kind === "plainText" ? "Testo" : "Markdown";
  }

  /** Estensioni gestite. */
  static readonly extensions: Readonly<Record<string, TextDocumentKind>> = {
    txt: "plainText",
    text: "plainText",
    md: "markdown",
    markdown: "markdown",
    mdown: "markdown",
    mkd: "markdown",
  };

  static kindOf(path: string): TextDocumentKind | null {
    return TextDocument.extensions[pathExtension(path).toLowerCase()] ?? null;
  }

  static read(path: string): TextDocument {
    const kind = TextDocument.kindOf(path);
    if (kind === null) throw DocumentError.unsupported(pathExtension(path).toLowerCase());
    return TextDocument.decode(new Uint8Array(readFileSync(path)), kind);
  }

  static decode(data: Uint8Array, kind: TextDocumentKind): TextDocument {
    if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
      const text = decodeText(data.subarray(3), "utf8");
      if (text === null) throw DocumentError.unreadable();
      return new TextDocument(text, kind, "utf8", true);
    }
    if (data.length >= 2 && ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff))) {
      const encoding: TextEncoding = data[0] === 0xff ? "utf16LittleEndian" : "utf16BigEndian";
      const text = decodeText(data.subarray(2), encoding);
      if (text === null) throw DocumentError.unreadable();
      return new TextDocument(text, kind, encoding, true);
    }
    for (const encoding of ["utf8", "windowsCP1252", "isoLatin1"] as const) {
      const text = decodeText(data, encoding);
      if (text !== null) return new TextDocument(text, kind, encoding);
    }
    throw DocumentError.unreadable();
  }

  /** Il file da scrivere: stessa codifica e stesso BOM dell'originale, se il testo ci sta; altrimenti UTF-8. */
  data(): Uint8Array {
    const body = encodeText(this.text, this.encoding);
    if (body === null) return new TextEncoder().encode(this.text);
    if (!this.hasBOM) return body;
    const bom =
      this.encoding === "utf16LittleEndian" ? [0xff, 0xfe] : this.encoding === "utf16BigEndian" ? [0xfe, 0xff] : [0xef, 0xbb, 0xbf];
    const output = new Uint8Array(bom.length + body.length);
    output.set(bom, 0);
    output.set(body, bom.length);
    return output;
  }

  /** Scrittura atomica: un file temporaneo accanto, poi si rinomina. */
  write(path: string): void {
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, this.data());
    renameSync(temporary, path);
  }

  replacingText(text: string): TextDocument {
    return new TextDocument(text, this.kind, this.encoding, this.hasBOM);
  }

  copy(): TextDocument {
    return this.replacingText(this.text);
  }
}

// MARK: - Codifiche

/** I caratteri di Windows-1252 da 0x80 a 0x9F (null: byte non definito). */
const cp1252High: readonly (number | null)[] = [
  0x20ac, null, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, null, 0x017d, null,
  null, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, null, 0x017e, 0x0178,
];

const cp1252Reverse = new Map<number, number>(
  cp1252High.flatMap((code, index) => (code === null ? [] : [[code, 0x80 + index] as [number, number]])),
);

function decodeText(data: Uint8Array, encoding: TextEncoding): string | null {
  switch (encoding) {
    case "utf8":
      try {
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
      } catch {
        return null;
      }
    case "utf16LittleEndian":
    case "utf16BigEndian": {
      if (data.length % 2 !== 0) return null;
      try {
        return new TextDecoder(encoding === "utf16LittleEndian" ? "utf-16le" : "utf-16be", { fatal: true, ignoreBOM: true }).decode(data);
      } catch {
        return null;
      }
    }
    case "windowsCP1252": {
      let text = "";
      for (const byte of data) {
        if (byte >= 0x80 && byte <= 0x9f) {
          const code = cp1252High[byte - 0x80];
          if (code === null) return null;
          text += String.fromCharCode(code);
        } else {
          text += String.fromCharCode(byte);
        }
      }
      return text;
    }
    case "isoLatin1": {
      let text = "";
      for (const byte of data) text += String.fromCharCode(byte);
      return text;
    }
  }
}

function encodeText(text: string, encoding: TextEncoding): Uint8Array | null {
  switch (encoding) {
    case "utf8":
      return new TextEncoder().encode(text);
    case "utf16LittleEndian":
    case "utf16BigEndian": {
      const output = new Uint8Array(text.length * 2);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const [first, second] = encoding === "utf16LittleEndian" ? [code & 0xff, code >>> 8] : [code >>> 8, code & 0xff];
        output[i * 2] = first;
        output[i * 2 + 1] = second;
      }
      return output;
    }
    case "windowsCP1252": {
      const output: number[] = [];
      for (const character of text) {
        const code = character.codePointAt(0) ?? 0;
        if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) output.push(code);
        else {
          const byte = cp1252Reverse.get(code);
          if (byte === undefined) return null;
          output.push(byte);
        }
      }
      return Uint8Array.from(output);
    }
    case "isoLatin1": {
      const output: number[] = [];
      for (const character of text) {
        const code = character.codePointAt(0) ?? 0;
        if (code > 0xff) return null;
        output.push(code);
      }
      return Uint8Array.from(output);
    }
  }
}

// MARK: - Nomi dei file

/** L'estensione di un percorso, senza il punto («a.MD» → «MD»). */
export function pathExtension(path: string): string {
  const ext = extname(path);
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

/** I nomi dei file prodotti: «Contratto.md» → «Contratto (anonimizzato).md» → «Contratto (riconvertito).md».
 *  Anche il nome può contenere dati personali («Contratto Mario Rossi.md»): quelli già nel dizionario diventano
 *  segnaposto nel nome del file anonimizzato e tornano veri in quello riconvertito. */
export abstract class DocumentNaming {
  /** Il nome del file anonimizzato; con dizionario e impostazioni, senza i dati del dizionario. */
  static anonymizedName(path: string, vault?: Vault, settings?: AnonymizationSettings): string {
    if (!vault || !settings) return DocumentNaming.name(path, "anonimizzato");
    const base = Masking.maskKnown(DocumentNaming.baseName(path), vault, settings.hidden, Masking.normalizedExceptions(settings.exceptions)).text;
    return DocumentNaming.compose(base, "anonimizzato", pathExtension(path));
  }

  /** Il nome del file riconvertito; con il dizionario, con i dati veri al posto dei segnaposto. */
  static revealedName(path: string, vault?: Vault): string {
    if (!vault) return DocumentNaming.name(path, "riconvertito");
    const base = Revealer.reveal(DocumentNaming.baseName(path), vault).text.replaceAll("/", "-").replaceAll(":", "-");
    return DocumentNaming.compose(base, "riconvertito", pathExtension(path));
  }

  static name(path: string, suffix: string): string {
    return DocumentNaming.compose(DocumentNaming.baseName(path), suffix, pathExtension(path));
  }

  static baseName(path: string): string {
    const ext = extname(path);
    const file = basename(path, ext);
    return file.replace(/\s*\((?:anonimizzato|riconvertito)\)$/iu, "");
  }

  static compose(base: string, suffix: string, ext: string): string {
    return `${base} (${suffix})` + (ext.length === 0 ? "" : `.${ext}`);
  }
}
