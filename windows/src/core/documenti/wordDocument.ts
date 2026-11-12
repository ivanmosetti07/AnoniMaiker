import { OfficeMetadata, type AttributeNode, type TextNode } from "./officeParts";
import { SegmentedText, type SegmentReplacements } from "./segmentedText";
import { XMLBytes, XMLEdits, type XMLTag } from "./xmlText";
import { ZipArchive, ZipError, entryNamed, replaceEntry, type ZipEntry } from "./zip";

// MARK: - Word (.docx): il testo cambia, la formattazione resta
//
// Un paragrafo di Word è spezzato in «run», ognuno con la sua formattazione («Mario » normale, «Rossi» in grassetto).
// Il motore legge il paragrafo intero; il segnaposto va nel run dove il dato comincia e ne prende la formattazione, il
// resto del dato sparisce dai run successivi. Si leggono il corpo, intestazioni e piè di pagina, note, commenti, il testo
// cancellato con le revisioni e i codici dei campi; anche gli indirizzi dei collegamenti («mailto:…»). Nel file
// anonimizzato gli autori di commenti e revisioni diventano «Autore».

class WordPart {
  constructor(
    readonly path: string,
    readonly xml: XMLBytes,
    readonly tags: XMLTag[],
    readonly prefix: string,
  ) {}

  name(local: string): string {
    return XMLBytes.qualified(this.prefix, local);
  }
}

export type WordUnit = { kind: "text"; part: number; node: TextNode } | { kind: "attribute"; part: number; node: AttributeNode };

export class WordFile {
  static readonly namespaces = [
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "http://purl.oclc.org/ooxml/wordprocessingml/main",
  ];

  readonly entries: readonly ZipEntry[];
  private readonly parts: WordPart[];
  /** Le relazioni esterne (collegamenti): la parte .rels e i suoi «Target». */
  private readonly relationshipParts: { path: string; xml: XMLBytes; targets: AttributeNode[] }[];

  constructor(data: Uint8Array) {
    const entries = ZipArchive.read(data);
    this.entries = entries;
    if (!entryNamed(entries, "word/document.xml")) throw ZipError.unsupported("manca word/document.xml");
    const textParts = entries
      .map((entry) => entry.name)
      .filter((name) => {
        if (!name.startsWith("word/") || !name.endsWith(".xml") || name.includes("/_rels/")) return false;
        const pieces = name.split("/").filter((p) => p.length > 0);
        const file = pieces.length > 0 ? pieces[pieces.length - 1] : name;
        return (
          file === "document.xml" ||
          file.startsWith("header") ||
          file.startsWith("footer") ||
          file === "footnotes.xml" ||
          file === "endnotes.xml" ||
          file === "comments.xml" ||
          name === "word/glossary/document.xml"
        );
      })
      .sort((a, b) => {
        // Il corpo prima di tutto, poi il resto in ordine.
        if (a === b) return 0;
        if (a === "word/document.xml") return -1;
        if (b === "word/document.xml") return 1;
        return a < b ? -1 : 1;
      });
    this.parts = textParts.flatMap((path) => {
      const entry = entryNamed(entries, path);
      if (!entry) return [];
      const xml = new XMLBytes(entry.data);
      const tags = xml.tags();
      return [new WordPart(path, xml, tags, xml.prefix(WordFile.namespaces, tags) ?? "w")];
    });
    this.relationshipParts = entries
      .filter((entry) => entry.name.startsWith("word/_rels/") && entry.name.endsWith(".rels"))
      .map((entry) => {
        const xml = new XMLBytes(entry.data);
        const targets: AttributeNode[] = [];
        for (const tag of xml.tags()) {
          if (tag.isEnd || !tag.name.endsWith("Relationship")) continue;
          const attributes = xml.attributes(tag);
          const target = attributes.get("Target");
          if (attributes.get("TargetMode")?.value !== "External" || !target) continue;
          targets.push({ range: target.range, quote: target.quote, text: target.value });
        }
        return { path: entry.name, xml, targets };
      });
  }

  // MARK: Segmenti

