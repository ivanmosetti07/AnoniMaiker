import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PDFDocument, StandardFonts, grayscale, type PDFFont, type PDFPage } from "pdf-lib";

// MARK: - PDF: si legge il testo, si genera un PDF nuovo
//
// Un PDF non si riscrive come un file di Word: si legge il testo di ogni pagina e si genera un PDF nuovo, A4, con il
// testo anonimizzato o riconvertito, una sezione per pagina dell'originale. L'impaginazione è semplice; il contenuto è
// quello del documento. Sul Mac le pagine scansionate si leggono con l'OCR di Apple; sul PC solo se chi usa la libreria
// fornisce un riconoscitore (`PDFText.recognizer`).

export type PDFErrorKind = "unreadable" | "locked" | "noText";

export class PDFError extends Error {
  readonly kind: PDFErrorKind;

  private constructor(kind: PDFErrorKind) {
    super(PDFError.describe(kind));
    this.name = "PDFError";
    this.kind = kind;
  }

  static unreadable(): PDFError {
    return new PDFError("unreadable");
  }

  static locked(): PDFError {
    return new PDFError("locked");
  }

  static noText(): PDFError {
    return new PDFError("noText");
  }

  private static describe(kind: PDFErrorKind): string {
    switch (kind) {
      case "unreadable":
        return "Il PDF non si apre.";
      case "locked":
        return "Il PDF è protetto da password: aprilo, togli la protezione e riprova.";
      case "noText":
        return "Nel PDF non c'è testo leggibile, nemmeno con il riconoscimento del testo.";
    }
  }
}

/** Legge il testo di una pagina scansionata (indice da 0). Sul PC lo fornisce il processo principale, se c'è. */
export type PDFRecognizer = (data: Uint8Array, pageIndex: number) => Promise<string>;

/** Il pezzo di pdfjs che serve qui (la build «legacy», per Node, senza worker). */
interface PDFJSTextItem {
  str?: string;
  hasEOL?: boolean;
}

type PDFJSModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsModule: Promise<PDFJSModule> | null = null;

function pdfjs(): Promise<PDFJSModule> {
  pdfjsModule ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsModule;
}

export abstract class PDFText {
  static readonly PDFError = PDFError;

  /** Il riconoscimento del testo per le scansioni: sul Mac c'è sempre (Vision), sul PC solo se impostato. */
  static recognizer: PDFRecognizer | null = null;

  /** Il testo di ogni pagina; quelle senza testo (scansioni) si leggono con l'OCR, se c'è. `recognized`: quante. */
  static async pages(data: Uint8Array, recognize = true): Promise<{ pages: string[]; recognized: number }> {
    const { texts, scanned } = await PDFText.extract(data, recognize);
    const pages = texts;
    let recognized = 0;
    const recognizer = PDFText.recognizer;
    if (recognizer) {
      for (const index of scanned) {
        const text = await recognizer(data, index);
        if (text.length > 0) {
          pages[index] = text;
          recognized += 1;
        }
      }
    }
    return { pages, recognized };
  }

  /** Il testo delle pagine e gli indici di quelle da leggere con l'OCR. */
  private static async extract(data: Uint8Array, recognize: boolean): Promise<{ texts: string[]; scanned: number[] }> {
    const library = await pdfjs();
    // Una copia: pdfjs si prende il buffer.
    const task = library.getDocument({
      data: data.slice(),
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });
    let document: Awaited<typeof task.promise>;
    try {
      document = await task.promise;
    } catch (error) {
      await task.destroy();
      if (error instanceof Error && error.name === "PasswordException") throw PDFError.locked();
      throw PDFError.unreadable();
    }
    try {
      const texts: string[] = [];
      const scanned: number[] = [];
      for (let index = 0; index < document.numPages; index++) {
        const page = await document.getPage(index + 1);
        const content = await page.getTextContent();
        let text = "";
        for (const item of content.items as PDFJSTextItem[]) {
          if (typeof item.str !== "string") continue;
          text += item.str;
          if (item.hasEOL) text += "\n";
        }
        text = text.replace(/\n+$/, "");
        texts.push(text);
        if (recognize && text.trim().length === 0) scanned.push(index);
        page.cleanup();
      }
      return { texts, scanned };
    } finally {
      await task.destroy();
    }
  }
}

// MARK: - Scrittura

interface LaidOutLine {
  /** I pezzi della riga e dove cominciano (le tabulazioni spostano il pezzo successivo). */
  pieces: { x: number; text: string }[];
}

export abstract class PDFWriter {
  static readonly pageSize = { x: 0, y: 0, width: 595.28, height: 841.89 };
  static readonly margin = 56;
  static readonly fontSize = 10.5;
  static readonly footerSize = 8;
  /** Altezza della riga di Helvetica 10,5 su Mac (ascendente + discendente) più i 2,5 punti di interlinea. */
  static readonly lineHeight = 10.5 + 2.5;
  static readonly ascent = 0.77 * 10.5;
  /** Le tabulazioni di CoreText: ogni 28 punti. */
  static readonly tabInterval = 28;

