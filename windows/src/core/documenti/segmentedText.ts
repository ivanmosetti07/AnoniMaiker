import { RevealResult, Revealer } from "../anonimizzazione";
import type { Vault } from "../dizionario";
import { PIIText } from "../motore";
import { intRange, type IntRange } from "./xmlText";

// MARK: - Testo a segmenti: celle, paragrafi, pagine
//
// Un file si legge come una serie di segmenti (una cella, un paragrafo, una pagina), ognuno fatto di unità riscrivibili
// (i nodi di testo del file: in Word un paragrafo è spezzato in «run» con formattazioni diverse). Il motore legge tutto
// insieme, con i separatori in mezzo (tab fra le celle, a capo fra righe e paragrafi), così ha il contesto; i dati
// trovati si spezzano ai confini dei segmenti e si rimettono nelle unità: il segnaposto va nell'unità dove il dato
// comincia (e ne prende la formattazione), il resto del dato sparisce dalle unità successive.

/** Il numero di code point di un testo (come `unicodeScalars.count` in Swift). */
function scalarCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

export class SegmentedText {
  units: string[] = [];
  /** Le unità di ogni segmento (indici contigui). */
  segments: IntRange[] = [];
  /** Il separatore dopo ogni segmento, nel testo per il motore. */
  separators: string[] = [];
  /** La categoria suggerita per un segmento (la colonna «Email» di una tabella). */
  hints = new Map<number, string>();

  get isEmpty(): boolean {
    return this.segments.length === 0;
  }

  addSegment(texts: readonly string[], separator: string, hint: string | null = null): number {
    const start = this.units.length;
    this.units.push(...texts);
    this.segments.push(intRange(start, this.units.length));
    this.separators.push(separator);
    const index = this.segments.length - 1;
    if (hint !== null && hint !== undefined) this.hints.set(index, hint);
    return index;
  }

  /** Le unità di un segmento. */
  unitsOf(segment: number): string[] {
    const range = this.segments[segment];
    return this.units.slice(range.lowerBound, range.upperBound);
  }

  text(segment: number): string {
    return this.unitsOf(segment).join("");
  }

  /** Il testo per il motore e dove sta ogni segmento (in code point), come stringa. */
  layoutString(): { text: string; ranges: { start: number; end: number }[] } {
    let string = "";
    const ranges: { start: number; end: number }[] = [];
    let position = 0;
    for (let index = 0; index < this.segments.length; index++) {
      const text = this.text(index);
      const length = scalarCount(text);
      ranges.push({ start: position, end: position + length });
      string += text + this.separators[index];
      position += length + scalarCount(this.separators[index]);
    }
    return { text: string, ranges };
  }

  /** Il testo per il motore e dove sta ogni segmento (in code point). */
  layout(): { text: PIIText; ranges: { start: number; end: number }[] } {
    const { text, ranges } = this.layoutString();
    return { text: new PIIText(text), ranges };
  }

  /** Le unità di un segmento con le sostituzioni applicate. */
  static distribute(units: readonly string[], replacements: readonly SegmentedText.Replacement[]): string[] {
    const sorted = [...replacements].sort((a, b) => a.start - b.start);
    if (sorted.length === 0) return [...units];
    const result: string[] = [];
    let offset = 0;
    let r = 0;
    for (const unit of units) {
      let output = "";
      const scalars = Array.from(unit);
      scalars.forEach((scalar, index) => {
        const position = offset + index;
        while (r < sorted.length && sorted[r].end <= position) r += 1;
        if (r < sorted.length && position >= sorted[r].start) {
          if (position === sorted[r].start) output += sorted[r].text;
          return;
        }
        output += scalar;
      });
      offset += scalars.length;
      result.push(output);
    }
    return result;
  }

  /** Tutte le unità con le sostituzioni di ogni segmento. */
  applying(replacements: SegmentReplacements): string[] {
    const units = [...this.units];
    for (const [segment, list] of replacements) {
      if (list.length === 0) continue;
      const range = this.segments[segment];
      const distributed = SegmentedText.distribute(this.units.slice(range.lowerBound, range.upperBound), list);
      units.splice(range.lowerBound, range.upperBound - range.lowerBound, ...distributed);
    }
    return units;
  }

