import { newUUID } from "../sicurezza/swiftCoding";
import {
  container,
  decodeArray,
  decodeBool,
  decodeDate,
  decodeDecimal,
  decodeEnum,
  decodeInt,
  decodeString,
  decodeUUID,
  encodeDate,
  type JSONObject,
  required,
  value,
} from "./codable";
import { documentFormatCases, type DocumentFormat } from "./documentFormat";

// MARK: - Il CRM dentro l'app
//
// Aziende (i clienti), contatti, trattative, note e attività, documenti. I dati veri restano sul PC, cifrati nella
// stessa cartella del dizionario. Ogni tipo si legge in modo tollerante: un campo che manca (scritto da una versione
// più vecchia dell'app) prende il suo valore di partenza, così le versioni future possono aggiungere campi.
//
// Il JSON è quello del Mac (`JSONEncoder` di serie): date in secondi dal 2001, UUID in maiuscolo, campi facoltativi
// assenti quando mancano. In TypeScript i facoltativi sono `null`; gli importi (`Decimal`) sono `number`.

export type CompanyStatus = "prospect" | "client" | "former" | "supplier" | "partner";

export const CompanyStatus = {
  allCases: ["prospect", "client", "former", "supplier", "partner"] as const satisfies readonly CompanyStatus[],
  title(status: CompanyStatus): string {
    switch (status) {
      case "prospect":
        return "Potenziale";
      case "client":
        return "Cliente";
      case "former":
        return "Ex cliente";
      case "supplier":
        return "Fornitore";
      case "partner":
        return "Partner";
    }
  },
};

/// Un'azienda: il cliente del CRM.
export interface Company {
  id: string;
  name: string;
  status: CompanyStatus;
  sector: string;
  vatNumber: string;
  taxCode: string;
  iban: string;
  email: string;
  pec: string;
  phone: string;
  website: string;
  /// Via e numero civico.
  street: string;
  zipCode: string;
  city: string;
  province: string;
  notes: string;
  created: Date;
  updated: Date;
}

const companyStrings = [
  "name",
  "sector",
  "vatNumber",
  "taxCode",
  "iban",
  "email",
  "pec",
  "phone",
  "website",
  "street",
  "zipCode",
  "city",
  "province",
  "notes",
] as const;

export const Company = {
  create(name = "", status: CompanyStatus = "prospect"): Company {
    const now = new Date();
    return {
      id: newUUID(),
      name,
      status,
      sector: "",
      vatNumber: "",
      taxCode: "",
      iban: "",
      email: "",
      pec: "",
      phone: "",
      website: "",
      street: "",
      zipCode: "",
      city: "",
      province: "",
      notes: "",
      created: now,
      updated: now,
    };
  },

  decode(json: unknown): Company {
    const c = container(json);
    const company = Company.create();
    company.id = required(c, "id", decodeUUID);
    for (const key of companyStrings) company[key] = value(c, key, decodeString, "");
    company.status = value(c, "status", decodeEnum(CompanyStatus.allCases), "prospect");
    company.created = value(c, "created", decodeDate, new Date());
    company.updated = value(c, "updated", decodeDate, new Date());
    return company;
  },

  encode(company: Company): JSONObject {
    return {
      id: company.id,
      name: company.name,
      status: company.status,
      sector: company.sector,
      vatNumber: company.vatNumber,
      taxCode: company.taxCode,
      iban: company.iban,
      email: company.email,
      pec: company.pec,
      phone: company.phone,
      website: company.website,
      street: company.street,
      zipCode: company.zipCode,
      city: company.city,
      province: company.province,
      notes: company.notes,
      created: encodeDate(company.created),
      updated: encodeDate(company.updated),
    };
  },

  /// «via Garibaldi 24, 20121 Milano (MI)».
  address(company: Company): string {
    const place =
      [company.zipCode, company.city].filter((part) => part.length > 0).join(" ") + (company.province ? ` (${company.province})` : "");
    return [company.street, trimSpaces(place)].filter((part) => part.length > 0).join(", ");
  },
};

/// Una persona, di solito di un'azienda cliente.
export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string;
  phone: string;
  mobile: string;
  taxCode: string;
  notes: string;
  companyID: string | null;
  created: Date;
  updated: Date;
}

const contactStrings = ["firstName", "lastName", "role", "email", "phone", "mobile", "taxCode", "notes"] as const;

