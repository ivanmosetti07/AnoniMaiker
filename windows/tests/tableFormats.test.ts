import { describe, expect, onTestFinished, test } from "vitest";
import { CSVTable, FileReveal, SpreadsheetFile, anonymizeFile } from "../src/core/documenti";
import { FormatTest } from "./formatTestSupport";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (data: Uint8Array): string => new TextDecoder().decode(data);

/** Un .xlsx come lo scrive Excel: stringhe condivise (una con due formattazioni), numeri, testo in linea, formule. */
export function workbook(): Uint8Array {
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rels = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return FormatTest.office([
    ["[Content_Types].xml", FormatTest.contentTypes],
    ["_rels/.rels", FormatTest.rootRels],
    ["docProps/core.xml", FormatTest.core],
    ["xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="${main}" xmlns:r="${rels}"><sheets><sheet name="Clienti" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rels}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rels}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ["xl/sharedStrings.xml", `<?xml version="1.0"?><sst xmlns="${main}" count="7" uniqueCount="7"><si><t>Nome</t></si><si><t>Telefono</t></si><si><t>Email</t></si><si><t>Note</t></si><si><r><t xml:space="preserve">Giulia </t></r><r><rPr><b/></rPr><t>Neri</t></r></si><si><t>giulia@neri.it</t></si><si><t>Cliente dal 2020, IBAN IT60X0542811101000000123456</t></si></sst>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet xmlns="${main}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" s="3"><v>3331234567</v></c><c r="C2" t="s"><v>5</v></c><c r="D2" t="s"><v>6</v></c><c r="E2"><v>1250</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Paolo Verdi</t></is></c><c r="C3" t="str"><f>LOWER(A3)&amp;"@verdi.it"</f><v>paolo.verdi@verdi.it</v></c></row></sheetData><headerFooter><oddFooter>&amp;LPreparato per luca@studio.it</oddFooter></headerFooter></worksheet>`],
    ["xl/comments1.xml", `<?xml version="1.0"?><comments xmlns="${main}"><authors><author>Ivan Prova</author></authors><commentList><comment ref="A2" authorId="0"><text><r><t>Richiamare giulia@neri.it</t></r></text></comment></commentList></comments>`],
  ]);
}

/** CSV ed Excel, cella per cella. */
describe("TableFormatsTests", () => {
  // MARK: CSV

  test("csvKeepsItsShape", () => {
    // Excel italiano: «;», virgolette con a-capo dentro, CRLF, BOM.
    const text = 'Nome;Email;Note\r\n"Rossi; Mario";mario@rossi.it;"Riga 1\r\nRiga ""2"""\r\nBianchi;anna@bianchi.it;ok\r\n';
    const body = encode(text);
    const data = new Uint8Array(3 + body.length);
    data.set([0xef, 0xbb, 0xbf]);
    data.set(body, 3);
    const table = new CSVTable(data);
    expect(table.delimiter).toBe(";");
    expect(table.lineEnding).toBe("\r\n");
    expect(table.endsWithNewline).toBe(true);
    expect(table.rows.map((row) => row.map((f) => f.text))).toEqual([
      ["Nome", "Email", "Note"],
      ["Rossi; Mario", "mario@rossi.it", 'Riga 1\r\nRiga "2"'],
      ["Bianchi", "anna@bianchi.it", "ok"],
    ]);
    // Senza cambiare niente torna identico, byte per byte.
    expect(table.data()).toEqual(data);
    expect(CSVTable.delimiter("a,b,c\n1,2,3\n")).toBe(",");
    expect(CSVTable.delimiter("a\tb\n1\t2\n")).toBe("\t");
  });

  /** Le colonne «Cognome» ed «Email» si nascondono anche dove le regole non vedono niente; il resto resta. */
  test("csvCellByCell", async () => {
    const { anonymizer, cleanup } = FormatTest.anonymizer();
    onTestFinished(cleanup);
    const text = "Cognome;Email;Città;Importo\nRossi;mario@rossi.it;Milano;1.200,00\nBianchi;n/d;Roma;800\n";
    const outcome = await anonymizeFile(anonymizer, encode(text), "csv");
    expect(decode(outcome.data)).toBe("Cognome;Email;Città;Importo\n[FULLNAME_1];[EMAIL_1];Milano;1.200,00\n[FULLNAME_2];n/d;Roma;800\n");
    expect(outcome.report?.counts).toEqual({ FULLNAME: 2, EMAIL: 1 });
    const back = await FileReveal.reveal(outcome.data, "csv", await anonymizer.store.snapshot());
    expect(decode(back.data)).toBe(text);
    expect(back.reveal?.count).toBe(3);
    expect(back.preview).toEqual({
      kind: "sheets",
      sheets: [
        {
          name: "CSV",
          rows: [
            ["Cognome", "Email", "Città", "Importo"],
            ["Rossi", "mario@rossi.it", "Milano", "1.200,00"],
            ["Bianchi", "n/d", "Roma", "800"],
          ],
        },
      ],
    });
  });

  // MARK: Excel

  test("excelCellByCell", async () => {
    const { anonymizer, cleanup } = FormatTest.anonymizer();
    onTestFinished(cleanup);
    const source = workbook();
    const outcome = await anonymizeFile(anonymizer, source, "xlsx");
    expect(FormatTest.unzipTest(outcome.data)).toBe(true);

    const shared = FormatTest.part(outcome.data, "xl/sharedStrings.xml");
    // La colonna «Nome»: il nome in due formattazioni diventa un segnaposto nel primo pezzo (che resta normale).
    expect(shared).toContain('<r><t xml:space="preserve">[FULLNAME_1]</t></r><r><rPr><b/></rPr><t></t></r>');
    expect(shared).toContain("<t>[EMAIL_1]</t>");
    expect(shared).toContain("<t>Cliente dal 2020, IBAN [IBAN_1]</t>");
    expect(shared).toContain("<t>Nome</t>");
    expect(shared).toContain("<t>Telefono</t>");
    const sheet = FormatTest.part(outcome.data, "xl/worksheets/sheet1.xml");
    // Il telefono era un numero: diventa testo, con lo stesso stile; l'importo resta un numero.
    expect(sheet).toContain('<c r="B2" s="3" t="inlineStr"><is><t xml:space="preserve">[TELEPHONENUM_1]</t></is></c>');
    expect(sheet).toContain('<c r="E2"><v>1250</v></c>');
    expect(sheet).toContain("<is><t>[FULLNAME_2]</t></is>");
    expect(sheet).toContain("<v>[EMAIL_2]</v>");
    expect(sheet).toContain('<f>LOWER(A3)&amp;"@verdi.it"</f>');
    expect(sheet).toContain("&amp;LPreparato per [EMAIL_3]");
    const comments = FormatTest.part(outcome.data, "xl/comments1.xml");
    expect(comments).toContain("<author>Autore</author>");
    expect(comments).toContain("Richiamare [EMAIL_1]");
    const core = FormatTest.part(outcome.data, "docProps/core.xml");
    expect(core).not.toContain("Ivan");
    expect(core).not.toContain("Edilnord");

    // Riconvertito: tornano i dati (il telefono come testo); il resto dell'archivio è lo stesso.
    const back = await FileReveal.reveal(outcome.data, "xlsx", await anonymizer.store.snapshot());
    expect(FormatTest.unzipTest(back.data)).toBe(true);
    const revealedShared = FormatTest.part(back.data, "xl/sharedStrings.xml");
    expect(revealedShared).toContain('<t xml:space="preserve">Giulia Neri</t></r><r><rPr><b/></rPr><t></t>');
    expect(revealedShared).toContain("IBAN IT60X0542811101000000123456");
    expect(FormatTest.part(back.data, "xl/worksheets/sheet1.xml")).toContain('<t xml:space="preserve">3331234567</t>');
    if (back.preview.kind !== "sheets") throw new Error("anteprima");
    expect(back.preview.sheets[0]?.rows[0]).toEqual(["Nome", "Telefono", "Email", "Note", ""]);
    expect(FormatTest.part(back.data, "xl/workbook.xml")).toBe(FormatTest.part(source, "xl/workbook.xml"));
    // Il file riconvertito si rilegge.
    expect(new SpreadsheetFile(back.data).preview()[0].rows[1][0]).toBe("Giulia Neri");
  });
});
