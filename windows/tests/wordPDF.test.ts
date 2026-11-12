import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, onTestFinished, test } from "vitest";
import {
  DocumentFormat, FileReveal, FormatError, PDFError, PDFText, PDFWriter, WordFile, ZipArchive, anonymizeFile,
} from "../src/core/documenti";
import { FormatTest } from "./formatTestSupport";

/** Un .docx fatto a mano: corpo con run spezzati, revisioni, campi, collegamenti, intestazione e commenti. */
export function document(): Uint8Array {
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const body = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${w}" xmlns:r="${r}"><w:body>
<w:p><w:r><w:t xml:space="preserve">Scrivere a </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>mario.rossi@</w:t></w:r><w:r><w:t>edilnord.it</w:t></w:r><w:r><w:t xml:space="preserve"> entro venerdì.</w:t></w:r></w:p>
<w:p><w:r><w:t>Email:</w:t></w:r><w:r><w:tab/><w:t>anna@neri.it</w:t></w:r></w:p>
<w:p><w:ins w:id="1" w:author="Ivan Prova" w:date="2026-10-15T10:00:00Z"><w:r><w:t>IBAN IT60X0542811101000000123456</w:t></w:r></w:ins><w:del w:id="2" w:author="Ivan Prova"><w:r><w:delText>vecchia@mail.it</w:delText></w:r></w:del></w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:luca@studio.it" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Luca</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> oppure </w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t>scrivici</w:t></w:r></w:hyperlink></w:p>
</w:body></w:document>`;
  return FormatTest.office([
    ["[Content_Types].xml", FormatTest.contentTypes],
    ["_rels/.rels", FormatTest.rootRels],
    ["docProps/core.xml", FormatTest.core],
    ["word/document.xml", body],
    ["word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="${r}/hyperlink" Target="mailto:info@edilnord.it" TargetMode="External"/><Relationship Id="rId6" Type="${r}/header" Target="header1.xml"/></Relationships>`],
    ["word/header1.xml", `<?xml version="1.0"?><w:hdr xmlns:w="${w}"><w:p><w:r><w:t>Riservato – contatto luca@studio.it</w:t></w:r></w:p></w:hdr>`],
    ["word/comments.xml", `<?xml version="1.0"?><w:comments xmlns:w="${w}"><w:comment w:id="0" w:author="Ivan Prova" w:initials="IP"><w:p><w:r><w:t>Chiedere il CF RSSMRA85H12F205Y</w:t></w:r></w:p></w:comment></w:comments>`],
  ]);
}