export const Contact = {
  create(firstName = "", lastName = "", companyID: string | null = null): Contact {
    const now = new Date();
    return {
      id: newUUID(),
      firstName,
      lastName,
      role: "",
      email: "",
      phone: "",
      mobile: "",
      taxCode: "",
      notes: "",
      companyID,
      created: now,
      updated: now,
    };
  },

  decode(json: unknown): Contact {
    const c = container(json);
    const contact = Contact.create();
    contact.id = required(c, "id", decodeUUID);
    for (const key of contactStrings) contact[key] = value(c, key, decodeString, "");
    contact.companyID = value<string | null>(c, "companyID", decodeUUID, null);
    contact.created = value(c, "created", decodeDate, new Date());
    contact.updated = value(c, "updated", decodeDate, new Date());
    return contact;
  },

  encode(contact: Contact): JSONObject {
    const json: JSONObject = {
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      role: contact.role,
      email: contact.email,
      phone: contact.phone,
      mobile: contact.mobile,
      taxCode: contact.taxCode,
      notes: contact.notes,
    };
    if (contact.companyID !== null) json.companyID = contact.companyID;
    json.created = encodeDate(contact.created);
    json.updated = encodeDate(contact.updated);
    return json;
  },

  /// «Mario Rossi».
  fullName(contact: Contact): string {
    return [contact.firstName, contact.lastName]
      .map(trimSpaces)
      .filter((part) => part.length > 0)
      .join(" ");
  },
};

export type DealStage = "new" | "qualified" | "proposal" | "negotiation" | "won" | "lost";

export const DealStage = {
  allCases: ["new", "qualified", "proposal", "negotiation", "won", "lost"] as const satisfies readonly DealStage[],
  title(stage: DealStage): string {
    switch (stage) {
      case "new":
        return "Nuova";
      case "qualified":
        return "Qualificata";
      case "proposal":
        return "Preventivo inviato";
      case "negotiation":
        return "In trattativa";
      case "won":
        return "Vinta";
      case "lost":
        return "Persa";
    }
  },
  /// Probabilità proposta quando si sceglie la fase.
  defaultProbability(stage: DealStage): number {
    switch (stage) {
      case "new":
        return 10;
      case "qualified":
        return 25;
      case "proposal":
        return 50;
      case "negotiation":
        return 75;
      case "won":
        return 100;
      case "lost":
        return 0;
    }
  },
  isOpen(stage: DealStage): boolean {
    return stage !== "won" && stage !== "lost";
  },
};

/// Una trattativa o un preventivo.
export interface Deal {
  id: string;
  title: string;
  /// L'azienda della trattativa (in un progetto può anche non esserci).
  companyID: string | null;
  contactID: string | null;
  stage: DealStage;
  /// `Decimal` sul Mac.
  amount: number | null;
  probability: number;
  expectedClose: Date | null;
  notes: string;
  created: Date;
  updated: Date;
}

export const Deal = {
  create(title = "", companyID: string | null = null): Deal {
    const now = new Date();
    return {
      id: newUUID(),
      title,
      companyID,
      contactID: null,
      stage: "new",
      amount: null,
      probability: DealStage.defaultProbability("new"),
      expectedClose: null,
      notes: "",
      created: now,
      updated: now,
    };
  },

  decode(json: unknown): Deal {
    const c = container(json);
    const deal = Deal.create();
    deal.id = required(c, "id", decodeUUID);
    deal.companyID = value<string | null>(c, "companyID", decodeUUID, null);
    deal.title = value(c, "title", decodeString, "");
    deal.contactID = value<string | null>(c, "contactID", decodeUUID, null);
    deal.stage = value(c, "stage", decodeEnum(DealStage.allCases), "new");
    deal.amount = value<number | null>(c, "amount", decodeDecimal, null);
    deal.probability = value(c, "probability", decodeInt, DealStage.defaultProbability(deal.stage));
    deal.expectedClose = value<Date | null>(c, "expectedClose", decodeDate, null);
    deal.notes = value(c, "notes", decodeString, "");
    deal.created = value(c, "created", decodeDate, new Date());
    deal.updated = value(c, "updated", decodeDate, new Date());
    return deal;
  },

  encode(deal: Deal): JSONObject {
    const json: JSONObject = { id: deal.id, title: deal.title };
    if (deal.companyID !== null) json.companyID = deal.companyID;
    if (deal.contactID !== null) json.contactID = deal.contactID;
    json.stage = deal.stage;
    if (deal.amount !== null) json.amount = deal.amount;
    json.probability = deal.probability;
    if (deal.expectedClose !== null) json.expectedClose = encodeDate(deal.expectedClose);
    json.notes = deal.notes;
    json.created = encodeDate(deal.created);
    json.updated = encodeDate(deal.updated);
    return json;
  },

  /// Importo pesato con la probabilità.
  weightedAmount(deal: Deal): number | null {
    return deal.amount === null ? null : (deal.amount * deal.probability) / 100;
  },
};

