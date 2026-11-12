import type { AttributeNode, TextNode } from "./officeParts";

// MARK: - XML a byte: i tag, il testo, le modifiche chirurgiche
//
// I file di Office si riscrivono toccando solo il testo: si scorrono i tag in ordine (saltando commenti, CDATA e
// istruzioni), si leggono i contenuti dei nodi di testo e i valori degli attributi, e si sostituiscono solo quei byte.
// Tutto il resto (formattazione, stili, namespace, spazi) resta identico.

/** Un intervallo di byte, come `Range<Int>` in Swift (`upperBound` escluso). */
export interface IntRange {
  readonly lowerBound: number;
  readonly upperBound: number;
}

export function intRange(lowerBound: number, upperBound: number): IntRange {
  return { lowerBound, upperBound };
}

export interface XMLTag {
  /** Nome qualificato («w:t», «si»). */
  readonly name: string;
  /** I byte dell'intero tag, da «<» a «>». */
  readonly range: IntRange;
  readonly isEnd: boolean;
  readonly isSelfClosing: boolean;
}

/** Un attributo: valore decodificato, byte del valore senza virgolette, virgoletta usata. */
export interface XMLAttribute {
  readonly value: string;
  readonly range: IntRange;
  readonly quote: number;
}

const utf8Decoder = new TextDecoder("utf-8");
const utf8Encoder = new TextEncoder();