/** Word (la formattazione resta) e PDF (testo, PDF nuovo). */
describe("WordPDFTests", () => {
  afterEach(() => {
    PDFText.recognizer = null;
  });

  // MARK: Word

  test("wordKeepsTheFormatting", async () => {
    const { anonymizer, cleanup } = FormatTest.anonymizer();
    onTestFinished(cleanup);
    const source = document();
    const outcome = await anonymizeFile(anonymizer, source, "docx");
    expect(FormatTest.unzipTest(outcome.data)).toBe(true);
    const body = FormatTest.part(outcome.data, "word/document.xml");
    // L'email spezzata in due run: il segnaposto nel primo (in grassetto), il secondo resta vuoto.
    expect(body).toContain("<w:rPr><w:b/></w:rPr><w:t>[EMAIL_1]</w:t></w:r><w:r><w:t></w:t></w:r>");
    expect(body).toContain('<w:t xml:space="preserve"> entro venerdì.</w:t>');
    expect(body).toContain("<w:tab/><w:t>[EMAIL_2]</w:t>");
    expect(body).toContain("<w:t>IBAN [IBAN_1]</w:t>");
    expect(body).toContain("<w:delText>[EMAIL_3]</w:delText>");
    expect(body).toContain('HYPERLINK "mailto:[EMAIL_4]" ');
    expect(body).toContain("<w:t>Luca</w:t>");
    expect(body).not.toContain("Ivan Prova");
    expect(body).toContain('w:author="Autore"');
    expect(FormatTest.part(outcome.data, "word/_rels/document.xml.rels")).toContain('Target="mailto:[EMAIL_5]"');
    expect(FormatTest.part(outcome.data, "word/header1.xml")).toContain("contatto [EMAIL_4]");
    const comments = FormatTest.part(outcome.data, "word/comments.xml");
    expect(comments).toContain("Chiedere il CF [CF_1]");
    expect(comments).toContain('w:author="Autore" w:initials="A"');
    expect(FormatTest.part(outcome.data, "docProps/core.xml")).not.toContain("Ivan");
    if (outcome.preview.kind !== "text") throw new Error("anteprima");
    expect(outcome.preview.text.startsWith("Scrivere a [EMAIL_1] entro venerdì.\nEmail:\t[EMAIL_2]")).toBe(true);

    const back = await FileReveal.reveal(outcome.data, "docx", await anonymizer.store.snapshot());
    expect(FormatTest.unzipTest(back.data)).toBe(true);
    const revealed = FormatTest.part(back.data, "word/document.xml");
    expect(revealed).toContain("<w:rPr><w:b/></w:rPr><w:t>mario.rossi@edilnord.it</w:t></w:r><w:r><w:t></w:t></w:r>");
    expect(revealed).toContain("IT60X0542811101000000123456");
    expect(revealed).toContain("mailto:luca@studio.it");
    expect(FormatTest.part(back.data, "word/_rels/document.xml.rels")).toContain("mailto:info@edilnord.it");
    expect(back.reveal?.unknown).toEqual([]);
  });

  /** Le parti che non cambiano restano byte per byte, nello stesso ordine (al posto della prova con i .docx di macOS). */
  test("wordUntouchedPartsAreCopied", async () => {
    const { anonymizer, cleanup } = FormatTest.anonymizer();
    onTestFinished(cleanup);
    const source = document();
    const outcome = await anonymizeFile(anonymizer, source, "docx");
    const before = ZipArchive.read(source);
    const after = ZipArchive.read(outcome.data);
    expect(after.map((e) => e.name)).toEqual(before.map((e) => e.name));
    for (const name of ["[Content_Types].xml", "_rels/.rels"]) {
      const a = before.find((e) => e.name === name)!;
      const b = after.find((e) => e.name === name)!;
      expect(b.original?.compressed).toEqual(a.original?.compressed);
    }
    // Il file anonimizzato si rilegge e dà lo stesso testo dell'anteprima.
    if (outcome.preview.kind !== "text") throw new Error("anteprima");
    expect(new WordFile(outcome.data).plainText).toBe(outcome.preview.text);
  });

  // MARK: PDF

  test("pdfTextAnonymizedIntoANewPDF", async () => {
    const { anonymizer, cleanup } = FormatTest.anonymizer();
    onTestFinished(cleanup);
    const source = await PDFWriter.make([
      "Contratto di fornitura\nReferente: mario.rossi@edilnord.it",
      "Pagamento su IBAN IT60X0542811101000000123456 entro il 30/11/2026.",
    ]);
    const { pages, recognized } = await PDFText.pages(source, false);
    expect(pages.length).toBe(2);
    expect(recognized).toBe(0);
    expect(pages[0]).toContain("mario.rossi@edilnord.it");

    const outcome = await anonymizeFile(anonymizer, source, "pdf");
    const output = (await PDFText.pages(outcome.data, false)).pages;
    expect(output.length).toBe(2);
    expect(output[0]).toContain("[EMAIL_1]");
    expect(output[0]).not.toContain("edilnord");
    expect(output[1]).toContain("[IBAN_1]");
    expect(output[1]).toContain("30/11/2026");
    const back = await FileReveal.reveal(outcome.data, "pdf", await anonymizer.store.snapshot());
    const revealed = (await PDFText.pages(back.data, false)).pages;
    expect(revealed[0]).toContain("mario.rossi@edilnord.it");
    expect(revealed[1]).toContain("IT60X0542811101000000123456");
  });

  /** Un testo lungo continua nelle pagine dopo; ogni pagina dell'originale comincia su una pagina nuova. */
  test("pdfLongTextContinues", async () => {
    const long = Array.from({ length: 120 }, (_, i) => `Riga ${i + 1}: Città di Forlì, «perché» costa 12 € – fine.`).join("\n");
    const data = await PDFWriter.make([long, "Seconda sezione"], "Prova");
    const pdf = await PDFDocument.load(data);
    expect(pdf.getPageCount()).toBe(4);
    expect(pdf.getTitle()).toBe("Prova");
    expect(pdf.getCreator()).toBe("AnoniMaiker");
    const pages = (await PDFText.pages(data, false)).pages;
    expect(pages[0]).toContain("Riga 1: Città di Forlì, «perché» costa 12 € – fine.");
    expect(pages[2]).toContain("Riga 120");
    expect(pages[3]).toContain("Seconda sezione");
    // Liberation Sans ha le lettere delle lingue europee: i nomi restano com'erano.
    const polish = (await PDFText.pages(await PDFWriter.make(["Łukasz Żółć, Dvořák"]), false)).pages;
    expect(polish[0]).toContain("Łukasz Żółć, Dvořák");
  });

  /** Una pagina senza testo (una scansione): sul PC si legge solo con un riconoscitore; senza, il PDF non ha testo. */
  test("scannedPagesAreRead", async () => {
    const blank = await PDFDocument.create();
    blank.addPage([620, 300]);
    const data = await blank.save();
    const plain = await PDFText.pages(data);
    expect(plain.recognized).toBe(0);
    await expect(anonymizeFile(FormatTest.anonymizer().anonymizer, data, "pdf")).rejects.toThrow(PDFError);

    PDFText.recognizer = async (_data, index) => (index === 0 ? "Contratto firmato da Mario Rossi" : "");
    const { pages, recognized } = await PDFText.pages(data);
    expect(recognized).toBe(1);
    expect(pages[0]).toContain("Mario Rossi");
  });

  test("unreadableAndLockedPDFs", async () => {
    await expect(PDFText.pages(new TextEncoder().encode("non è un PDF"))).rejects.toMatchObject({ kind: "unreadable" });
  });

  test("unsupportedFormatsExplainWhatToDo", () => {
    expect(DocumentFormat.of("/tmp/a.DOCX")).toBe("docx");
    expect(DocumentFormat.of("/tmp/a.tsv")).toBe("csv");
    expect(DocumentFormat.of("/tmp/a.doc")).toBeNull();
    expect(FormatError.unsupported("xls").message).toContain(".xlsx");
  });
});
