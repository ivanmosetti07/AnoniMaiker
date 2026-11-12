import { OfficeMetadata, OfficePaths, localName, type TextNode } from "./officeParts";
import { ColumnHints, SegmentedText, type PreviewSheet, type SegmentReplacements } from "./segmentedText";
import { XMLBytes, XMLEdits, intRange, type XMLTag } from "./xmlText";
import { ZipArchive, ZipError, entryNamed, replaceEntry, type ZipEntry } from "./zip";

// MARK: - Excel (.xlsx): cella per cella
//
// Il testo delle celle sta nelle stringhe condivise (una stringa usata in più celle si scrive una volta), nelle stringhe
// in linea e nei risultati delle formule di testo; telefoni e partite IVA spesso sono numeri. Il motore legge i fogli
// riga per riga (così ha il contesto), poi i segnaposto tornano nelle stringhe: una stringa condivisa prende l'unione di
// quello che si è trovato in tutte le celle che la usano. Un numero che va nascosto diventa testo. Anche intestazioni e
// piè di pagina e i commenti; gli autori dei commenti diventano «Autore».

class SpreadsheetPart {
  readonly xml: XMLBytes;
  readonly tags: XMLTag[];
  readonly prefix: string;

  constructor(
    readonly path: string,
    data: Uint8Array,
  ) {
    this.xml = new XMLBytes(data);
    this.tags = this.xml.tags();
    this.prefix = this.xml.prefix(SpreadsheetFile.namespaces, this.tags) ?? "";
  }

  name(local: string): string {
    return XMLBytes.qualified(this.prefix, local);
  }
}

export type SpreadsheetCellKind =
  | { kind: "shared"; index: number }
  | { kind: "inline"; nodes: TextNode[] }
  | { kind: "formulaText"; node: TextNode }
  /** Il tag «<c>», la fine dell'elemento e il valore. */
  | { kind: "number"; cell: XMLTag; end: number; value: TextNode };

export interface SpreadsheetCell {
  readonly row: number;
  readonly column: number;
  readonly kind: SpreadsheetCellKind;
}

interface Sheet {
  readonly name: string;
  readonly part: SpreadsheetPart;
  readonly cells: SpreadsheetCell[];
  readonly headerFooter: TextNode[];
}

/** Dove sta il testo di un segmento. */
export type SpreadsheetSource =
  | { kind: "cell"; sheet: number; cell: number }
  | { kind: "headerFooter"; sheet: number; node: number }
  | { kind: "comment"; part: number; nodes: TextNode[] };

/** Un intero come lo legge `Int(String)` di Swift (niente spazi, niente decimali). */
function parseInteger(text: string): number | null {
  return /^[+-]?[0-9]+$/.test(text) ? parseInt(text, 10) : null;
}

export class SpreadsheetFile {
  static readonly namespaces = [
    "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "http://purl.oclc.org/ooxml/spreadsheetml/main",
  ];

  readonly entries: readonly ZipEntry[];
  private readonly sharedPart: SpreadsheetPart | null;
  private readonly sharedItems: TextNode[][];
  private readonly sheets: Sheet[];
  private readonly commentParts: SpreadsheetPart[];