export type ActivityKind = "note" | "call" | "email" | "meeting" | "task";

export const ActivityKind = {
  allCases: ["note", "call", "email", "meeting", "task"] as const satisfies readonly ActivityKind[],
  title(kind: ActivityKind): string {
    switch (kind) {
      case "note":
        return "Nota";
      case "call":
        return "Chiamata";
      case "email":
        return "Email";
      case "meeting":
        return "Riunione";
      case "task":
        return "Da fare";
    }
  },
  /// Il nome del simbolo SF Symbols sul Mac (l'interfaccia di Windows lo traduce nella sua icona).
  symbol(kind: ActivityKind): string {
    switch (kind) {
      case "note":
        return "note.text";
      case "call":
        return "phone";
      case "email":
        return "envelope";
      case "meeting":
        return "person.2";
      case "task":
        return "checklist";
    }
  },
};

/// Una nota o un'attività (chiamata, email, riunione, cosa da fare).
export interface Activity {
  id: string;
  kind: ActivityKind;
  text: string;
  date: Date;
  /// Solo per le cose da fare.
  due: Date | null;
  isDone: boolean;
  companyID: string | null;
  contactID: string | null;
  dealID: string | null;
  created: Date;
  updated: Date;
}

export const Activity = {
  create(kind: ActivityKind = "note", text = "", companyID: string | null = null): Activity {
    const now = new Date();
    return {
      id: newUUID(),
      kind,
      text,
      date: now,
      due: null,
      isDone: false,
      companyID,
      contactID: null,
      dealID: null,
      created: now,
      updated: now,
    };
  },

  decode(json: unknown): Activity {
    const c = container(json);
    const activity = Activity.create();
    activity.id = required(c, "id", decodeUUID);
    activity.kind = value(c, "kind", decodeEnum(ActivityKind.allCases), "note");
    activity.text = value(c, "text", decodeString, "");
    activity.date = value(c, "date", decodeDate, new Date());
    activity.due = value<Date | null>(c, "due", decodeDate, null);
    activity.isDone = value(c, "isDone", decodeBool, false);
    activity.companyID = value<string | null>(c, "companyID", decodeUUID, null);
    activity.contactID = value<string | null>(c, "contactID", decodeUUID, null);
    activity.dealID = value<string | null>(c, "dealID", decodeUUID, null);
    activity.created = value(c, "created", decodeDate, new Date());
    activity.updated = value(c, "updated", decodeDate, new Date());
    return activity;
  },

  encode(activity: Activity): JSONObject {
    const json: JSONObject = { id: activity.id, kind: activity.kind, text: activity.text, date: encodeDate(activity.date) };
    if (activity.due !== null) json.due = encodeDate(activity.due);
    json.isDone = activity.isDone;
    if (activity.companyID !== null) json.companyID = activity.companyID;
    if (activity.contactID !== null) json.contactID = activity.contactID;
    if (activity.dealID !== null) json.dealID = activity.dealID;
    json.created = encodeDate(activity.created);
    json.updated = encodeDate(activity.updated);
    return json;
  },

  /// Una cosa da fare non fatta, scaduta prima di oggi (l'ora del PC).
  isOverdue(activity: Activity, now: Date = new Date()): boolean {
    if (activity.kind !== "task" || activity.isDone || activity.due === null) return false;
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return activity.due.getTime() < startOfDay.getTime();
  },
};

export type DocumentVersionKind = "original" | "anonymized" | "aiAnswer";

