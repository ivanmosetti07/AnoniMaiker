// MARK: - Aiuti ricopiati dalla libreria
//
// Il renderer non ha Node: queste poche funzioni vengono da moduli di `src/core` che (direttamente o no) lo importano,
// e sono ricopiate qui così come sono. Se cambiano là, vanno cambiate anche qui.

import type { Activity, DealStage } from "../core/crm/crmModel";
import type { KeyProtectionKind } from "../core/sicurezza/keyCustody";
import type { LucideIcon } from "lucide-react";
import { BookA, Building2, CircleEuro, EyeOff, Files, ListChecks, Undo2, Users } from "lucide-react";
import type { AppSection } from "../shared/navigation";

/// Da `core/motore/piiCategory.ts`: i nomi delle categorie e i gruppi delle Impostazioni.
export const PIICategory = {
  names: {
    FULLNAME: "nomi", AGE: "età", GENDER: "generi", DATE: "date", TIME: "orari", STREET: "indirizzi", BUILDINGNUM: "numeri civici",
    ZIPCODE: "CAP", CITY: "città", PROVINCE: "province", EMAIL: "email", TELEPHONENUM: "telefoni", CF: "codici fiscali",
    PIVA: "partite IVA", ID_DOC: "documenti d'identità", IBAN: "IBAN", CREDITCARDNUMBER: "carte", AMOUNT: "importi", TARGA: "targhe",
    ORG: "aziende", OTHER: "altri dati", DOCID: "codici di atti", CATASTO: "dati catastali", URL: "indirizzi web", IPADDR: "indirizzi IP",
  } as Readonly<Record<string, string>>,

  singularNames: {
    FULLNAME: "nome", GENDER: "genere", DATE: "data", TIME: "orario", STREET: "indirizzo", BUILDINGNUM: "numero civico",
    PROVINCE: "provincia", TELEPHONENUM: "telefono", CF: "codice fiscale", PIVA: "partita IVA", ID_DOC: "documento d'identità",
    CREDITCARDNUMBER: "carta", AMOUNT: "importo", TARGA: "targa", ORG: "azienda", OTHER: "altro dato", DOCID: "codice di atto",
    CATASTO: "dato catastale", URL: "indirizzo web", IPADDR: "indirizzo IP",
  } as Readonly<Record<string, string>>,

  name(label: string, count = 2): string {
    if (count === 1 && Object.hasOwn(PIICategory.singularNames, label)) return PIICategory.singularNames[label];
    return Object.hasOwn(PIICategory.names, label) ? PIICategory.names[label] : label.toLowerCase();
  },

  /// «Codici fiscali».
  title(label: string): string {
    return capitalizedFirst(PIICategory.name(label));
  },

  personal: ["FULLNAME", "EMAIL", "TELEPHONENUM", "CF", "PIVA", "ID_DOC", "IBAN", "CREDITCARDNUMBER",
    "STREET", "BUILDINGNUM", "TARGA", "CATASTO", "DOCID", "IPADDR"] as readonly string[],
  companies: ["ORG"] as readonly string[],
  workingData: ["AMOUNT", "DATE", "TIME", "AGE", "GENDER", "CITY", "PROVINCE", "ZIPCODE", "URL"] as readonly string[],

  get defaultHidden(): Set<string> {
    return new Set([...PIICategory.personal, ...PIICategory.companies]);
  },
};

/// «codice fiscale» → «Codice fiscale» (da DictionaryView.swift).
export function capitalizedFirst(text: string): string {
  const chars = Array.from(text);
  return chars.length === 0 ? "" : chars[0].toUpperCase() + chars.slice(1).join("");
}

/// Da `ForcedTerm` in `core/anonimizzazione/anonymizer.ts`.
export const ForcedTermInfo = {
  labels: ["ORG", "FULLNAME", "OTHER"] as const,

  title(label: string): string {
    switch (label) {
      case "ORG": return "Azienda o attività";
      case "FULLNAME": return "Persona";
      default: return "Altro dato";
    }
  },

  /// L'identificativo: `Vault.normalized` (spazi compattati, maiuscole e minuscole uguali).
  id(value: string): string {
    return value.trim().replace(/[\t\n\f\r\p{Z}]+/gu, " ").toLowerCase();
  },
};