  constructor(data: Uint8Array) {
    const entries = ZipArchive.read(data);
    this.entries = entries;
    const workbookEntry = entryNamed(entries, "xl/workbook.xml");
    if (!workbookEntry) throw ZipError.unsupported("manca xl/workbook.xml");
    const workbook = new SpreadsheetPart("xl/workbook.xml", workbookEntry.data);
    const relationships = OfficePaths.relationships(workbook.path, entries);

    // Stringhe condivise.
    const sharedRelationship = [...relationships.values()].find((r) => r.type.endsWith("/sharedStrings"));
    const sharedPath = sharedRelationship ? OfficePaths.resolve(sharedRelationship.target, workbook.path) : "xl/sharedStrings.xml";
    const sharedEntry = entryNamed(entries, sharedPath);
    if (sharedEntry) {
      const part = new SpreadsheetPart(sharedPath, sharedEntry.data);
      this.sharedPart = part;
      this.sharedItems = SpreadsheetFile.sharedItems(part);
    } else {
      this.sharedPart = null;
      this.sharedItems = [];
    }

    // Fogli, nell'ordine della cartella di lavoro.
    const sheets: Sheet[] = [];
    for (const tag of workbook.tags) {
      if (tag.isEnd || tag.name !== workbook.name("sheet")) continue;
      const attributes = workbook.xml.attributes(tag);
      const id = [...attributes].find(([key]) => key === "r:id" || key.endsWith(":id"))?.[1].value;
      if (id === undefined) continue;
      const relationship = relationships.get(id);
      if (!relationship || !relationship.type.endsWith("/worksheet")) continue;
      const path = OfficePaths.resolve(relationship.target, workbook.path);
      const entry = entryNamed(entries, path);
      if (!entry) continue;
      const part = new SpreadsheetPart(path, entry.data);
      const { cells, headerFooter } = SpreadsheetFile.cells(part);
      sheets.push({ name: attributes.get("name")?.value ?? "Foglio", part, cells, headerFooter });
    }
    this.sheets = sheets;
    this.commentParts = entries
      .filter(
        (entry) => (entry.name.startsWith("xl/comments") || entry.name.startsWith("xl/threadedComments/")) && entry.name.endsWith(".xml"),
      )
      .map((entry) => new SpreadsheetPart(entry.name, entry.data));
  }

  private static sharedItems(part: SpreadsheetPart): TextNode[][] {
    const items: TextNode[][] = [];
    let current: TextNode[] | null = null;
    let phonetic = false;
    part.tags.forEach((tag, index) => {
      switch (tag.name) {
        case part.name("si"):
          if (tag.isSelfClosing) items.push([]);
          else if (tag.isEnd) {
            items.push(current ?? []);
            current = null;
          } else current = [];
          break;
        case part.name("rPh"):
          phonetic = !tag.isEnd && !tag.isSelfClosing;
          break;
        case part.name("t"):
          if (!tag.isEnd && !phonetic && current !== null) {
            const node = part.xml.textNode(index, part.tags);
            if (node) current.push(node);
          }
          break;
      }
    });
    return items;
  }

  private static cells(part: SpreadsheetPart): { cells: SpreadsheetCell[]; headerFooter: TextNode[] } {
    const cells: SpreadsheetCell[] = [];
    const headerFooter: TextNode[] = [];
    const headerFooterNames = new Set(
      ["oddHeader", "oddFooter", "evenHeader", "evenFooter", "firstHeader", "firstFooter"].map((n) => part.name(n)),
    );
    let row = 0;
    let index = 0;
    const tags = part.tags;
    while (index < tags.length) {
      const tag = tags[index];
      if (!tag.isEnd && tag.name === part.name("row")) {
        const r = part.xml.attributes(tag).get("r");
        row = (r ? parseInteger(r.value) : null) ?? row + 1;
      } else if (!tag.isEnd && headerFooterNames.has(tag.name) && part.xml.textNode(index, tags)) {
        headerFooter.push(part.xml.textNode(index, tags)!);
      } else if (!tag.isEnd && !tag.isSelfClosing && tag.name === part.name("c")) {
        const attributes = part.xml.attributes(tag);
        const position = SpreadsheetFile.position(attributes.get("r")?.value ?? null, row, cells[cells.length - 1] ?? null);
        const type = attributes.get("t")?.value ?? "n";
        let value: TextNode | null = null;
        const inline: TextNode[] = [];
        let hasFormula = false;
        let phonetic = false;
        let j = index + 1;
        while (j < tags.length && !(tags[j].isEnd && tags[j].name === part.name("c"))) {
          const inner = tags[j];
          if (inner.name === part.name("rPh")) phonetic = !inner.isEnd && !inner.isSelfClosing;
          if (!inner.isEnd) {
            if (inner.name === part.name("v")) value = part.xml.textNode(j, tags);
            if (inner.name === part.name("f")) hasFormula = true;
            if (inner.name === part.name("t") && !phonetic) {
              const node = part.xml.textNode(j, tags);
              if (node) inline.push(node);
            }
          }
          j += 1;
        }
        const end = j < tags.length ? tags[j].range.upperBound : tag.range.upperBound;
        const at = { row: position.row, column: position.column };
        switch (type) {
          case "s": {
            const shared = value ? parseInteger(value.text.replace(/^[ \t   -   　]+|[ \t   -   　]+$/g, "")) : null;
            if (shared !== null) cells.push({ ...at, kind: { kind: "shared", index: shared } });
            break;
          }
          case "inlineStr":
            if (inline.length > 0) cells.push({ ...at, kind: { kind: "inline", nodes: inline } });
            break;
          case "str":
            if (value) cells.push({ ...at, kind: { kind: "formulaText", node: value } });
            break;
          case "n":
            if (value && !hasFormula) cells.push({ ...at, kind: { kind: "number", cell: tag, end, value } });
            break;
        }
        index = j;
      }
      index += 1;
    }
    return { cells, headerFooter };
  }

