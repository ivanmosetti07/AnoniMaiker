import type { LucideIcon } from "lucide-react";
import {
  CircleCheck, FileScan, FileSpreadsheet, FileText, FileType, ListChecks, Mail, NotebookPen, Phone, Users,
} from "lucide-react";
import type {
  Activity, ActivityKind, Company, CompanyStatus, Contact, CRMDocument, Deal, DealStage, DocumentVersion,
} from "../../core/crm/crmModel";
import type { DocumentFormat } from "../../core/documenti/fileProcessing";
import type { Vault } from "../../core/dizionario/vault";
import type { DocumentPreview } from "../../core/documenti/segmentedText";

// MARK: - Aiuti dei tipi del CRM per l'interfaccia
//
// Copie di poche righe delle funzioni di `src/core/crm/crmModel.ts`, `src/core/documenti/fileProcessing.ts` e
// `src/core/motore/validators.ts`: quei moduli caricano Node (`node:crypto`), che il renderer non ha.

export function newID(): string {
  return globalThis.crypto.randomUUID().toUpperCase();
}

/// `trimmingCharacters(in: .whitespaces)`.
export function trimSpaces(text: string): string {
  return text.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, "");
}

/// `trimmingCharacters(in: .whitespacesAndNewlines)`.
export function trimWhitespace(text: string): string {
  return text.replace(/^[\p{Zs}\t\n\r\v\f\u0085\u2028\u2029]+|[\p{Zs}\t\n\r\v\f\u0085\u2028\u2029]+$/gu, "");
}

const collator = new Intl.Collator("it-IT", { numeric: true, sensitivity: "base" });
export const compareNames = (a: string, b: string) => collator.compare(a, b);

// MARK: Aziende

export const CompanyStatuses: readonly CompanyStatus[] = ["prospect", "client", "former", "supplier", "partner"];

export function statusTitle(status: CompanyStatus): string {
  switch (status) {
    case "prospect": return "Potenziale";
    case "client": return "Cliente";
    case "former": return "Ex cliente";
    case "supplier": return "Fornitore";
    case "partner": return "Partner";
  }
}

/// I colori dei Badge (quelli di sistema del Mac).
export const Colors = {
  blue: "#1f6feb",
  green: "#2f9e44",
  gray: "#8e8e93",
  orange: "#e8820c",
  purple: "#8250df",
  indigo: "#5856d6",
  red: "#e5383b",
};

export function statusColor(status: CompanyStatus): string {
  switch (status) {
    case "prospect": return Colors.blue;
    case "client": return Colors.green;
    case "former": return Colors.gray;
    case "supplier": return Colors.orange;
    case "partner": return Colors.purple;
  }
}

export function newCompany(): Company {
  const now = new Date();
  return {
    id: newID(), name: "", status: "prospect", sector: "", vatNumber: "", taxCode: "", iban: "", email: "", pec: "", phone: "",
    website: "", street: "", zipCode: "", city: "", province: "", notes: "", created: now, updated: now,
  };
}

/// «via Garibaldi 24, 20121 Milano (MI)» (`Company.address`).
export function companyAddress(company: Company): string {
  const place = [company.zipCode, company.city].filter((part) => part.length > 0).join(" ") + (company.province ? ` (${company.province})` : "");
  return [company.street, trimSpaces(place)].filter((part) => part.length > 0).join(", ");
}

// MARK: Persone

export function newContact(companyID: string | null = null): Contact {
  const now = new Date();
  return {
    id: newID(), firstName: "", lastName: "", role: "", email: "", phone: "", mobile: "", taxCode: "", notes: "", companyID,
    created: now, updated: now,
  };
}

/// «Mario Rossi» (`Contact.fullName`).
export function fullName(contact: Contact): string {
  return [contact.firstName, contact.lastName].map(trimSpaces).filter((part) => part.length > 0).join(" ");
}

// MARK: Trattative

export const DealStages: readonly DealStage[] = ["new", "qualified", "proposal", "negotiation", "won", "lost"];