/// Da `core/sicurezza/keyCustody.ts`.
export function describeProtection(kind: KeyProtectionKind): string {
  switch (kind) {
    case "secureEnclave": return "Secure Enclave di questo Mac";
    case "file": return "file protetto dai permessi del tuo utente";
    case "windowsDPAPI": return "protezione dati di Windows (DPAPI) per il tuo utente";
  }
}

/// Da `DealStage.isOpen` in `core/crm/crmModel.ts`.
export function isOpenStage(stage: DealStage): boolean {
  return stage !== "won" && stage !== "lost";
}

/// Da `Activity.isOverdue` in `core/crm/crmModel.ts`: una cosa da fare non fatta, scaduta prima di oggi.
export function isOverdue(activity: Activity, now: Date = new Date()): boolean {
  if (activity.kind !== "task" || activity.isDone || activity.due === null) return false;
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return activity.due.getTime() < startOfDay.getTime();
}

/// Da `CodexClient.effortTitle` in `core/chat/codexClient.ts`.
export function effortTitle(effort: string): string {
  switch (effort) {
    case "minimal": return "Minimo";
    case "low": return "Veloce";
    case "medium": return "Normale";
    case "high": return "Accurato";
    case "xhigh": return "Molto accurato";
    case "max": return "Massimo";
    case "ultra": return "Ultra";
    default: return effort;
  }
}

/// Da `BackupSummary.description` in `core/sicurezza/backup.ts`: «120 voci nel dizionario, 12 aziende…».
export function describeSummary(summary: {
  projects?: number; dictionaryEntries: number; companies: number; contacts: number; deals: number; activities: number; documents: number;
}): string {
  const part = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const head = summary.projects !== undefined ? [part(summary.projects, "progetto", "progetti")] : [];
  return [
    ...head,
    part(summary.dictionaryEntries, "voce nel dizionario", "voci nel dizionario"),
    part(summary.companies, "azienda", "aziende"),
    part(summary.contacts, "persona", "persone"),
    part(summary.deals, "trattativa", "trattative"),
    part(summary.activities, "nota o attività", "note e attività"),
    part(summary.documents, "documento", "documenti"),
  ].join(", ");
}

/// Da `Backup.minimumPasswordLength` e `Backup.strength` in `core/sicurezza/backup.ts`.
export const BackupInfo = {
  minimumPasswordLength: 10,

  strength(password: string): { score: number; label: string } {
    let classes = 0;
    if (/\p{Ll}/u.test(password)) classes += 1;
    if (/[\p{Lu}\p{Lt}]/u.test(password)) classes += 1;
    if (/\p{Nd}/u.test(password)) classes += 1;
    if (/[^\p{L}\p{M}\p{N}]/u.test(password)) classes += 1;
    const length = Array.from(password).length;
    const score = length < BackupInfo.minimumPasswordLength ? 0 : Math.min(3, (length >= 16 ? 2 : 1) + (classes >= 3 ? 1 : 0));
    const label = ["Troppo corta", "Accettabile", "Buona", "Ottima"][score];
    return { score, label };
  },
};

/// Da `Updates` in `core/aggiornamenti/updates.ts`.
export const UpdateLinks = {
  projectPage: "https://github.com/ivanmosetti07/AnoniMaiker",
  issuesPage: "https://github.com/ivanmosetti07/AnoniMaiker/issues",
  releasesPage: "https://github.com/ivanmosetti07/AnoniMaiker/releases",
};

/// «Excel», «Word»… (da `DocumentFormat.title` in `core/documenti/fileProcessing.ts`).
export function formatTitle(format: string): string {
  switch (format) {
    case "plainText": return "Testo";
    case "markdown": return "Markdown";
    case "csv": return "CSV";
    case "xlsx": return "Excel";
    case "docx": return "Word";
    case "pdf": return "PDF";
    default: return format;
  }
}

/// «12,4 MB», come `ByteCountFormatter` con lo stile dei file (multipli di 1000).
export function byteCount(bytes: number): string {
  const units = ["byte", "kB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: digits })} ${units[unit]}`;
}

/// Le icone delle sezioni (i simboli del Mac di `AppSection.symbol`).
export function sectionIcon(section: AppSection): LucideIcon {
  switch (section) {
    case "anonymize": return EyeOff;
    case "reveal": return Undo2;
    case "documents": return Files;
    case "people": return Users;
    case "companies": return Building2;
    case "deals": return CircleEuro;
    case "activities": return ListChecks;
    case "dictionary": return BookA;
  }
}