  /** «B12» → (12, 1); senza riferimento, la cella dopo la precedente. */
  static position(reference: string | null, row: number, previous: SpreadsheetCell | null): { row: number; column: number } {
    if (reference === null || reference.length === 0) {
      if (previous && previous.row === row) return { row, column: previous.column + 1 };
      return { row, column: 0 };
    }
    let column = 0;
    let digits = "";
    for (const character of reference.toUpperCase()) {
      if (/^[A-Z]$/.test(character)) {
        column = column * 26 + (character.charCodeAt(0) - 64);
      } else if (/^\p{N}$/u.test(character)) {
        digits += character;
      }
    }
    return { row: parseInteger(digits) ?? row, column: Math.max(0, column - 1) };
  }

  // MARK: Segmenti

  private texts(cell: SpreadsheetCell): string[] | null {
    const kind = cell.kind;
    switch (kind.kind) {
      case "shared":
        return kind.index < this.sharedItems.length ? this.sharedItems[kind.index].map((node) => node.text) : null;
      case "inline":
        return kind.nodes.map((node) => node.text);
      case "formulaText":
        return [kind.node.text];
      case "number":
        return [kind.value.text];
    }
  }

  /** Le righe di un foglio, in ordine: numero di riga → indici delle celle. */
  private static rows(sheet: Sheet): [number, number[]][] {
    const groups = new Map<number, number[]>();
    sheet.cells.forEach((cell, index) => {
      const list = groups.get(cell.row);
      if (list) list.push(index);
      else groups.set(cell.row, [index]);
    });
    return [...groups].sort((a, b) => a[0] - b[0]);
  }

  segmented(): { content: SegmentedText; sources: SpreadsheetSource[] } {
    const content = new SegmentedText();
    const sources: SpreadsheetSource[] = [];
    this.sheets.forEach((sheet, s) => {
      const rows = SpreadsheetFile.rows(sheet);
      const hints = new Map<number, string>();
      rows.forEach(([, row], r) => {
        const ordered = [...row].sort((a, b) => sheet.cells[a].column - sheet.cells[b].column);
        if (r === 0) {
          // Intestazione: le colonne riconosciute, per colonna del foglio.
          const texts = ordered.map((i) => this.texts(sheet.cells[i])?.join("") ?? "");
          const labels = ColumnHints.headerLabels(texts);
          if (labels) for (const [position, label] of labels) hints.set(sheet.cells[ordered[position]].column, label);
        }
        ordered.forEach((cellIndex, position) => {
          const units = this.texts(sheet.cells[cellIndex]);
          if (units === null) return;
          const hint = r > 0 ? (hints.get(sheet.cells[cellIndex].column) ?? null) : null;
          content.addSegment(units, position === ordered.length - 1 ? "\n" : "\t", hint);
          sources.push({ kind: "cell", sheet: s, cell: cellIndex });
        });
      });
      sheet.headerFooter.forEach((node, n) => {
        content.addSegment([node.text], "\n");
        sources.push({ kind: "headerFooter", sheet: s, node: n });
      });
    });
    this.commentParts.forEach((part, p) => {
      for (const nodes of SpreadsheetFile.commentTexts(part)) {
        if (nodes.length === 0) continue;
        content.addSegment(
          nodes.map((node) => node.text),
          "\n",
        );
        sources.push({ kind: "comment", part: p, nodes });
      }
    });
    return { content, sources };
  }

