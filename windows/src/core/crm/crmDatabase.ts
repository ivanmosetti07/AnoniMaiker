import { container, decodeArray, decodeInt, DecodingError, value } from "./codable";
import { Activity, Company, Contact, CRMDocument, Deal, DocumentVersion, trimWhitespace } from "./crmModel";

// MARK: - Tutti i dati del CRM
//
// Un archivio solo, in memoria e su disco (cifrato). Le cancellazioni portano via quello che dipende dal dato:
// un'azienda si porta via i suoi contatti, trattative, attività e documenti.
//
// Sul Mac è una struttura (si copia a ogni assegnazione); qui `clone()` fa la stessa cosa. I metodi `save` del Mac, che
// Swift distingue dal tipo, qui hanno il tipo nel nome (`saveCompany`, `saveContact`…).

/// Il confronto dei nomi come `localizedStandardCompare` (senza maiuscole, coi numeri in ordine numerico).
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const farFuture = Number.POSITIVE_INFINITY;

export class CRMDatabase {
  static readonly currentVersion = 1;

  companies: Company[] = [];
  contacts: Contact[] = [];
  deals: Deal[] = [];
  activities: Activity[] = [];
  documents: CRMDocument[] = [];

  // MARK: JSON

  /// Come `init(from:)`: versione più recente → errore; elenchi che non si leggono → vuoti.
  static decode(json: unknown): CRMDatabase {
    const c = container(json);
    const version = value(c, "version", decodeInt, 1);
    if (version > CRMDatabase.currentVersion) throw new DecodingError(`CRM di una versione più recente dell'app (${version})`);
    const database = new CRMDatabase();
    database.companies = value(c, "companies", decodeArray(Company.decode), []);
    database.contacts = value(c, "contacts", decodeArray(Contact.decode), []);
    database.deals = value(c, "deals", decodeArray(Deal.decode), []);
    database.activities = value(c, "activities", decodeArray(Activity.decode), []);
    database.documents = value(c, "documents", decodeArray(CRMDocument.decode), []);
    return database;
  }