export function stageTitle(stage: DealStage): string {
  switch (stage) {
    case "new": return "Nuova";
    case "qualified": return "Qualificata";
    case "proposal": return "Preventivo inviato";
    case "negotiation": return "In trattativa";
    case "won": return "Vinta";
    case "lost": return "Persa";
  }
}

export function defaultProbability(stage: DealStage): number {
  switch (stage) {
    case "new": return 10;
    case "qualified": return 25;
    case "proposal": return 50;
    case "negotiation": return 75;
    case "won": return 100;
    case "lost": return 0;
  }
}

export function isOpen(stage: DealStage): boolean {
  return stage !== "won" && stage !== "lost";
}

export function stageColor(stage: DealStage): string {
  switch (stage) {
    case "new": return Colors.gray;
    case "qualified": return Colors.blue;
    case "proposal": return Colors.indigo;
    case "negotiation": return Colors.orange;
    case "won": return Colors.green;
    case "lost": return Colors.red;
  }
}

export function newDeal(companyID: string | null = null): Deal {
  const now = new Date();
  return {
    id: newID(), title: "", companyID, contactID: null, stage: "new", amount: null, probability: defaultProbability("new"),
    expectedClose: null, notes: "", created: now, updated: now,
  };
}

/// Importo pesato con la probabilità.
export function weightedAmount(deal: Deal): number | null {
  return deal.amount === null ? null : (deal.amount * deal.probability) / 100;
}