/// Una versione di un documento: l'originale, quella anonimizzata, le risposte dell'AI (con i segnaposto). Il file di
/// ogni versione si conserva intero, cifrato (`documenti/<id>`).
export interface DocumentVersion {
  /// Anche il nome del file cifrato che la contiene (`documenti/<id>`).
  id: string;
  kind: DocumentVersionKind;
  created: Date;
  /// Il file da cui viene (originale e risposte importate).
  fileName: string;
  /// Il formato, se è diverso da quello del documento (una risposta dell'AI incollata come testo).
  format: DocumentFormat | null;
  /// «Nascosti: 3 nomi, 1 IBAN».
  summary: string;
}

const versionKinds = ["original", "anonymized", "aiAnswer"] as const satisfies readonly DocumentVersionKind[];

export const DocumentVersion = {
  create(kind: DocumentVersionKind, fileName = "", format: DocumentFormat | null = null, summary = ""): DocumentVersion {
    return { id: newUUID(), kind, created: new Date(), fileName, format, summary };
  },

  decode(json: unknown): DocumentVersion {
    const c = container(json);
    return {
      id: required(c, "id", decodeUUID),
      kind: required(c, "kind", decodeEnum(versionKinds)),
      created: value(c, "created", decodeDate, new Date()),
      fileName: value(c, "fileName", decodeString, ""),
      format: value<DocumentFormat | null>(c, "format", decodeEnum(documentFormatCases), null),
      summary: value(c, "summary", decodeString, ""),
    };
  },

  encode(version: DocumentVersion): JSONObject {
    const json: JSONObject = { id: version.id, kind: version.kind, created: encodeDate(version.created), fileName: version.fileName };
    if (version.format !== null) json.format = version.format;
    json.summary = version.summary;
    return json;
  },

  blobName(version: DocumentVersion): string {
    return `documenti/${version.id}`;
  },
};

/// Un documento del cliente, con le sue versioni.
export interface CRMDocument {
  id: string;
  title: string;
  format: DocumentFormat;
  companyID: string | null;
  versions: DocumentVersion[];
  created: Date;
  updated: Date;
}

export const CRMDocument = {
  create(title: string, format: DocumentFormat, companyID: string | null): CRMDocument {
    const now = new Date();
    return { id: newUUID(), title, format, companyID, versions: [], created: now, updated: now };
  },

  decode(json: unknown): CRMDocument {
    const c = container(json);
    const id = required(c, "id", decodeUUID);
    // Fino alla versione 0.2 c'erano solo testo e Markdown («kind»).
    const legacy = value(c, "kind", decodeEnum(["plainText", "markdown"] as const), "plainText");
    return {
      id,
      title: value(c, "title", decodeString, ""),
      format: value<DocumentFormat>(c, "format", decodeEnum(documentFormatCases), legacy === "markdown" ? "markdown" : "plainText"),
      companyID: value<string | null>(c, "companyID", decodeUUID, null),
      versions: value(c, "versions", decodeArray(DocumentVersion.decode), []),
      created: value(c, "created", decodeDate, new Date()),
      updated: value(c, "updated", decodeDate, new Date()),
    };
  },

  encode(document: CRMDocument): JSONObject {
    const json: JSONObject = { id: document.id, title: document.title, format: document.format };
    if (document.companyID !== null) json.companyID = document.companyID;
    json.versions = document.versions.map(DocumentVersion.encode);
    json.created = encodeDate(document.created);
    json.updated = encodeDate(document.updated);
    return json;
  },

  original(document: CRMDocument): DocumentVersion | null {
    return document.versions.find((version) => version.kind === "original") ?? null;
  },
  anonymized(document: CRMDocument): DocumentVersion | null {
    return document.versions.findLast((version) => version.kind === "anonymized") ?? null;
  },
  answers(document: CRMDocument): DocumentVersion[] {
    return document.versions.filter((version) => version.kind === "aiAnswer");
  },

  /// Il formato di una versione.
  formatOf(document: CRMDocument, version: DocumentVersion): DocumentFormat {
    return version.format ?? document.format;
  },
};

/// `trimmingCharacters(in: .whitespaces)`: spazi e tabulazioni, non gli a capo.
export function trimSpaces(text: string): string {
  return text.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, "");
}

/// `trimmingCharacters(in: .whitespacesAndNewlines)`.
export function trimWhitespace(text: string): string {
  return text.replace(/^[\p{Zs}\t\n\r\v\f\u0085\u2028\u2029]+|[\p{Zs}\t\n\r\v\f\u0085\u2028\u2029]+$/gu, "");
}