  /** Paragrafi (fatti di run), codici dei campi e indirizzi dei collegamenti, ognuno un segmento. */
  segmented(): { content: SegmentedText; units: WordUnit[] } {
    const content = new SegmentedText();
    const units: WordUnit[] = [];
    this.parts.forEach((part, p) => {
      let current: [string, WordUnit][] = [];
      const close = (separator: string): void => {
        if (current.length === 0) return;
        content.addSegment(
          current.map((c) => c[0]),
          separator,
        );
        units.push(...current.map((c) => c[1]));
        current = [];
      };
      const paragraph = part.name("p");
      const breaks = new Set([part.name("tab"), part.name("br"), part.name("cr"), part.name("ptab")]);
      // Il testo cancellato con le revisioni e i codici dei campi non fanno parte del testo visibile: segmenti a sé,
      // altrimenti si attaccherebbero alle parole vicine («…123456vecchia@mail.it»).
      const apart = new Set([part.name("delText"), part.name("instrText")]);
      part.tags.forEach((tag, index) => {
        if (tag.name === paragraph) {
          close("\n");
        } else if (breaks.has(tag.name) && !tag.isEnd) {
          close(tag.name === part.name("tab") || tag.name === part.name("ptab") ? "\t" : "\n");
        } else if (tag.name === part.name("t") && !tag.isEnd) {
          const node = part.xml.textNode(index, part.tags);
          if (node) current.push([node.text, { kind: "text", part: p, node }]);
        } else if (apart.has(tag.name) && !tag.isEnd) {
          const node = part.xml.textNode(index, part.tags);
          if (node) {
            close(" ");
            content.addSegment([node.text], " ");
            units.push({ kind: "text", part: p, node });
          }
        } else if (!tag.isEnd && tag.name === part.name("fldSimple")) {
          const instruction = part.xml.attributes(tag).get(part.name("instr"));
          if (instruction) {
            content.addSegment([instruction.value], " ");
            units.push({
              kind: "attribute",
              part: p,
              node: { range: instruction.range, quote: instruction.quote, text: instruction.value },
            });
          }
        }
      });
      close("\n");
    });
    this.relationshipParts.forEach((relationships, r) => {
      for (const target of relationships.targets) {
        content.addSegment([target.text], "\n");
        units.push({ kind: "attribute", part: this.parts.length + r, node: target });
      }
    });
    return { content, units };
  }

  /** Il file con le sostituzioni (`anonymized`: toglie anche metadati e autori). */
  applying(replacements: SegmentReplacements, content: SegmentedText, units: readonly WordUnit[], anonymized: boolean): Uint8Array {
    const entries = [...this.entries];
    const edits = Array.from({ length: this.parts.length + this.relationshipParts.length }, () => new XMLEdits());
    const texts = content.applying(replacements);
    units.forEach((unit, index) => {
      if (texts[index] === content.units[index]) return;
      const p = unit.part;
      const xml = p < this.parts.length ? this.parts[p].xml : this.relationshipParts[p - this.parts.length].xml;
      xml.edit(unit.node, texts[index], edits[p]);
    });
    if (anonymized) {
      this.parts.forEach((part, p) => {
        OfficeMetadata.neutralizeAuthors(part.xml, part.tags, new Set([part.name("author"), part.name("initials")]), edits[p]);
      });
    }
    this.parts.forEach((part, p) => {
      if (!edits[p].isEmpty) replaceEntry(entries, part.path, edits[p].applied(part.xml.bytes));
    });
    this.relationshipParts.forEach((relationships, r) => {
      const list = edits[this.parts.length + r];
      if (!list.isEmpty) replaceEntry(entries, relationships.path, list.applied(relationships.xml.bytes));
    });
    if (anonymized) {
      OfficeMetadata.neutralize(entries);
      // Le persone che hanno commentato o modificato: «word/people.xml».
      const people = entryNamed(entries, "word/people.xml");
      if (people) {
        const xml = new XMLBytes(people.data);
        const personEdits = new XMLEdits();
        OfficeMetadata.neutralizeAuthors(xml, xml.tags(), new Set(["w15:author", "w15:userId"]), personEdits);
        if (!personEdits.isEmpty) replaceEntry(entries, "word/people.xml", personEdits.applied(xml.bytes));
      }
    }
    return ZipArchive.write(entries);
  }

  /** Il testo del documento (corpo, poi intestazioni, note, commenti), un paragrafo per riga. */
  get plainText(): string {
    const { content, units } = this.segmented();
    const lines: string[] = [];
    let line = "";
    for (let segment = 0; segment < content.segments.length; segment++) {
      // Solo il testo visibile: niente codici dei campi, testo cancellato o collegamenti.
      const unit = units[content.segments[segment].lowerBound];
      if (unit.kind !== "text" || unit.node.startTag.name !== this.parts[unit.part].name("t")) continue;
      line += content.text(segment);
      if (content.separators[segment] === "\n") {
        lines.push(line);
        line = "";
      } else {
        line += content.separators[segment];
      }
    }
    if (line.length > 0) lines.push(line);
    return lines.join("\n");
  }
}
