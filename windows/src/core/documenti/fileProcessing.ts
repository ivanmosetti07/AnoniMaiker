import { Revealer, anonymizeSegmented, type AnonymizationReport, type AnonymizeOptions, type Anonymizer, type RevealResult } from "../anonimizzazione";
import type { Vault } from "../dizionario";
import { CSVTable } from "./csvDocument";
import { PDFError, PDFText, PDFWriter } from "./pdfFiles";
import { DocumentPreview, SegmentedRevealer, SegmentedText, trimWhitespace } from "./segmentedText";
import { SpreadsheetFile } from "./spreadsheetDocument";
import { TextDocument, pathExtension, type TextDocumentKind } from "./textDocument";
import { WordFile } from "./wordDocument";

// MARK: - Tutti i formati, una porta sola
//
// Testo e Markdown, CSV ed Excel (cella per cella), Word (con la formattazione), PDF (con l'OCR per le scansioni, se
// c'è, e un PDF nuovo in uscita). Anonimizzare, riconvertire e mostrare un'anteprima passano tutti da qui.

export type DocumentFormat = "plainText" | "markdown" | "csv" | "xlsx" | "docx" | "pdf";

export class FormatError extends Error {
  readonly kind = "unsupported" as const;
  readonly ext: string;

  private constructor(ext: string) {
    super(
      ["doc", "xls", "ppt"].includes(ext)
        ? `I file .${ext} del vecchio Office non si leggono: aprili e salvali come .${ext}x, poi riprova.`
        : `I file .${ext} non si leggono: l'app gestisce testo, Markdown, CSV, Excel, Word e PDF.`,
    );
    this.name = "FormatError";
    this.ext = ext;
  }

  static unsupported(ext: string): FormatError {
    return new FormatError(ext);
  }
}

export const DocumentFormat = {
  allCases: ["plainText", "markdown", "csv", "xlsx", "docx", "pdf"] as readonly DocumentFormat[],

  /** Il formato di un percorso, dall'estensione. */
  of(path: string): DocumentFormat | null {
    return DocumentFormat.ofExtension(pathExtension(path));
  },

  ofExtension(ext: string): DocumentFormat | null {
    switch (ext.toLowerCase()) {
      case "txt":
      case "text":
        return "plainText";
      case "md":
      case "markdown":
      case "mdown":
      case "mkd":
        return "markdown";
      case "csv":
      case "tsv":
        return "csv";
      case "xlsx":
      case "xlsm":
        return "xlsx";
      case "docx":
      case "docm":
        return "docx";
      case "pdf":
        return "pdf";
      default:
        return null;
    }
  },

  /** Le estensioni che l'app apre. */
  extensions: ["txt", "text", "md", "markdown", "mdown", "mkd", "csv", "tsv", "xlsx", "xlsm", "docx", "docm", "pdf"] as readonly string[],

  title(format: DocumentFormat): string {
    switch (format) {
      case "plainText":
        return "Testo";
      case "markdown":
        return "Markdown";
      case "csv":
        return "CSV";
      case "xlsx":
        return "Excel";
      case "docx":
        return "Word";
      case "pdf":
        return "PDF";
    }
  },

  /** Il nome del simbolo SF Symbols del Mac (l'interfaccia del PC lo traduce in un'icona sua). */
  symbol(format: DocumentFormat): string {
    switch (format) {
      case "plainText":
        return "doc.text";
      case "markdown":
        return "doc.richtext";
      case "csv":
      case "xlsx":
        return "tablecells";
      case "docx":
        return "doc.text.fill";
      case "pdf":
        return "doc.viewfinder";
    }
  },

  defaultExtension(format: DocumentFormat): string {
    switch (format) {
      case "plainText":
        return "txt";
      case "markdown":
        return "md";
      default:
        return format;
    }
  },

  /** Testo semplice: si legge e si scrive come testo (anche modificandolo a mano). */
  isText(format: DocumentFormat): boolean {
    return format === "plainText" || format === "markdown";
  },

  isTable(format: DocumentFormat): boolean {
    return format === "csv" || format === "xlsx";
  },

  textKind(format: DocumentFormat): TextDocumentKind {
    return format === "markdown" ? "markdown" : "plainText";
  },

  FormatError,
};

/** Esito di un'anonimizzazione o di una riconversione. */
export interface FileOutcome {
  data: Uint8Array;
  preview: DocumentPreview;
  report?: AnonymizationReport | null;
  reveal?: RevealResult | null;
  /** Pagine del PDF lette con il riconoscimento del testo. */
  recognizedPages: number;
}

/** Le opzioni di un'anonimizzazione (in Swift i parametri con il valore predefinito): quelle di `anonymize` più
 *  l'estensione del file (per i .tsv). */
export interface AnonymizeFileOptions extends AnonymizeOptions {
  fileExtension?: string;
}

/** Anonimizza un file di qualunque formato gestito; esce un file dello stesso formato (un PDF nuovo per i PDF).
 *  In Swift è `Anonymizer.anonymizeFile`. */
