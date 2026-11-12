import type { DocumentFormat } from "../documenti/fileProcessing";

// I valori grezzi di `DocumentFormat` per leggere il JSON del CRM, senza caricare tutti i formati dei documenti (il
// tipo viene da `documenti`).

export type { DocumentFormat };

export const documentFormatCases = ["plainText", "markdown", "csv", "xlsx", "docx", "pdf"] as const satisfies readonly DocumentFormat[];
