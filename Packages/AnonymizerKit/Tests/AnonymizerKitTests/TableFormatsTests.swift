import Foundation
import Testing
@testable import AnonymizerKit

/// CSV ed Excel, cella per cella.
@Suite struct TableFormatsTests {
    // MARK: CSV

    @Test func csvKeepsItsShape() throws {
        // Excel italiano: «;», virgolette con a-capo dentro, CRLF, BOM.
        let text = "Nome;Email;Note\r\n\"Rossi; Mario\";mario@rossi.it;\"Riga 1\r\nRiga \"\"2\"\"\"\r\nBianchi;anna@bianchi.it;ok\r\n"
        let data = Data([0xEF, 0xBB, 0xBF]) + Data(text.utf8)
        let table = try CSVTable(data: data)
        #expect(table.delimiter == ";" && table.lineEnding == "\r\n" && table.endsWithNewline)
        #expect(table.rows.map { $0.map(\.text) } == [["Nome", "Email", "Note"], ["Rossi; Mario", "mario@rossi.it", "Riga 1\r\nRiga \"2\""],
                                                     ["Bianchi", "anna@bianchi.it", "ok"]])
        // Senza cambiare niente torna identico, byte per byte.
        #expect(table.data() == data)
        #expect(CSVTable.delimiter(of: "a,b,c\n1,2,3\n") == "," && CSVTable.delimiter(of: "a\tb\n1\t2\n") == "\t")
    }

    /// Le colonne «Cognome» ed «Email» si nascondono anche dove le regole non vedono niente; il resto resta.
    @Test func csvCellByCell() async throws {
        let (anonymizer, directory) = FormatTest.anonymizer()
        defer { try? FileManager.default.removeItem(at: directory) }
        let text = "Cognome;Email;Città;Importo\nRossi;mario@rossi.it;Milano;1.200,00\nBianchi;n/d;Roma;800\n"
        let outcome = try await anonymizer.anonymizeFile(Data(text.utf8), format: .csv)
        let output = String(decoding: outcome.data, as: UTF8.self)
        #expect(output == "Cognome;Email;Città;Importo\n[FULLNAME_1];[EMAIL_1];Milano;1.200,00\n[FULLNAME_2];n/d;Roma;800\n")
        #expect(outcome.report?.counts == ["FULLNAME": 2, "EMAIL": 1])
        let back = try await FileReveal.reveal(outcome.data, format: .csv, vault: anonymizer.store.snapshot())
        #expect(String(decoding: back.data, as: UTF8.self) == text && back.reveal?.count == 3)
        #expect(back.preview == .sheets([PreviewSheet(name: "CSV", rows: [["Cognome", "Email", "Città", "Importo"],
                                                                          ["Rossi", "mario@rossi.it", "Milano", "1.200,00"],
                                                                          ["Bianchi", "n/d", "Roma", "800"]])]))
    }

    // MARK: Excel

    /// Un .xlsx come lo scrive Excel: stringhe condivise (una con due formattazioni), numeri, testo in linea, formule.
    static func workbook() throws -> Data {
        let main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        let rels = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        return try FormatTest.office([
            ("[Content_Types].xml", FormatTest.contentTypes),
            ("_rels/.rels", FormatTest.rootRels),
            ("docProps/core.xml", FormatTest.core),
            ("xl/workbook.xml", #"<?xml version="1.0"?><workbook xmlns="\#(main)" xmlns:r="\#(rels)"><sheets><sheet name="Clienti" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
            ("xl/_rels/workbook.xml.rels", #"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="\#(rels)/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="\#(rels)/sharedStrings" Target="sharedStrings.xml"/></Relationships>"#),
            ("xl/sharedStrings.xml", #"<?xml version="1.0"?><sst xmlns="\#(main)" count="7" uniqueCount="7"><si><t>Nome</t></si><si><t>Telefono</t></si><si><t>Email</t></si><si><t>Note</t></si><si><r><t xml:space="preserve">Giulia </t></r><r><rPr><b/></rPr><t>Neri</t></r></si><si><t>giulia@neri.it</t></si><si><t>Cliente dal 2020, IBAN IT60X0542811101000000123456</t></si></sst>"#),
            ("xl/worksheets/sheet1.xml", #"<?xml version="1.0"?><worksheet xmlns="\#(main)"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" s="3"><v>3331234567</v></c><c r="C2" t="s"><v>5</v></c><c r="D2" t="s"><v>6</v></c><c r="E2"><v>1250</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Paolo Verdi</t></is></c><c r="C3" t="str"><f>LOWER(A3)&amp;"@verdi.it"</f><v>paolo.verdi@verdi.it</v></c></row></sheetData><headerFooter><oddFooter>&amp;LPreparato per luca@studio.it</oddFooter></headerFooter></worksheet>"#),
            ("xl/comments1.xml", #"<?xml version="1.0"?><comments xmlns="\#(main)"><authors><author>Ivan Prova</author></authors><commentList><comment ref="A2" authorId="0"><text><r><t>Richiamare giulia@neri.it</t></r></text></comment></commentList></comments>"#),
        ])
    }

    @Test func excelCellByCell() async throws {
        let (anonymizer, directory) = FormatTest.anonymizer()
        defer { try? FileManager.default.removeItem(at: directory) }
        let source = try Self.workbook()
        let outcome = try await anonymizer.anonymizeFile(source, format: .xlsx)

        let shared = try FormatTest.part(outcome.data, "xl/sharedStrings.xml")
        // La colonna «Nome»: il nome in due formattazioni diventa un segnaposto nel primo pezzo (che resta normale).
        #expect(shared.contains(#"<r><t xml:space="preserve">[FULLNAME_1]</t></r><r><rPr><b/></rPr><t></t></r>"#))
        #expect(shared.contains("<t>[EMAIL_1]</t>") && shared.contains("<t>Cliente dal 2020, IBAN [IBAN_1]</t>"))
        #expect(shared.contains("<t>Nome</t>") && shared.contains("<t>Telefono</t>"))
        let sheet = try FormatTest.part(outcome.data, "xl/worksheets/sheet1.xml")
        // Il telefono era un numero: diventa testo, con lo stesso stile; l'importo resta un numero.
        #expect(sheet.contains(#"<c r="B2" s="3" t="inlineStr"><is><t xml:space="preserve">[TELEPHONENUM_1]</t></is></c>"#))
        #expect(sheet.contains(#"<c r="E2"><v>1250</v></c>"#))
        #expect(sheet.contains("<is><t>[FULLNAME_2]</t></is>") && sheet.contains("<v>[EMAIL_2]</v>") && sheet.contains("<f>LOWER(A3)&amp;\"@verdi.it\"</f>"))
        #expect(sheet.contains("&amp;LPreparato per [EMAIL_3]"))
        let comments = try FormatTest.part(outcome.data, "xl/comments1.xml")
        #expect(comments.contains("<author>Autore</author>") && comments.contains("Richiamare [EMAIL_1]"))
        let core = try FormatTest.part(outcome.data, "docProps/core.xml")
        #expect(!core.contains("Ivan") && !core.contains("Edilnord"))

        // Riconvertito: tornano i dati (il telefono come testo); il resto dell'archivio è lo stesso.
        let back = try await FileReveal.reveal(outcome.data, format: .xlsx, vault: anonymizer.store.snapshot())
        let revealedShared = try FormatTest.part(back.data, "xl/sharedStrings.xml")
        #expect(revealedShared.contains(#"<t xml:space="preserve">Giulia Neri</t></r><r><rPr><b/></rPr><t></t>"#))
        #expect(revealedShared.contains("IBAN IT60X0542811101000000123456"))
        #expect(try FormatTest.part(back.data, "xl/worksheets/sheet1.xml").contains("<t xml:space=\"preserve\">3331234567</t>"))
        guard case .sheets(let sheets) = back.preview else { Issue.record("anteprima"); return }
        #expect(sheets.first?.rows.first == ["Nome", "Telefono", "Email", "Note", ""])
        #expect(try FormatTest.part(back.data, "xl/workbook.xml") == FormatTest.part(source, "xl/workbook.xml"))
    }
}
