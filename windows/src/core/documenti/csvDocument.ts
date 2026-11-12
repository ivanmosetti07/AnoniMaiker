import { ColumnHints, SegmentedText, type PreviewSheet } from "./segmentedText";
import { TextDocument } from "./textDocument";

// MARK: - CSV: cella per cella
//
// Si riconosce il separatore (Excel in italiano usa «;»), le virgolette (anche con a-capo dentro), gli a-capo e la
// codifica, e si riscrive tutto uguale: cambia solo il testo delle celle. Una cella che aveva le virgolette le tiene;
// una che ora contiene un separatore le prende.

export interface CSVField {
  text: string;
  quoted: boolean;
  /** Com'era scritta nel file (virgolette comprese): se il testo non cambia, si riscrive così. */
  raw?: string | null;
  original?: string | null;
}

/** I caratteri come li conta Swift per il CSV: code point, con «\r\n» come carattere unico. */
function characters(text: string): string[] {
  const result: string[] = [];
  for (const scalar of text) {
    if (scalar === "\n" && result.length > 0 && result[result.length - 1] === "\r") result[result.length - 1] = "\r\n";
    else result.push(scalar);
  }
  return result;
}

function isNewline(character: string): boolean {
  return character === "\n" || character === "\r\n" || character === "\r";
}

export class CSVTable {
  rows: CSVField[][];
  delimiter: string;
  lineEnding: string;
  endsWithNewline: boolean;
  /** Codifica e BOM dell'originale. */
  encoding: TextDocument;

  static readonly candidates: readonly string[] = [";", ",", "\t", "|"];

  constructor(data: Uint8Array, fileExtension = "csv") {
    const document = TextDocument.decode(data, "plainText");
    this.encoding = document;
    const text = document.text;
    this.lineEnding = CSVTable.lineEnding(text);
    this.delimiter = fileExtension.toLowerCase() === "tsv" ? "\t" : CSVTable.delimiter(text);
    const parsed = CSVTable.parse(text, this.delimiter);
    this.rows = parsed.rows;
    this.endsWithNewline = parsed.endsWithNewline;
  }

  /** «\r\n» se il file lo usa, altrimenti «\n» (o «\r» dei vecchi Mac). */
  static lineEnding(text: string): string {
    let inQuotes = false;
    let previous: string | null = null;
    for (const scalar of text) {
      if (scalar === '"') inQuotes = !inQuotes;
      if (!inQuotes) {
        if (scalar === "\n") return previous === "\r" ? "\r\n" : "\n";
        if (previous === "\r") return "\r";
      }
      previous = scalar;
    }
    return previous === "\r" ? "\r" : "\n";
  }

  /** Il separatore che divide le prime righe nello stesso numero di colonne. */
  static delimiter(text: string): string {
    const lines: Map<string, number>[] = [new Map()];
    let inQuotes = false;
    for (const character of characters(text)) {
      if (character === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (inQuotes) continue;
      if (isNewline(character)) {
        if (lines.length >= 20) break;
        lines.push(new Map());
        continue;
      }
      if (CSVTable.candidates.includes(character)) {
        const line = lines[lines.length - 1];
        line.set(character, (line.get(character) ?? 0) + 1);
      }
    }
    const filled = lines.filter((line) => line.size > 0);
    if (filled.length === 0) return ",";
    let best: [string, number] = [",", -1];
    for (const candidate of CSVTable.candidates) {
      const counts = filled.map((line) => line.get(candidate) ?? 0);
      const first = counts[0];
      if (!(first > 0)) continue;
      // Stesso numero su tutte le righe: punteggio pieno; altrimenti conta quante righe tornano.
      const consistent = counts.filter((count) => count === first).length;
      const score = consistent * 100 + first;
      if (score > best[1]) best = [candidate, score];
    }
    return best[0];
  }

  static parse(text: string, delimiter: string): { rows: CSVField[][]; endsWithNewline: boolean } {
    const rows: CSVField[][] = [];
    let row: CSVField[] = [];
    let field = "";
    let quoted = false;
    let inQuotes = false;
    let endsWithNewline = false;
    const chars = characters(text);
    let index = 0;
    let fieldStart = 0;
    const close = (end: number): void => {
      row.push({ text: field, quoted, raw: chars.slice(fieldStart, end).join(""), original: field });
      field = "";
      quoted = false;
    };
    // Un a-capo dentro le virgolette è testo; «""» dentro le virgolette è una virgoletta.
    while (index < chars.length) {
      const character = chars[index];
      endsWithNewline = false;
      if (inQuotes) {
        if (character === '"') {
          if (index + 1 < chars.length && chars[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += character;
        }
      } else if (character === '"' && field.length === 0 && !quoted) {
        inQuotes = true;
        quoted = true;
      } else if (character === delimiter) {
        close(index);
        fieldStart = index + 1;
      } else if (isNewline(character)) {
        close(index);
        rows.push(row);
        row = [];
        fieldStart = index + 1;
        endsWithNewline = true;
      } else {
        field += character;
      }
      index += 1;
    }
    if (!endsWithNewline && !(row.length === 0 && field.length === 0 && !quoted)) {
      close(chars.length);
      rows.push(row);
    }
    return { rows, endsWithNewline };
  }

  data(): Uint8Array {
    const delimiter = this.delimiter;
    let text = this.rows
      .map((row) =>
        row
          .map((field) => {
            if (field.raw !== null && field.raw !== undefined && field.text === field.original) return field.raw;
            const needsQuotes =
              field.quoted ||
              field.text.includes(delimiter) ||
              field.text.includes('"') ||
              field.text.includes("\n") ||
              field.text.includes("\r");
            return needsQuotes ? '"' + field.text.replaceAll('"', '""') + '"' : field.text;
          })
          .join(delimiter),
      )
      .join(this.lineEnding);
    if (this.endsWithNewline) text += this.lineEnding;
    return this.encoding.replacingText(text).data();
  }

  // MARK: Segmenti

  /** Una cella = un segmento; la prima riga, se è un'intestazione, dà la categoria delle colonne. */
  segmented(): { content: SegmentedText; cells: { row: number; column: number }[] } {
    const content = new SegmentedText();
    const cells: { row: number; column: number }[] = [];
    const header = this.rows.length > 0 ? ColumnHints.headerLabels(this.rows[0].map((field) => field.text)) : null;
    this.rows.forEach((row, r) => {
      row.forEach((field, c) => {
        const hint = r > 0 ? (header?.get(c) ?? null) : null;
        content.addSegment([field.text], c === row.length - 1 ? "\n" : "\t", hint);
        cells.push({ row: r, column: c });
      });
    });
    return { content, cells };
  }

  apply(units: readonly string[], cells: readonly { row: number; column: number }[]): void {
    cells.forEach((cell, index) => {
      this.rows[cell.row][cell.column].text = units[index];
    });
  }

  get preview(): PreviewSheet {
    return { name: "CSV", rows: this.rows.map((row) => row.map((field) => field.text)) };
  }
}