  /** I testi dei commenti, uno per commento (classici: «<comment><text>…<t>»; nuovi: «<threadedComment><text>»). */
  private static commentTexts(part: SpreadsheetPart): TextNode[][] {
    const result: TextNode[][] = [];
    let current: TextNode[] | null = null;
    const threaded = part.path.includes("threadedComments");
    part.tags.forEach((tag, index) => {
      const local = localName(tag.name);
      if (threaded) {
        if (local === "text" && !tag.isEnd) {
          const node = part.xml.textNode(index, part.tags);
          if (node) result.push([node]);
        }
        return;
      }
      if (local === "comment") {
        if (tag.isEnd) {
          result.push(current ?? []);
          current = null;
        } else if (!tag.isSelfClosing) current = [];
      } else if (local === "t" && !tag.isEnd && current !== null) {
        const node = part.xml.textNode(index, part.tags);
        if (node) current.push(node);
      }
    });
    return result;
  }

  /** Il file con le sostituzioni (`anonymized`: toglie anche metadati e autori). */
  applying(
    replacements: SegmentReplacements,
    content: SegmentedText,
    sources: readonly SpreadsheetSource[],
    anonymized: boolean,
  ): Uint8Array {
    const entries = [...this.entries];
    const sharedEdits = new XMLEdits();
    const sheetEdits = this.sheets.map(() => new XMLEdits());
    const commentEdits = this.commentParts.map(() => new XMLEdits());
    const sharedReplacements = new Map<number, SegmentedText.Replacement[][]>();
    const encoder = new TextEncoder();

    for (const [segment, list] of replacements) {
      if (list.length === 0) continue;
      const source = sources[segment];
      const units = content.unitsOf(segment);
      switch (source.kind) {
        case "cell": {
          const sheet = this.sheets[source.sheet];
          const kind = sheet.cells[source.cell].kind;
          const edits = sheetEdits[source.sheet];
          switch (kind.kind) {
            case "shared": {
              const lists = sharedReplacements.get(kind.index);
              if (lists) lists.push(list);
              else sharedReplacements.set(kind.index, [list]);
              break;
            }
            case "inline": {
              const texts = SegmentedText.distribute(units, list);
              kind.nodes.forEach((node, k) => {
                if (k < texts.length) sheet.part.xml.edit(node, texts[k], edits);
              });
              break;
            }
            case "formulaText": {
              const text = SegmentedText.distribute(units, list).join("");
              sheet.part.xml.edit(kind.node, text, edits);
              break;
            }
            case "number": {
              // Un numero da nascondere diventa testo in linea, con lo stesso stile.
              const text = SegmentedText.distribute(units, list).join("");
              const bytes = sheet.part.xml.bytes;
              let tag = new TextDecoder().decode(bytes.subarray(kind.cell.range.lowerBound, kind.cell.range.upperBound));
              tag = tag.replace(/\s+t\s*=\s*"[^"]*"/g, "");
              tag = tag.slice(0, -1) + ' t="inlineStr"' + tag.slice(-1);
              const element = tag + `<${sheet.part.name("is")}><${sheet.part.name("t")} xml:space="preserve">`;
              const closing = `</${sheet.part.name("t")}></${sheet.part.name("is")}></${sheet.part.name("c")}>`;
              const escaped = XMLBytes.escape(text);
              const head = encoder.encode(element);
              const tail = encoder.encode(closing);
              const replacement = new Uint8Array(head.length + escaped.length + tail.length);
              replacement.set(head, 0);
              replacement.set(escaped, head.length);
              replacement.set(tail, head.length + escaped.length);
              edits.replace(intRange(kind.cell.range.lowerBound, kind.end), replacement);
              break;
            }
          }
          break;
        }
        case "headerFooter": {
          const node = this.sheets[source.sheet].headerFooter[source.node];
          const text = SegmentedText.distribute(units, list).join("");
          this.sheets[source.sheet].part.xml.edit(node, text, sheetEdits[source.sheet]);
          break;
        }
        case "comment": {
          const texts = SegmentedText.distribute(units, list);
          source.nodes.forEach((node, k) => {
            if (k < texts.length) this.commentParts[source.part].xml.edit(node, texts[k], commentEdits[source.part]);
          });
          break;
        }
      }
    }
    const sharedPart = this.sharedPart;
    if (sharedPart) {
      for (const [index, lists] of sharedReplacements) {
        if (index >= this.sharedItems.length) continue;
        const nodes = this.sharedItems[index];
        const texts = SegmentedText.distribute(
          nodes.map((node) => node.text),
          SegmentedText.merge(lists),
        );
        nodes.forEach((node, k) => {
          if (k < texts.length) sharedPart.xml.edit(node, texts[k], sharedEdits);
        });
      }
      if (!sharedEdits.isEmpty) replaceEntry(entries, sharedPart.path, sharedEdits.applied(sharedPart.xml.bytes));
    }
    this.sheets.forEach((sheet, s) => {
      if (!sheetEdits[s].isEmpty) replaceEntry(entries, sheet.part.path, sheetEdits[s].applied(sheet.part.xml.bytes));
    });
    this.commentParts.forEach((part, p) => {
      if (anonymized) {
        // Gli autori dei commenti: «<author>Mario Rossi</author>».
        part.tags.forEach((tag, index) => {
          if (tag.isEnd || localName(tag.name) !== "author") return;
          const node = part.xml.textNode(index, part.tags);
          if (node && node.text.length > 0) part.xml.edit(node, "Autore", commentEdits[p]);
        });
      }
      if (!commentEdits[p].isEmpty) replaceEntry(entries, part.path, commentEdits[p].applied(part.xml.bytes));
    });
    if (anonymized) {
      OfficeMetadata.neutralize(entries);
      for (const entry of [...entries]) {
        if (!entry.name.startsWith("xl/persons/") || !entry.name.endsWith(".xml")) continue;
        const xml = new XMLBytes(entry.data);
        const edits = new XMLEdits();
        OfficeMetadata.neutralizeAuthors(xml, xml.tags(), new Set(["displayName", "userId"]), edits);
        if (!edits.isEmpty) replaceEntry(entries, entry.name, edits.applied(xml.bytes));
      }
    }
    return ZipArchive.write(entries);
  }

  // MARK: Anteprima

  /** I fogli come tabelle (al massimo `maxRows` righe e `maxColumns` colonne). */
  preview(maxRows = 200, maxColumns = 40): PreviewSheet[] {
    return this.sheets.map((sheet) => {
      const grid: string[][] = [];
      const rows = SpreadsheetFile.rows(sheet).slice(0, maxRows);
      const maxColumn = sheet.cells.reduce((m, cell) => Math.max(m, cell.column), -1);
      const columns = Math.min(maxColumns, maxColumn + 1);
      for (const [, indices] of rows) {
        const line = new Array<string>(columns).fill("");
        for (const index of indices) {
          const cell = sheet.cells[index];
          if (cell.column < columns) line[cell.column] = this.texts(cell)?.join("") ?? "";
        }
        grid.push(line);
      }
      return { name: sheet.name, rows: grid };
    });
  }
}