/// Somma degli importi presenti, o null se nessuno ce l'ha.
export function sum(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

// MARK: Attività

export const ActivityKinds: readonly ActivityKind[] = ["note", "call", "email", "meeting", "task"];

export function kindTitle(kind: ActivityKind): string {
  switch (kind) {
    case "note": return "Nota";
    case "call": return "Chiamata";
    case "email": return "Email";
    case "meeting": return "Riunione";
    case "task": return "Da fare";
  }
}

/// L'icona di `ActivityKind.symbol`.
export function kindIcon(kind: ActivityKind): LucideIcon {
  switch (kind) {
    case "note": return NotebookPen;
    case "call": return Phone;
    case "email": return Mail;
    case "meeting": return Users;
    case "task": return ListChecks;
  }
}

export function newActivity(kind: ActivityKind = "note", text = "", companyID: string | null = null): Activity {
  const now = new Date();
  return { id: newID(), kind, text, date: now, due: null, isDone: false, companyID, contactID: null, dealID: null, created: now, updated: now };
}

/// Una cosa da fare non fatta, scaduta prima di oggi.
export function isOverdue(activity: Activity, now: Date = new Date()): boolean {
  if (activity.kind !== "task" || activity.isDone || activity.due === null) return false;
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return activity.due.getTime() < startOfDay.getTime();
}

/// Fra `days` giorni (o mesi), alla stessa ora.
export function addingDays(days: number, from: Date = new Date()): Date {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  return date;
}

export function addingMonths(months: number, from: Date = new Date()): Date {
  const date = new Date(from);
  date.setMonth(date.getMonth() + months);
  return date;
}

// MARK: Documenti

export function originalOf(document: CRMDocument): DocumentVersion | null {
  return document.versions.find((version) => version.kind === "original") ?? null;
}

export function anonymizedOf(document: CRMDocument): DocumentVersion | null {
  return document.versions.findLast((version) => version.kind === "anonymized") ?? null;
}

export function answersOf(document: CRMDocument): DocumentVersion[] {
  return document.versions.filter((version) => version.kind === "aiAnswer");
}

export function formatTitle(format: DocumentFormat): string {
  switch (format) {
    case "plainText": return "Testo";
    case "markdown": return "Markdown";
    case "csv": return "CSV";
    case "xlsx": return "Excel";
    case "docx": return "Word";
    case "pdf": return "PDF";
  }
}

/// L'icona di `DocumentFormat.symbol`.
export function formatIcon(format: DocumentFormat): LucideIcon {
  switch (format) {
    case "plainText": return FileText;
    case "markdown": return FileType;
    case "csv":
    case "xlsx": return FileSpreadsheet;
    case "docx": return FileText;
    case "pdf": return FileScan;
  }
}

export const DoneIcon = CircleCheck;

// MARK: Dizionario

/// Le voci del dizionario di un cliente (`vault.entries(of:)`).
export function vaultEntriesCount(vault: Vault, companyID: string): number {
  const id = companyID.toUpperCase();
  return vault.entries.filter((entry) => entry.clients.has(id)).length;
}

// MARK: Validators (da src/core/motore/validators.ts e piiDetectors.ts, per i soli caratteri ASCII)

function digitsOf(value: string): number[] {
  return Array.from(value).filter((c) => /^[0-9]$/.test(c)).map(Number);
}

function pivaOK(value: string): boolean {
  const digits = digitsOf(value);
  if (digits.length !== 11) return false;
  let total = 0;
  for (let index = 0; index < 10; index++) {
    const digit = digits[index];
    if (index % 2 === 0) {
      total += digit;
    } else {
      const doubled = digit * 2;
      total += doubled > 9 ? doubled - 9 : doubled;
    }
  }
  return (10 - (total % 10)) % 10 === digits[10];
}

const cfOdd: Record<string, number> = {
  0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9,
  F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12,
  T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

function cfOK(value: string): boolean {
  const c = Array.from(value.trim().toUpperCase());
  if (c.length !== 16 || !c.every((ch) => /^[A-Z0-9]$/.test(ch))) return false;
  let total = 0;
  for (let index = 0; index < 15; index++) {
    const character = c[index];
    if (index % 2 === 0) total += cfOdd[character];
    else if (/^[0-9]$/.test(character)) total += Number(character);
    else total += character.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (total % 26)) === c[15];
}

function ibanOK(value: string): boolean {
  const s = Array.from(value.replace(/[\s.\-]/g, "").toUpperCase());
  if (s.length < 15 || s.length > 34) return false;
  const rotated = [...s.slice(4), ...s.slice(0, 4)];
  let remainder = 0;
  for (const character of rotated) {
    if (/^[A-Z]$/.test(character)) {
      for (const digit of String(character.charCodeAt(0) - 55)) remainder = (remainder * 10 + Number(digit)) % 97;
    } else if (/^[0-9]$/.test(character)) {
      remainder = (remainder * 10 + Number(character)) % 97;
    } else {
      return false;
    }
  }
  return remainder === 1;
}

export const Validators = {
  isValidVATNumber: pivaOK,
  /// Codice fiscale di una persona (16 caratteri) o di una società (11 cifre, come la partita IVA).
  isValidTaxCode(value: string): boolean {
    const compact = value.replace(/\s/g, "");
    return Array.from(compact).length === 11 ? pivaOK(compact) : cfOK(compact);
  },
  isValidIBAN: ibanOK,
  isValidEmail(value: string): boolean {
    return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(value);
  },
};

// MARK: Date nei campi

/// «2026-11-12» per `<input type="date">` (ora locale).
export function dateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/// «2026-11-12T14:05» per `<input type="datetime-local">`.
export function dateTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dateInputValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/// Il giorno scelto, tenendo l'ora di prima.
export function parseDateInput(value: string, keeping: Date): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(keeping);
  date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date;
}

export function parseDateTimeInput(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// MARK: Anteprime (da DocumentPreview.plainText in src/core/documenti/segmentedText.ts)

export function previewPlainText(preview: DocumentPreview): string {
  switch (preview.kind) {
    case "text":
      return preview.text;
    case "sheets": {
      const sheets = preview.sheets;
      return sheets
        .map((sheet) => (sheets.length > 1 ? `# ${sheet.name}\n` : "") + sheet.rows.map((row) => row.join("\t")).join("\n"))
        .join("\n\n");
    }
  }
}