export async function anonymizeFile(
  anonymizer: Anonymizer,
  data: Uint8Array,
  format: DocumentFormat,
  options: AnonymizeFileOptions = {},
): Promise<FileOutcome> {
  const { fileExtension = "", ...rest } = options;
  switch (format) {
    case "plainText":
    case "markdown": {
      const document = TextDocument.decode(data, DocumentFormat.textKind(format));
      const result = await anonymizer.anonymize(document.text, rest);
      document.text = result.text;
      return { data: document.data(), preview: DocumentPreview.text(result.text), report: result.report, recognizedPages: 0 };
    }
    case "csv": {
      const table = new CSVTable(data, fileExtension);
      const { content, cells } = table.segmented();
      const { replacements, report } = await anonymizeSegmented(anonymizer, content, rest);
      table.apply(content.applying(replacements), cells);
      return { data: table.data(), preview: DocumentPreview.sheets([table.preview]), report, recognizedPages: 0 };
    }
    case "xlsx": {
      const file = new SpreadsheetFile(data);
      const { content, sources } = file.segmented();
      const { replacements, report } = await anonymizeSegmented(anonymizer, content, rest);
      const output = file.applying(replacements, content, sources, true);
      return { data: output, preview: DocumentPreview.sheets(new SpreadsheetFile(output).preview()), report, recognizedPages: 0 };
    }
    case "docx": {
      const file = new WordFile(data);
      const { content, units } = file.segmented();
      const { replacements, report } = await anonymizeSegmented(anonymizer, content, rest);
      const output = file.applying(replacements, content, units, true);
      return { data: output, preview: DocumentPreview.text(new WordFile(output).plainText), report, recognizedPages: 0 };
    }
    case "pdf": {
      const { pages, recognized } = await PDFText.pages(data);
      if (!pages.some((page) => trimWhitespace(page).length > 0)) throw PDFError.noText();
      const content = new SegmentedText();
      for (const page of pages) content.addSegment([page], "\n\n");
      const { replacements, report } = await anonymizeSegmented(anonymizer, content, rest);
      const texts = content.applying(replacements);
      return {
        data: await PDFWriter.make(texts, "Documento anonimizzato"),
        preview: DocumentPreview.text(FileReveal.join(texts)),
        report,
        recognizedPages: recognized,
      };
    }
  }
}

export abstract class FileReveal {
  /** Riconverte un file con i segnaposto (anche scritto da un'AI) nello stesso formato. */
  static async reveal(data: Uint8Array, format: DocumentFormat, vault: Vault, fileExtension = ""): Promise<FileOutcome> {
    switch (format) {
      case "plainText":
      case "markdown": {
        const document = TextDocument.decode(data, DocumentFormat.textKind(format));
        const result = Revealer.reveal(document.text, vault);
        document.text = result.text;
        return { data: document.data(), preview: DocumentPreview.text(result.text), reveal: result, recognizedPages: 0 };
      }
      case "csv": {
        const table = new CSVTable(data, fileExtension);
        const { content, cells } = table.segmented();
        const { replacements, result } = SegmentedRevealer.replacements(content, vault);
        table.apply(content.applying(replacements), cells);
        return { data: table.data(), preview: DocumentPreview.sheets([table.preview]), reveal: result, recognizedPages: 0 };
      }
      case "xlsx": {
        const file = new SpreadsheetFile(data);
        const { content, sources } = file.segmented();
        const { replacements, result } = SegmentedRevealer.replacements(content, vault);
        const output = file.applying(replacements, content, sources, false);
        return { data: output, preview: DocumentPreview.sheets(new SpreadsheetFile(output).preview()), reveal: result, recognizedPages: 0 };
      }
      case "docx": {
        const file = new WordFile(data);
        const { content, units } = file.segmented();
        const { replacements, result } = SegmentedRevealer.replacements(content, vault);
        const output = file.applying(replacements, content, units, false);
        return { data: output, preview: DocumentPreview.text(new WordFile(output).plainText), reveal: result, recognizedPages: 0 };
      }
      case "pdf": {
        const { pages, recognized } = await PDFText.pages(data);
        const content = new SegmentedText();
        for (const page of pages) content.addSegment([page], "\n\n");
        const { replacements, result } = SegmentedRevealer.replacements(content, vault);
        const texts = content.applying(replacements);
        return {
          data: await PDFWriter.make(texts, "Documento"),
          preview: DocumentPreview.text(FileReveal.join(texts)),
          reveal: result,
          recognizedPages: recognized,
        };
      }
    }
  }

  /** Come mostrare un file (senza toccarlo). */
  static async preview(data: Uint8Array, format: DocumentFormat, fileExtension = ""): Promise<DocumentPreview> {
    switch (format) {
      case "plainText":
      case "markdown":
        return DocumentPreview.text(TextDocument.decode(data, DocumentFormat.textKind(format)).text);
      case "csv":
        return DocumentPreview.sheets([new CSVTable(data, fileExtension).preview]);
      case "xlsx":
        return DocumentPreview.sheets(new SpreadsheetFile(data).preview());
      case "docx":
        return DocumentPreview.text(new WordFile(data).plainText);
      case "pdf":
        return DocumentPreview.text(FileReveal.join((await PDFText.pages(data)).pages));
    }
  }

  /** Le pagine di un PDF, separate da una riga. */
  static join(pages: readonly string[]): string {
    return pages
      .map((text, index) => (pages.length > 1 ? `— Pagina ${index + 1} —\n\n` : "") + trimWhitespace(text))
      .join("\n\n");
  }
}