  /** Un PDF A4 con un testo per ogni pagina dell'originale (un testo lungo continua nelle pagine successive). */
  static async make(pages: readonly string[], title = "Documento"): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    document.setTitle(title);
    document.setCreator("AnoniMaiker");
    document.setProducer("AnoniMaiker");
    const font = await PDFWriter.embedFont(document);
    const supported = new Set(font.getCharacterSet());
    const { width, height } = PDFWriter.pageSize;
    const margin = PDFWriter.margin;
    const frameWidth = width - 2 * margin;
    const frameHeight = height - 2 * margin;
    const linesPerPage = Math.max(1, Math.floor((frameHeight - PDFWriter.fontSize) / PDFWriter.lineHeight) + 1);
    let number = 0;
    for (const source of pages) {
      const text = PDFWriter.printable(source.length === 0 ? " " : source, supported);
      const lines = PDFWriter.layout(text, font, frameWidth);
      let location = 0;
      do {
        const page = document.addPage([width, height]);
        const visible = lines.slice(location, location + linesPerPage);
        visible.forEach((line, k) => {
          const y = height - margin - PDFWriter.ascent - k * PDFWriter.lineHeight;
          for (const piece of line.pieces) {
            if (piece.text.length === 0) continue;
            page.drawText(piece.text, { x: margin + piece.x, y, size: PDFWriter.fontSize, font, color: grayscale(0) });
          }
        });
        number += 1;
        PDFWriter.drawFooter(page, font, number);
        if (visible.length === 0) break;
        location += visible.length;
      } while (location < lines.length);
    }
    return document.save();
  }

  /** Liberation Sans (stesse misure di Helvetica, con le lettere di tutte le lingue europee), da pdfjs-dist; se manca, Helvetica. */
  private static async embedFont(document: PDFDocument): Promise<PDFFont> {
    try {
      const pdfjs = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
      document.registerFontkit(fontkit);
      return await document.embedFont(readFileSync(join(pdfjs, "standard_fonts", "LiberationSans-Regular.ttf")), { subset: true });
    } catch {
      return document.embedFont(StandardFonts.Helvetica);
    }
  }

  private static drawFooter(page: PDFPage, font: PDFFont, number: number): void {
    const label = String(number);
    const labelWidth = font.widthOfTextAtSize(label, PDFWriter.footerSize);
    page.drawText(label, {
      x: (PDFWriter.pageSize.width - labelWidth) / 2,
      y: PDFWriter.margin / 2,
      size: PDFWriter.footerSize,
      font,
      color: grayscale(0.45),
    });
  }

  /** Il testo che il carattere sa scrivere: le lettere che non ha perdono l'accento o diventano «?». */
  static printable(text: string, supported: ReadonlySet<number>): string {
    let output = "";
    for (const character of text.replace(/\r\n|\r|\u2028|\u2029|\u0085/g, "\n")) {
      const code = character.codePointAt(0) ?? 0;
      if (character === "\n" || character === "\t") {
        output += character;
      } else if (code < 0x20 || (code >= 0x7f && code < 0xa0)) {
        continue;
      } else if (supported.has(code)) {
        output += character;
      } else if (/\s/u.test(character)) {
        output += " ";
      } else {
        const base = (FALLBACKS[character] ?? character.normalize("NFD").replace(/\p{M}/gu, ""))
          .split("")
          .filter((c) => supported.has(c.codePointAt(0) ?? 0))
          .join("");
        output += base.length > 0 ? base : "?";
      }
    }
    return output;
  }

  /** Le righe di un testo, a capo sulle parole (o in mezzo a una parola troppo lunga), come CoreText. */
  static layout(text: string, font: PDFFont, width: number): LaidOutLine[] {
    const size = PDFWriter.fontSize;
    const measure = (s: string): number => (s.length === 0 ? 0 : font.widthOfTextAtSize(s, size));
    const lines: LaidOutLine[] = [];
    for (const paragraph of text.split("\n")) {
      let pieces: { x: number; text: string }[] = [];
      let piece = "";
      let pieceX = 0;
      let x = 0;
      const flush = (): void => {
        pieces.push({ x: pieceX, text: piece });
        piece = "";
      };
      const newLine = (): void => {
        flush();
        lines.push({ pieces });
        pieces = [];
        x = 0;
        pieceX = 0;
      };
      // Parole, spazi e tabulazioni, in ordine.
      for (const token of paragraph.match(/\t| +|[^ \t]+/g) ?? []) {
        if (token === "\t") {
          flush();
          x = (Math.floor(x / PDFWriter.tabInterval + 1e-9) + 1) * PDFWriter.tabInterval;
          if (x > width) {
            newLine();
          }
          pieceX = x;
          continue;
        }
        const tokenWidth = measure(token);
        if (token.startsWith(" ")) {
          // Gli spazi a fine riga restano appesi (non vanno a capo).
          piece += token;
          x += tokenWidth;
          continue;
        }
        if (x + tokenWidth <= width || x === 0) {
          if (tokenWidth <= width) {
            piece += token;
            x += tokenWidth;
            continue;
          }
        } else {
          piece = piece.replace(/ +$/, "");
          newLine();
          if (tokenWidth <= width) {
            piece += token;
            x += tokenWidth;
            continue;
          }
        }
        // Una parola più larga della riga: si spezza dove capita.
        for (const character of token) {
          const characterWidth = measure(character);
          if (x + characterWidth > width && x > 0) newLine();
          piece += character;
          x += characterWidth;
        }
      }
      newLine();
    }
    return lines;
  }
}

/** Sostituti per i caratteri comuni che WinAnsi non ha e che la scomposizione Unicode non risolve. */
const FALLBACKS: Readonly<Record<string, string>> = {
  Ł: "L",
  ł: "l",
  Đ: "D",
  đ: "d",
  Ø: "O",
  ø: "o",
  Ħ: "H",
  ħ: "h",
  ı: "i",
  ß: "ss",
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "―": "—",
  "′": "'",
  "″": '"',
  "−": "-",
  "→": "->",
  "←": "<-",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
};
