import { describe, expect, test } from "vitest";
import { AnonymizationSettings } from "../src/core/anonimizzazione";
import { Vault } from "../src/core/dizionario";
import { DocumentNaming, TextDocument } from "../src/core/documenti";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const output = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrays) {
    output.set(a, offset);
    offset += a.length;
  }
  return output;
}

/** I file .txt e .md: si riscrivono con la stessa codifica, lo stesso BOM e gli stessi a-capo. */
describe("TextDocumentTests", () => {
  test("utf8WithAndWithoutBOM", () => {
    const plain = TextDocument.decode(encode("Città: Forlì\r\nRiga 2"), "plainText");
    expect(plain.encoding).toBe("utf8");
    expect(plain.hasBOM).toBe(false);
    expect(plain.text).toBe("Città: Forlì\r\nRiga 2");
    expect(plain.data()).toEqual(encode("Città: Forlì\r\nRiga 2"));

    const withBOM = TextDocument.decode(concat([0xef, 0xbb, 0xbf], encode("# Titolo")), "markdown");
    expect(withBOM.hasBOM).toBe(true);
    expect(withBOM.text).toBe("# Titolo");
    expect(withBOM.data()).toEqual(concat([0xef, 0xbb, 0xbf], encode("# Titolo")));
  });

  test("utf16AndLegacyEncodings", () => {
    const utf16 = concat([0xff, 0xfe], new Uint8Array(Buffer.from("Però", "utf16le")));
    const document = TextDocument.decode(utf16, "plainText");
    expect(document.encoding).toBe("utf16LittleEndian");
    expect(document.text).toBe("Però");
    expect(document.data()).toEqual(utf16);

    // Un file vecchio di Windows: «è» è un byte solo.
    const windows = Uint8Array.from([0x50, 0x65, 0x72, 0x63, 0x68, 0xe9, 0x20, 0xe8, 0x20, 0x63, 0x6f, 0x73, 0xec]);
    const legacy = TextDocument.decode(windows, "plainText");
    expect(legacy.text).toBe("Perché è così");
    expect(legacy.encoding).toBe("windowsCP1252");
    expect(legacy.data()).toEqual(windows);
  });

  /** Un dato vero che la codifica originale non ha: si salva in UTF-8 invece di perderlo. */
  test("unrepresentableTextFallsBackToUTF8", () => {
    const document = new TextDocument("Nome: Łukasz Żółć", "plainText", "windowsCP1252");
    expect(new TextDecoder().decode(document.data())).toBe("Nome: Łukasz Żółć");
  });

  /** Il nome del file non deve tradire il cliente: i dati del dizionario diventano segnaposto anche lì. */
  test("fileNamesDoNotLeakPersonalData", () => {
    const vault = new Vault();
    vault.placeholder("FULLNAME", "Mario Rossi");
    vault.placeholder("ORG", "Edilnord S.r.l.");
    vault.placeholder("DOCID", "Prot. 456/2024");
    const path = "/tmp/Contratto Mario Rossi - Edilnord.md";
    const anonymized = DocumentNaming.anonymizedName(path, vault, new AnonymizationSettings());
    expect(anonymized).toBe("Contratto [FULLNAME_1] - [ORG_1] (anonimizzato).md");
    expect(DocumentNaming.revealedName("/tmp/" + anonymized, vault)).toBe("Contratto Mario Rossi - Edilnord S.r.l. (riconvertito).md");
    expect(DocumentNaming.revealedName("/tmp/Atto [DOCID_1].txt", vault)).toBe("Atto Prot. 456-2024 (riconvertito).txt");
  });

  test("outputNames", () => {
    expect(DocumentNaming.anonymizedName("/tmp/Contratto Rossi.md")).toBe("Contratto Rossi (anonimizzato).md");
    expect(DocumentNaming.revealedName("/tmp/Contratto Rossi (anonimizzato).md")).toBe("Contratto Rossi (riconvertito).md");
    expect(DocumentNaming.revealedName("/tmp/risposta.txt")).toBe("risposta (riconvertito).txt");
    expect(TextDocument.kindOf("/tmp/a.MD")).toBe("markdown");
    expect(TextDocument.kindOf("/tmp/a.docx")).toBeNull();
  });
});
