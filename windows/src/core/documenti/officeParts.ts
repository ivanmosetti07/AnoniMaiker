import { XMLBytes, XMLEdits, type IntRange, type XMLTag } from "./xmlText";
import { entryNamed, replaceEntry, type ZipEntry } from "./zip";

// MARK: - Pezzi comuni ai file di Office
//
// Nodi di testo, modifiche dei nodi (con `xml:space="preserve"` se servono gli spazi ai bordi), percorsi delle parti e
// pulizia dei metadati: nel file anonimizzato non restano autore, ultimo autore, società e titolo.

/** Il contenuto di un elemento di testo («<w:t>», «<t>»). */
export interface TextNode {
  readonly startTag: XMLTag;
  readonly content: IntRange;
  readonly text: string;
}

/** Il valore di un attributo (per esempio l'indirizzo di un collegamento). */
export interface AttributeNode {
  readonly range: IntRange;
  readonly quote: number;
  readonly text: string;
}

/** Una relazione di una parte: Type, Target, esterna? */
export interface OfficeRelationship {
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

export abstract class OfficePaths {
  /** Il percorso di una parte a cui punta una relazione («worksheets/sheet1.xml» accanto a «xl/workbook.xml»). */
  static resolve(target: string, part: string): string {
    if (target.startsWith("/")) return target.slice(1);
    const components = part.split("/").filter((c) => c.length > 0);
    components.pop();
    for (const component of target.split("/").filter((c) => c.length > 0)) {
      if (component === "..") components.pop();
      else if (component !== ".") components.push(component);
    }
    return components.join("/");
  }

  /** Le relazioni di una parte: Id → (Type, Target, esterna?). */
  static relationships(part: string, entries: readonly ZipEntry[]): Map<string, OfficeRelationship> {
    const components = part.split("/").filter((c) => c.length > 0);
    const last = components.pop() ?? "";
    const relsPath = [...components, "_rels", last + ".rels"].join("/");
    const result = new Map<string, OfficeRelationship>();
    const entry = entryNamed(entries, relsPath);
    if (!entry) return result;
    const xml = new XMLBytes(entry.data);
    for (const tag of xml.tags()) {
      if (tag.isEnd || !tag.name.endsWith("Relationship")) continue;
      const attributes = xml.attributes(tag);
      const id = attributes.get("Id")?.value;
      const target = attributes.get("Target")?.value;
      if (id === undefined || target === undefined) continue;
      result.set(id, {
        type: attributes.get("Type")?.value ?? "",
        target,
        external: attributes.get("TargetMode")?.value === "External",
      });
    }
    return result;
  }
}

/** Il nome locale di un tag, senza prefisso («dc:creator» → «creator»). */
export function localName(name: string): string {
  const parts = name.split(":").filter((p) => p.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : name;
}

export abstract class OfficeMetadata {
  /** Toglie autore, ultimo autore, titolo, oggetto, parole chiave, società e responsabile dalle proprietà. */
  static neutralize(entries: ZipEntry[]): void {
    OfficeMetadata.clear(
      "docProps/core.xml",
      new Set(["creator", "lastModifiedBy", "title", "subject", "description", "keywords", "category"]),
      entries,
    );
    OfficeMetadata.clear("docProps/app.xml", new Set(["Company", "Manager", "HyperlinkBase"]), entries);
  }

  private static clear(path: string, locals: Set<string>, entries: ZipEntry[]): void {
    const entry = entryNamed(entries, path);
    if (!entry) return;
    const xml = new XMLBytes(entry.data);
    const tags = xml.tags();
    const edits = new XMLEdits();
    tags.forEach((tag, index) => {
      if (tag.isEnd || tag.isSelfClosing) return;
      if (!locals.has(localName(tag.name))) return;
      const node = xml.textNode(index, tags);
      if (!node || node.text.length === 0) return;
      edits.replace(node.content, new Uint8Array(0));
    });
    if (!edits.isEmpty) replaceEntry(entries, path, edits.applied(xml.bytes));
  }

  /** Gli autori di commenti e revisioni diventano «Autore». */
  static neutralizeAuthors(xml: XMLBytes, tags: readonly XMLTag[], names: Set<string>, edits: XMLEdits): void {
    const encoder = new TextEncoder();
    for (const tag of tags) {
      if (tag.isEnd) continue;
      for (const [name, attribute] of xml.attributes(tag)) {
        if (!names.has(name) || attribute.value.length === 0) continue;
        const replacement = name.endsWith("initials") ? "A" : name.toLowerCase().endsWith("userid") ? "" : "Autore";
        if (attribute.value !== replacement) edits.replace(attribute.range, encoder.encode(replacement));
      }
    }
  }
}