function ascii(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

export class XMLBytes {
  bytes: Uint8Array;

  constructor(data: Uint8Array) {
    this.bytes = data;
  }

  get data(): Uint8Array {
    return this.bytes;
  }

  /** Tutti i tag, nell'ordine del file. */
  tags(): XMLTag[] {
    const bytes = this.bytes;
    const tags: XMLTag[] = [];
    const n = bytes.length;
    let i = 0;
    while (i < n) {
      if (bytes[i] !== 0x3c) {
        i += 1; // «<»
        continue;
      }
      if (i + 1 < n && bytes[i + 1] === 0x21) {
        // «<!»
        if (this.matches("<!--", i)) {
          const end = this.find("-->", i + 4);
          i = end === null ? n : end + 3;
          continue;
        }
        if (this.matches("<![CDATA[", i)) {
          const end = this.find("]]>", i + 9);
          i = end === null ? n : end + 3;
          continue;
        }
        const end = this.find(">", i);
        i = end === null ? n : end + 1;
        continue;
      }
      if (i + 1 < n && bytes[i + 1] === 0x3f) {
        // «<?»
        const end = this.find("?>", i + 2);
        i = end === null ? n : end + 2;
        continue;
      }
      const isEnd = i + 1 < n && bytes[i + 1] === 0x2f;
      let j = i + (isEnd ? 2 : 1);
      const nameStart = j;
      while (j < n && !isSpace(bytes[j]) && bytes[j] !== 0x2f && bytes[j] !== 0x3e) j += 1;
      const name = utf8Decoder.decode(bytes.subarray(nameStart, j));
      // Fino al «>» che chiude il tag, saltando quelli tra virgolette.
      let quote = 0;
      while (j < n) {
        const byte = bytes[j];
        if (quote !== 0) {
          if (byte === quote) quote = 0;
        } else if (byte === 0x22 || byte === 0x27) {
          quote = byte;
        } else if (byte === 0x3e) {
          break;
        }
        j += 1;
      }
      if (j >= n) break;
      tags.push({ name, range: intRange(i, j + 1), isEnd, isSelfClosing: !isEnd && bytes[j - 1] === 0x2f });
      i = j + 1;
    }
    return tags;
  }

  /** Gli attributi di un tag: nome → (valore decodificato, byte del valore senza virgolette, virgoletta usata). */
  attributes(tag: XMLTag): Map<string, XMLAttribute> {
    const bytes = this.bytes;
    const result = new Map<string, XMLAttribute>();
    let j = tag.range.lowerBound + 1 + (tag.isEnd ? 1 : 0) + utf8Encoder.encode(tag.name).length;
    const end = tag.range.upperBound - 1;
    while (j < end) {
      while (j < end && isSpace(bytes[j])) j += 1;
      const nameStart = j;
      while (j < end && bytes[j] !== 0x3d && !isSpace(bytes[j]) && bytes[j] !== 0x2f && bytes[j] !== 0x3e) j += 1;
      const name = utf8Decoder.decode(bytes.subarray(nameStart, j));
      while (j < end && isSpace(bytes[j])) j += 1;
      if (!(j < end && bytes[j] === 0x3d)) {
        j += 1;
        continue;
      }
      j += 1;
      while (j < end && isSpace(bytes[j])) j += 1;
      if (!(j < end && (bytes[j] === 0x22 || bytes[j] === 0x27))) continue;
      const quote = bytes[j];
      const valueStart = j + 1;
      j = valueStart;
      while (j < end && bytes[j] !== quote) j += 1;
      if (name.length > 0) {
        const range = intRange(valueStart, j);
        result.set(name, { value: this.decode(range), range, quote });
      }
      j += 1;
    }
    return result;
  }

  /** Il testo di un intervallo, con le entità XML risolte. */
  decode(range: IntRange): string {
    const raw = utf8Decoder.decode(this.bytes.subarray(range.lowerBound, range.upperBound));
    return raw.includes("&") ? XMLBytes.unescape(raw) : raw;
  }

  /** Il prefisso usato per un namespace nel tag radice («w» per WordprocessingML; "" se è quello di default). */
  prefix(namespaces: readonly string[], tags: readonly XMLTag[]): string | null {
    const root = tags.find((tag) => !tag.isEnd);
    if (!root) return null;
    for (const [name, attribute] of this.attributes(root)) {
      if (!namespaces.includes(attribute.value)) continue;
      if (name === "xmlns") return "";
      if (name.startsWith("xmlns:")) return name.slice(6);
    }
    return null;
  }

  private matches(text: string, index: number): boolean {
    const pattern = ascii(text);
    if (index + pattern.length > this.bytes.length) return false;
    for (let k = 0; k < pattern.length; k++) if (this.bytes[index + k] !== pattern[k]) return false;
    return true;
  }

  private find(text: string, index: number): number | null {
    const pattern = ascii(text);
    const bytes = this.bytes;
    if (pattern.length === 0 || bytes.length < pattern.length) return null;
    outer: for (let i = index; i <= bytes.length - pattern.length; i++) {
      if (bytes[i] !== pattern[0]) continue;
      for (let k = 1; k < pattern.length; k++) if (bytes[i + k] !== pattern[k]) continue outer;
      return i;
    }
    return null;
  }

  // MARK: Entità

  static unescape(text: string): string {
    let output = "";
    const characters = Array.from(text);
    let index = 0;
    while (index < characters.length) {
      const character = characters[index];
      let semicolon = -1;
      if (character === "&") {
        for (let k = index + 1; k < characters.length; k++) {
          if (characters[k] === ";") {
            semicolon = k;
            break;
          }
        }
      }
      if (character !== "&" || semicolon < 0 || semicolon - index > 10) {
        output += character;
        index += 1;
        continue;
      }
      const entity = characters.slice(index + 1, semicolon).join("");
      let replacement: string | null = null;
      switch (entity) {
        case "amp":
          replacement = "&";
          break;
        case "lt":
          replacement = "<";
          break;
        case "gt":
          replacement = ">";
          break;
        case "quot":
          replacement = '"';
          break;
        case "apos":
          replacement = "'";
          break;
        default:
          if (entity.startsWith("#x") || entity.startsWith("#X")) {
            replacement = scalar(entity.slice(2), 16);
          } else if (entity.startsWith("#")) {
            replacement = scalar(entity.slice(1), 10);
          }
      }
      if (replacement !== null) {
        output += replacement;
        index = semicolon + 1;
      } else {
        output += character;
        index += 1;
      }
    }
    return output;
  }

  /** Testo da mettere dentro un elemento o un attributo. */
  static escape(text: string, quote: number | null = null): Uint8Array {
    const source = utf8Encoder.encode(text);
    const output: number[] = [];
    for (const byte of source) {
      switch (byte) {
        case 0x26:
          output.push(...ascii("&amp;"));
          break;
        case 0x3c:
          output.push(...ascii("&lt;"));
          break;
        case 0x3e:
          output.push(...ascii("&gt;"));
          break;
        case 0x22:
          if (quote === 0x22) output.push(...ascii("&quot;"));
          else output.push(byte);
          break;
        case 0x27:
          if (quote === 0x27) output.push(...ascii("&apos;"));
          else output.push(byte);
          break;
        default:
          output.push(byte);
      }
    }
    return Uint8Array.from(output);
  }

  // MARK: Nodi (in Swift, l'estensione di OfficeParts.swift)

  /** Il nome qualificato con il prefisso del namespace («w:t», o «t» senza prefisso). */
  static qualified(prefix: string, local: string): string {
    return prefix.length === 0 ? local : `${prefix}:${local}`;
  }

  /** Il nodo di testo che comincia con il tag `index` (il successivo è la sua chiusura). */
  textNode(index: number, tags: readonly XMLTag[]): TextNode | null {
    const tag = tags[index];
    if (tag.isEnd || tag.isSelfClosing || index + 1 >= tags.length) return null;
    const content = intRange(tag.range.upperBound, tags[index + 1].range.lowerBound);
    return { startTag: tag, content, text: this.decode(content) };
  }

  /** Riscrive un nodo di testo; se il testo nuovo ha spazi ai bordi, l'elemento li deve conservare. */
  edit(node: TextNode | AttributeNode, text: string, edits: XMLEdits): void {
    if (text === node.text) return;
    if (!("startTag" in node)) {
      edits.replace(node.range, XMLBytes.escape(text, node.quote));
      return;
    }
    edits.replace(node.content, XMLBytes.escape(text));
    const characters = Array.from(text);
    const edges =
      (characters.length > 0 && isWhitespace(characters[0])) ||
      (characters.length > 0 && isWhitespace(characters[characters.length - 1]));
    if (!edges || this.attributes(node.startTag).has("xml:space")) return;
    const original = this.bytes.subarray(node.startTag.range.lowerBound, node.startTag.range.upperBound);
    const insert = ascii(' xml:space="preserve"');
    const tag = new Uint8Array(original.length + insert.length);
    tag.set(original.subarray(0, original.length - 1), 0);
    tag.set(insert, original.length - 1);
    tag[tag.length - 1] = original[original.length - 1];
    edits.replace(node.startTag.range, tag);
  }
}

/** Sostituzioni di byte che non si sovrappongono, applicate in un passaggio solo. */
export class XMLEdits {
  private _edits: { range: IntRange; bytes: Uint8Array }[] = [];

  get edits(): readonly { range: IntRange; bytes: Uint8Array }[] {
    return this._edits;
  }

  get isEmpty(): boolean {
    return this._edits.length === 0;
  }

  replace(range: IntRange, bytes: Uint8Array): void {
    this._edits.push({ range, bytes });
  }

  applied(source: Uint8Array): Uint8Array {
    if (this._edits.length === 0) return source;
    const chunks: Uint8Array[] = [];
    let length = 0;
    let position = 0;
    const sorted = [...this._edits].sort((a, b) => a.range.lowerBound - b.range.lowerBound);
    for (const edit of sorted) {
      if (edit.range.lowerBound < position) continue;
      chunks.push(source.subarray(position, edit.range.lowerBound), edit.bytes);
      length += edit.range.lowerBound - position + edit.bytes.length;
      position = edit.range.upperBound;
    }
    chunks.push(source.subarray(position));
    length += source.length - position;
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
}

function isSpace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

/** Come `Character.isWhitespace` di Swift. */
function isWhitespace(character: string): boolean {
  return /^[\s\u0085]/u.test(character);
}

/** Un code point da un'entità numerica («#233», «#xE9»); `null` se non è valido. */
function scalar(digits: string, radix: 10 | 16): string | null {
  const pattern = radix === 16 ? /^\+?[0-9a-fA-F]+$/ : /^\+?[0-9]+$/;
  if (!pattern.test(digits)) return null;
  const value = parseInt(digits, radix);
  if (!Number.isFinite(value) || value > 0xffffffff) return null;
  if (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return null;
  return String.fromCodePoint(value);
}