  /** Unisce le sostituzioni di più copie dello stesso testo (una stringa condivisa usata in più celle): senza
   *  sovrapposizioni, prima le più lunghe. */
  static merge(lists: readonly (readonly SegmentedText.Replacement[])[]): SegmentedText.Replacement[] {
    const kept: SegmentedText.Replacement[] = [];
    const all = lists.flat().sort((a, b) => b.end - b.start - (a.end - a.start));
    for (const replacement of all) {
      if (!kept.some((k) => k.start < replacement.end && replacement.start < k.end)) kept.push(replacement);
    }
    return kept.sort((a, b) => a.start - b.start);
  }

  /** Il primo segmento che finisce dopo `position` (i segmenti sono in ordine e non si sovrappongono). */
  static firstSegment(position: number, ranges: readonly { start: number; end: number }[]): number {
    let low = 0;
    let high = ranges.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (ranges[mid].end <= position) low = mid + 1;
      else high = mid;
    }
    return low;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace SegmentedText {
  /** Una sostituzione dentro un segmento (posizioni in code point del segmento). */
  interface Replacement {
    start: number;
    end: number;
    text: string;
  }
}

/** Le sostituzioni di ogni segmento: indice del segmento → sostituzioni. */
export type SegmentReplacements = Map<number, SegmentedText.Replacement[]>;

// MARK: - Riconversione a segmenti

export abstract class SegmentedRevealer {
  /** Le sostituzioni per riconvertire ogni segmento, e il resoconto. */
  static replacements(content: SegmentedText, vault: Vault): { replacements: SegmentReplacements; result: RevealResult } {
    const all: SegmentReplacements = new Map();
    const result = new RevealResult("");
    for (let segment = 0; segment < content.segments.length; segment++) {
      const text = content.text(segment);
      if (!text.includes("_")) continue;
      const source = new PIIText(text);
      const list: SegmentedText.Replacement[] = [];
      for (const match of source.matches(Revealer.regex)) {
        const placeholder = SegmentedRevealer.key(source.slice(match.start, match.end));
        const value = vault.value(placeholder);
        if (value !== null && value !== undefined) {
          list.push({ start: match.start, end: match.end, text: value });
          result.replaced.set(placeholder, (result.replaced.get(placeholder) ?? 0) + 1);
        } else if (!result.unknown.includes(placeholder)) {
          result.unknown.push(placeholder);
        }
      }
      if (list.length > 0) all.set(segment, list);
    }
    return { replacements: all, result };
  }

  /** «\[FULLNAME\_1\]», «[ FULLNAME_1 ]», «FULLNAME_1» → «[FULLNAME_1]». */
  static key(match: string): string {
    const inner = match.replaceAll("\\", "").replace(/^[\[\] ]+|[\[\] ]+$/g, "");
    return `[${inner}]`;
  }
}

// MARK: - Le colonne di una tabella

/** Dall'intestazione di una colonna, la categoria dei suoi dati: le celle sotto «Email» o «Cognome» si nascondono anche
 *  dove il motore non riconosce niente (una cella con «Rossi» da solo, senza contesto). */
export abstract class ColumnHints {
  private static readonly rules: readonly { label: string; words: readonly string[] }[] = [
    { label: "EMAIL", words: ["email", "e mail", "mail", "pec", "posta elettronica"] },
    { label: "TELEPHONENUM", words: ["telefono", "tel", "cellulare", "cell", "mobile", "phone", "fax", "recapito telefonico"] },
    { label: "CF", words: ["codice fiscale", "cod fiscale", "cod fisc", "cf", "c f"] },
    { label: "PIVA", words: ["partita iva", "p iva", "piva", "p iva cf", "vat", "vat number"] },
    { label: "IBAN", words: ["iban", "coordinate bancarie"] },
    { label: "ORG", words: ["ragione sociale", "azienda", "societa", "company", "ditta", "denominazione", "impresa"] },
    {
      label: "FULLNAME",
      words: ["nome", "cognome", "nominativo", "nome e cognome", "cognome e nome", "referente", "contatto", "titolare",
        "intestatario", "name", "first name", "last name", "full name", "dipendente", "paziente", "cliente nome"],
    },
    { label: "STREET", words: ["indirizzo", "via", "address", "residenza", "domicilio", "sede legale", "sede"] },
    { label: "CITY", words: ["citta", "comune", "city", "localita"] },
    { label: "ZIPCODE", words: ["cap"] },
    { label: "PROVINCE", words: ["provincia", "prov"] },
    { label: "TARGA", words: ["targa"] },
    { label: "DATE", words: ["data di nascita", "nato il", "nascita"] },
  ];

