// Documenti: i formati dei file (testo, CSV, Excel, Word, PDF).

// Pubblici in Swift.
export { DocumentError, DocumentNaming, TextDocument, type TextDocumentKind, type TextEncoding } from "./textDocument";
export { DocumentPreview, type PreviewSheet } from "./segmentedText";
export {
  DocumentFormat, FileReveal, FormatError, anonymizeFile, type AnonymizeFileOptions, type FileOutcome,
} from "./fileProcessing";

// Interni al modulo in Swift, ma usati dalle altre cartelle (anonimizzazione) e dalle prove.
export { ColumnHints, SegmentedRevealer, SegmentedText, trimWhitespace, type SegmentReplacements } from "./segmentedText";
export { CSVTable, type CSVField } from "./csvDocument";
export { SpreadsheetFile, type SpreadsheetCell, type SpreadsheetCellKind, type SpreadsheetSource } from "./spreadsheetDocument";
export { WordFile, type WordUnit } from "./wordDocument";
export { PDFError, PDFText, PDFWriter, type PDFRecognizer } from "./pdfFiles";
export { OfficeMetadata, OfficePaths, localName, type AttributeNode, type OfficeRelationship, type TextNode } from "./officeParts";
export { XMLBytes, XMLEdits, intRange, type IntRange, type XMLAttribute, type XMLTag } from "./xmlText";
export { ZipArchive, ZipEntry, ZipError, entryNamed, replaceEntry, type ZipErrorKind } from "./zip";
