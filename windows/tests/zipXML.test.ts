import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ColumnHints, SegmentedText, XMLBytes, XMLEdits, ZipArchive, ZipEntry, ZipError, entryNamed } from "../src/core/documenti";
import { FormatTest } from "./formatTestSupport";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (data: Uint8Array): string => new TextDecoder().decode(data);

/** Gli archivi ZIP e l'XML a byte: la base di Excel e Word. */
describe("ZipXMLTests", () => {
  test("zipRoundTrip", () => {
    const text = "Mario Rossi, via Garibaldi 24. ".repeat(200);
    const entries = [
      new ZipEntry("a.xml", encode(text)),
      new ZipEntry("cartella/b.bin", Uint8Array.from([0, 1, 2, 3]), 0),
      new ZipEntry("vuoto.txt", new Uint8Array(0)),
    ];
    const archive = ZipArchive.write(entries);
    expect(archive.length).toBeLessThan(encode(text).length); // compresso
    const read = ZipArchive.read(archive);
    expect(read.map((e) => e.name)).toEqual(["a.xml", "cartella/b.bin", "vuoto.txt"]);
    expect(entryNamed(read, "a.xml")?.data).toEqual(encode(text));
    expect(entryNamed(read, "cartella/b.bin")?.data).toEqual(Uint8Array.from([0, 1, 2, 3]));
    // Le voci che non cambiano si ricopiano identiche.
    expect(ZipArchive.write(read)).toEqual(archive);
    expect(FormatTest.unzipTest(archive)).toBe(true);
  });

  /** Un archivio fatto da uno strumento del sistema (come quelli di Office): si legge. */
  test("readsArchivesMadeByOtherTools", (context) => {
    const directory = mkdtempSync(join(tmpdir(), "zip-prova-"));
    try {
      const source = join(directory, "sorgente");
      mkdirSync(join(source, "xl"), { recursive: true });
      const body = "<row>Riga di prova</row>\n".repeat(300);
      writeFileSync(join(source, "xl/foglio.xml"), body);
      writeFileSync(join(source, "nota.txt"), "ciao");
      const archive = join(directory, "prova.zip");
      try {
        if (process.platform === "darwin") {
          execFileSync("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--noextattr", source, archive]);
        } else if (process.platform === "win32") {
          execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${source}\\*' -DestinationPath '${archive}'`]);
        } else {
          execFileSync("zip", ["-r", archive, "."], { cwd: source });
        }
      } catch {
        context.skip();
        return;
      }
      const entries = ZipArchive.read(new Uint8Array(readFileSync(archive)));
      expect(decode(entries.find((e) => e.name.endsWith("xl/foglio.xml"))!.data)).toBe(body);
      expect(decode(entries.find((e) => e.name.endsWith("nota.txt"))!.data)).toBe("ciao");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("corruptedArchivesAreRefused", () => {
    const archive = ZipArchive.write([new ZipEntry("a.txt", encode("abc".repeat(50)), 0)]);
    // Un byte del contenuto cambiato: il CRC non torna.
    archive[40] ^= 0xff;
    expect(() => ZipArchive.read(archive)).toThrow(ZipError);
    try {
      ZipArchive.read(encode("non è uno zip"));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ZipError);
      expect((error as ZipError).kind).toBe("notAnArchive");
    }
  });

  test("xmlTagsAndText", () => {
    const source =
      '<?xml version="1.0"?><!-- <w:t>no</w:t> --><w:p a="x > y"><w:r><w:t xml:space="preserve">Rossi &amp; C. &#233;</w:t></w:r><![CDATA[<w:t>no</w:t>]]><w:t/></w:p>';
    const xml = new XMLBytes(encode(source));
    const tags = xml.tags();
    expect(tags.map((t) => t.name)).toEqual(["w:p", "w:r", "w:t", "w:t", "w:r", "w:t", "w:p"]);
    expect(xml.attributes(tags[0]).get("a")?.value).toBe("x > y");
    const node = xml.textNode(2, tags);
    expect(node?.text).toBe("Rossi & C. é");
    expect(tags[5].isSelfClosing).toBe(true);
    // Solo il testo cambia; il resto resta byte per byte.
    const edits = new XMLEdits();
    xml.edit(node!, "[ORG_1] <ok>", edits);
    const output = decode(edits.applied(xml.bytes));
    expect(output).toBe(source.replace("Rossi &amp; C. &#233;", "[ORG_1] &lt;ok&gt;"));
  });

  /** Spazi ai bordi: l'elemento li deve conservare. */
  test("edgeSpacesArePreserved", () => {
    const xml = new XMLBytes(encode("<w:t>Mario</w:t>"));
    const tags = xml.tags();
    const edits = new XMLEdits();
    xml.edit(xml.textNode(0, tags)!, " [FULLNAME_1]", edits);
    expect(decode(edits.applied(xml.bytes))).toBe('<w:t xml:space="preserve"> [FULLNAME_1]</w:t>');
  });

  /** Un dato spezzato fra più nodi: il segnaposto va dove comincia, il resto sparisce. */
  test("replacementsAcrossUnits", () => {
    const units = ["Gentile Mario ", "Rossi", ", a presto"];
    const result = SegmentedText.distribute(units, [{ start: 8, end: 19, text: "[FULLNAME_1]" }]);
    expect(result).toEqual(["Gentile [FULLNAME_1]", "", ", a presto"]);
    expect(
      SegmentedText.merge([
        [{ start: 0, end: 5, text: "A" }],
        [
          { start: 0, end: 11, text: "B" },
          { start: 12, end: 14, text: "C" },
        ],
      ]),
    ).toEqual([
      { start: 0, end: 11, text: "B" },
      { start: 12, end: 14, text: "C" },
    ]);
  });

  test("columnHeaders", () => {
    expect(ColumnHints.label("E-mail")).toBe("EMAIL");
    expect(ColumnHints.label("Cell.")).toBe("TELEPHONENUM");
    expect(ColumnHints.label("Nome azienda")).toBe("ORG");
    expect(ColumnHints.label("Cognome")).toBe("FULLNAME");
    expect(ColumnHints.label("C.F.")).toBe("CF");
    expect(ColumnHints.label("P.IVA")).toBe("PIVA");
    expect(ColumnHints.label("Importo")).toBeNull();
    expect(ColumnHints.label("Inviato")).toBeNull();
    expect(ColumnHints.headerLabels(["Nome", "Email", "Importo"])).toEqual(
      new Map([
        [0, "FULLNAME"],
        [1, "EMAIL"],
      ]),
    );
    expect(ColumnHints.headerLabels(["Mario", "mario@x.it", "12"])).toBeNull();
    expect(ColumnHints.accepts("n/d", "EMAIL")).toBe(false);
    expect(ColumnHints.accepts("Rossi", "FULLNAME")).toBe(true);
  });
});