  /** La categoria di un'intestazione, se si riconosce. */
  static label(header: string): string | null {
    const words = ColumnHints.normalized(header);
    if (words.length === 0 || words.length > 5) return null;
    const phrase = words.join(" ");
    for (const rule of ColumnHints.rules) {
      for (const keyword of rule.words) {
        const parts = keyword.split(" ").filter((p) => p.length > 0);
        if (phrase === keyword || ColumnHints.containsSequence(words, parts)) return rule.label;
      }
    }
    return null;
  }

  /** Una riga è un'intestazione se ha testi brevi, senza cifre né «@», e almeno una colonna riconosciuta. */
  static headerLabels(row: readonly string[]): Map<number, string> | null {
    const cells = row.map((cell) => trimWhitespace(cell));
    if (!cells.some((cell) => cell.length > 0)) return null;
    if (!cells.every((cell) => scalarCount(cell) <= 40 && !cell.includes("@") && !/\p{N}/u.test(cell))) return null;
    const labels = new Map<number, string>();
    cells.forEach((cell, index) => {
      const label = ColumnHints.label(cell);
      if (label !== null) labels.set(index, label);
    });
    return labels.size === 0 ? null : labels;
  }

  /** Una cella sotto quell'intestazione ha l'aria del dato giusto (non «n/d», non un numero per un nome). */
  static accepts(value: string, label: string): boolean {
    const text = trimWhitespace(value);
    if (
      scalarCount(text) < 2 ||
      ["n/d", "nd", "-", "--", "n.d.", "na", "n/a", "null", "nessuno", "nessuna"].includes(text.toLowerCase())
    ) {
      return false;
    }
    const characters = Array.from(text);
    const digits = characters.filter((c) => /\p{N}/u.test(c)).length;
    const letters = characters.filter((c) => /\p{L}/u.test(c)).length;
    const alphanumerics = characters.filter((c) => /[\p{L}\p{N}]/u.test(c)).length;
    switch (label) {
      case "EMAIL":
        return text.includes("@");
      case "TELEPHONENUM":
        return digits >= 6;
      case "CF":
      case "PIVA":
        return alphanumerics >= 11;
      case "IBAN":
        return alphanumerics >= 15;
      case "FULLNAME":
      case "ORG":
      case "CITY":
      case "PROVINCE":
        return letters >= 2;
      case "STREET":
        return letters >= 3;
      case "ZIPCODE":
        return digits === 5;
      default:
        return true;
    }
  }

  private static normalized(text: string): string[] {
    return text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase("it-IT")
      .split(/[^\p{L}\p{M}\p{N}]+/u)
      .filter((word) => word.length > 0);
  }

  private static containsSequence(words: readonly string[], parts: readonly string[]): boolean {
    if (parts.length === 0 || parts.length > words.length) return false;
    for (let start = 0; start <= words.length - parts.length; start++) {
      if (parts.every((part, k) => words[start + k] === part)) return true;
    }
    return false;
  }
}

/** Come `trimmingCharacters(in: .whitespacesAndNewlines)`. */
export function trimWhitespace(text: string): string {
  return text.replace(/^[\s\u0085]+|[\s\u0085]+$/gu, "");
}

// MARK: - Anteprime

/** Un foglio (o un CSV) come tabella, per l'anteprima. */
export interface PreviewSheet {
  name: string;
  rows: string[][];
}

/** Come mostrare un file: testo, oppure tabelle. */
export type DocumentPreview = { kind: "text"; text: string } | { kind: "sheets"; sheets: PreviewSheet[] };

export const DocumentPreview = {
  text(text: string): DocumentPreview {
    return { kind: "text", text };
  },

  sheets(sheets: PreviewSheet[]): DocumentPreview {
    return { kind: "sheets", sheets };
  },

  /** Tutto come testo (le celle separate da tab): per copiarlo e per evidenziare. */
  plainText(preview: DocumentPreview): string {
    switch (preview.kind) {
      case "text":
        return preview.text;
      case "sheets": {
        const sheets = preview.sheets;
        return sheets
          .map((sheet) => (sheets.length > 1 ? `# ${sheet.name}\n` : "") + sheet.rows.map((row) => row.join("\t")).join("\n"))
          .join("\n\n");
      }
    }
  },
};