  /// Dai byte di `crm.sigillato` (JSON UTF-8).
  static fromData(data: Uint8Array): CRMDatabase {
    return CRMDatabase.decode(JSON.parse(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8")));
  }

  encode(): Record<string, unknown> {
    return {
      version: CRMDatabase.currentVersion,
      companies: this.companies.map(Company.encode),
      contacts: this.contacts.map(Contact.encode),
      deals: this.deals.map(Deal.encode),
      activities: this.activities.map(Activity.encode),
      documents: this.documents.map(CRMDocument.encode),
    };
  }

  /// I byte da cifrare (JSON UTF-8, come `JSONEncoder().encode`).
  data(): Buffer {
    return Buffer.from(JSON.stringify(this.encode()), "utf8");
  }

  /// Una copia indipendente (il valore di una struttura Swift).
  clone(): CRMDatabase {
    return CRMDatabase.decode(this.encode());
  }

  /// Gli stessi dati (`Equatable`).
  equals(other: CRMDatabase): boolean {
    return JSON.stringify(this.encode()) === JSON.stringify(other.encode());
  }

  get isEmpty(): boolean {
    return (
      this.companies.length === 0 &&
      this.contacts.length === 0 &&
      this.deals.length === 0 &&
      this.activities.length === 0 &&
      this.documents.length === 0
    );
  }

  // MARK: Lettura

  company(id: string | null | undefined): Company | null {
    return id == null ? null : (this.companies.find((item) => item.id === id) ?? null);
  }
  contact(id: string | null | undefined): Contact | null {
    return id == null ? null : (this.contacts.find((item) => item.id === id) ?? null);
  }
  deal(id: string | null | undefined): Deal | null {
    return id == null ? null : (this.deals.find((item) => item.id === id) ?? null);
  }
  document(id: string | null | undefined): CRMDocument | null {
    return id == null ? null : (this.documents.find((item) => item.id === id) ?? null);
  }

  /// Le aziende in ordine alfabetico.
  get sortedCompanies(): Company[] {
    return [...this.companies].sort((a, b) => collator.compare(a.name, b.name));
  }

  /// `contacts(of:)`.
  contactsOf(companyID: string): Contact[] {
    return this.contacts
      .filter((contact) => contact.companyID === companyID)
      .sort((a, b) => collator.compare(Contact.fullName(a), Contact.fullName(b)));
  }

  /// `deals(of:)`.
  dealsOf(companyID: string): Deal[] {
    return this.deals.filter((deal) => deal.companyID === companyID).sort((a, b) => b.updated.getTime() - a.updated.getTime());
  }

  /// Note e attività dell'azienda, dalla più recente (`activities(of:)`).
  activitiesOf(companyID: string): Activity[] {
    return this.activities.filter((activity) => activity.companyID === companyID).sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  /// `documents(of:)`.
  documentsOf(companyID: string): CRMDocument[] {
    return this.documents.filter((document) => document.companyID === companyID).sort((a, b) => b.updated.getTime() - a.updated.getTime());
  }

  /// Le cose da fare non ancora fatte, dalla scadenza più vicina (quelle senza scadenza in fondo).
  get openTasks(): Activity[] {
    return this.activities
      .filter((activity) => activity.kind === "task" && !activity.isDone)
      .sort((a, b) => (a.due?.getTime() ?? farFuture) - (b.due?.getTime() ?? farFuture) || 0);
  }

  // MARK: Modifiche

  saveCompany(company: Company, now: Date = new Date()): void {
    upsert({ ...company, updated: now }, this.companies);
  }

  saveContact(contact: Contact, now: Date = new Date()): void {
    upsert({ ...contact, updated: now }, this.contacts);
  }

  saveDeal(deal: Deal, now: Date = new Date()): void {
    upsert({ ...deal, updated: now }, this.deals);
  }

  saveActivity(activity: Activity, now: Date = new Date()): void {
    upsert({ ...activity, updated: now }, this.activities);
  }

  saveDocument(document: CRMDocument, now: Date = new Date()): void {
    upsert({ ...document, versions: document.versions.map((version) => ({ ...version })), updated: now }, this.documents);
  }

  deleteContact(id: string): void {
    this.contacts = this.contacts.filter((contact) => contact.id !== id);
    this.deals = this.deals.map((deal) => (deal.contactID === id ? { ...deal, contactID: null } : deal));
    this.activities = this.activities.map((activity) => (activity.contactID === id ? { ...activity, contactID: null } : activity));
  }

  deleteDeal(id: string): void {
    this.deals = this.deals.filter((deal) => deal.id !== id);
    this.activities = this.activities.map((activity) => (activity.dealID === id ? { ...activity, dealID: null } : activity));
  }

  deleteActivity(id: string): void {
    this.activities = this.activities.filter((activity) => activity.id !== id);
  }

  /// Toglie un documento; restituisce i file cifrati delle sue versioni, da cancellare.
  deleteDocument(id: string): string[] {
    const index = this.documents.findIndex((document) => document.id === id);
    if (index < 0) return [];
    const blobs = this.documents[index].versions.map(DocumentVersion.blobName);
    this.documents.splice(index, 1);
    return blobs;
  }

  /// Quanto si porterebbe via la cancellazione di un'azienda.
  removalCounts(companyID: string): { contacts: number; deals: number; activities: number; documents: number } {
    const count = (list: { companyID: string | null }[]) => list.filter((item) => item.companyID === companyID).length;
    return {
      contacts: count(this.contacts),
      deals: count(this.deals),
      activities: count(this.activities),
      documents: count(this.documents),
    };
  }

  /// Toglie un'azienda con contatti, trattative, attività e documenti; restituisce i file cifrati da cancellare.
  deleteCompany(id: string): string[] {
    this.companies = this.companies.filter((company) => company.id !== id);
    for (const contactID of new Set(this.contacts.filter((contact) => contact.companyID === id).map((contact) => contact.id))) {
      this.deleteContact(contactID);
    }
    for (const dealID of new Set(this.deals.filter((deal) => deal.companyID === id).map((deal) => deal.id))) {
      this.deleteDeal(dealID);
    }
    this.activities = this.activities.filter((activity) => activity.companyID !== id);
    const blobs: string[] = [];
    for (const document of this.documents) {
      if (document.companyID === id) blobs.push(...document.versions.map(DocumentVersion.blobName));
    }
    this.documents = this.documents.filter((document) => document.companyID !== id);
    return blobs;
  }
  // MARK: Dati noti

  /// I dati del cliente che il CRM conosce: prima di anonimizzare entrano nel dizionario, così si nascondono anche dove
  /// il motore non li riconosce. Con `companyID` quelli di un'azienda e dei suoi contatti (`knownValues(for:)`), senza
  /// tutto quello che il CRM di un progetto conosce: aziende e persone (`knownValues()`).
  knownValues(companyID?: string): KnownValue[] {
    const values = new KnownValues();
    if (companyID === undefined) {
      for (const company of this.companies) values.addCompany(company);
      for (const contact of this.contacts) values.addContact(contact);
      return values.list;
    }
    const company = this.company(companyID);
    if (!company) return [];
    values.addCompany(company);
    for (const contact of this.contactsOf(companyID)) values.addContact(contact);
    return values.list;
  }
}

// MARK: - Quello che il CRM sa già essere sensibile

/// Un dato del cliente con la sua categoria: «Edilnord S.r.l.» è un'azienda, «Mario Rossi» un nome.
export interface KnownValue {
  readonly label: string;
  readonly value: string;
}

/// I dati noti, senza doppioni e senza campi vuoti.
class KnownValues {
  readonly list: KnownValue[] = [];
  private readonly seen = new Set<string>();

  add(label: string, raw: string): void {
    const text = trimWhitespace(raw);
    if (!text) return;
    const key = JSON.stringify([label, text]);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({ label, value: text });
  }

  addCompany(company: Company): void {
    this.add("ORG", company.name);
    this.add("PIVA", company.vatNumber);
    // Il codice fiscale di una società è spesso la sua partita IVA (11 cifre).
    const characters = Array.from(company.taxCode);
    const digits = characters.filter((character) => /\p{N}/u.test(character)).length;
    const onlyDigits = characters.every((character) => /\p{N}/u.test(character) || character === " ");
    this.add(digits === 11 && onlyDigits ? "PIVA" : "CF", company.taxCode);
    this.add("IBAN", company.iban);
    this.add("EMAIL", company.email);
    this.add("EMAIL", company.pec);
    this.add("TELEPHONENUM", company.phone);
    this.add("URL", company.website);
  }

  addContact(contact: Contact): void {
    const fullName = Contact.fullName(contact);
    if (fullName.split(" ").filter((part) => part.length > 0).length >= 2) this.add("FULLNAME", fullName);
    this.add("EMAIL", contact.email);
    this.add("TELEPHONENUM", contact.phone);
    this.add("TELEPHONENUM", contact.mobile);
    this.add("CF", contact.taxCode);
  }
}

function upsert<T extends { id: string }>(item: T, list: T[]): void {
  const index = list.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) list[index] = item;
  else list.push(item);
}
