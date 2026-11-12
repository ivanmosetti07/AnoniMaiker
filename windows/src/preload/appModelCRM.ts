import { readFileSync } from "node:fs";
import { Anonymizer, RevealResult, Revealer, type AnonymizationResult, type TextRange } from "../core/anonimizzazione";
import {
  ClientDossier, CRMDocument, type Activity, type Company, type Contact, type Deal, type DocumentVersion,
} from "../core/crm";
import { DocumentFormat, DocumentNaming, DocumentPreview, FileReveal, FormatError, anonymizeFile } from "../core/documenti";
import { EngineError } from "../core/motore";
import { AppModel, CRMRoute, pathExtension } from "./appModel";
import { FilePanels } from "./filePanels";

// MARK: - Il CRM del progetto
//
// Ogni modifica passa dall'archivio cifrato del progetto e torna come CRM aggiornato. L'anonimizzazione usa anche i
// dati che il CRM del progetto conosce (ragioni sociali, partite IVA, persone), così si nascondono anche dove il motore
// non li riconosce.

/// Come mostrare una versione di un documento.
export interface VersionPreview {
  preview: DocumentPreview;
  /// L'anteprima con i segnaposto (per una risposta dell'AI), per evidenziare cosa è cambiato.
  compared: DocumentPreview | null;
  /// In unità UTF-16, sul testo di `preview`.
  highlights: TextRange[];
  /// Segnaposto che il dizionario non conosce.
  unknown: string[];
}

declare module "./appModel" {
  interface AppModel {
    // Schede (in Swift `save(_:)` per ogni tipo).
    saveCompany(company: Company): Promise<void>;
    saveContact(contact: Contact): Promise<void>;
    saveDeal(deal: Deal): Promise<void>;
    saveActivity(activity: Activity): Promise<void>;
    toggleDone(activity: Activity): Promise<void>;
    deleteContact(id: string): Promise<void>;
    deleteDeal(id: string): Promise<void>;
    deleteActivity(id: string): Promise<void>;
    /// Toglie un'azienda dal CRM del progetto: persone, trattative, attività e documenti restano, senza l'azienda.
    deleteCompany(id: string): Promise<void>;

    // Documenti
    /// Sceglie uno o più file e li aggiunge ai documenti del progetto.
    chooseDocuments(companyID: string | null): Promise<void>;
    /// Aggiunge file ai documenti del progetto e li anonimizza subito (le persone trovate entrano nel CRM).
    addDocuments(paths: readonly string[], companyID: string | null): Promise<void>;
    /// Il file di una versione (l'originale, l'anonimizzato, una risposta dell'AI).
    data(version: DocumentVersion): Promise<Uint8Array>;
    /// Anonimizza un documento del progetto (in qualunque formato), con i dati che il CRM conosce.
    anonymizeDocument(documentID: string): Promise<void>;
    /// Aggiunge a un documento la risposta di un'AI: un file con i segnaposto, in qualunque formato gestito.
    importAnswer(documentID: string): Promise<void>;
    /// Aggiunge a un documento la risposta di un'AI copiata negli appunti (testo).
    pasteAnswer(documentID: string): Promise<void>;
    removeVersion(versionID: string, documentID: string): Promise<void>;
    deleteDocument(documentID: string): Promise<void>;
    /// Salva una versione in un file: l'originale e l'anonimizzato come sono, una risposta dell'AI riconvertita.
    export(version: DocumentVersion, document: CRMDocument): Promise<void>;
    /// Come mostrare una versione: originale e anonimizzato come sono, una risposta dell'AI riconvertita.
    preview(version: DocumentVersion, document: CRMDocument): Promise<VersionPreview>;

    // Scheda del cliente
    /// La scheda in Markdown e la sua versione anonimizzata (con i dati noti del cliente).
    dossier(companyID: string): Promise<{ original: string; anonymized: AnonymizationResult }>;

    // Navigazione
    openCompany(id: string | null): void;
    openDocument(id: string): void;
    /// Il dizionario filtrato sulle voci di un cliente.
    showDictionary(companyID: string): void;
    /// Le aziende per i menu di scelta, in ordine alfabetico.
    readonly companyChoices: Company[];
  }
}

const proto = AppModel.prototype;

// MARK: Schede

proto.saveCompany = function (this: AppModel, company: Company) {
  return this.perform(async () => {
    this.crm = await this.crmStore.update((db) => db.saveCompany(company));
  });
};

proto.saveContact = function (this: AppModel, contact: Contact) {
  return this.perform(async () => {
    this.crm = await this.crmStore.update((db) => db.saveContact(contact));
  });
};

proto.saveDeal = function (this: AppModel, deal: Deal) {
  return this.perform(async () => {
    this.crm = await this.crmStore.update((db) => db.saveDeal(deal));
  });
};

proto.saveActivity = function (this: AppModel, activity: Activity) {
  return this.perform(async () => {
    this.crm = await this.crmStore.update((db) => db.saveActivity(activity));
  });
};

proto.toggleDone = function (this: AppModel, activity: Activity) {
  return this.saveActivity({ ...activity, isDone: !activity.isDone });
};

proto.deleteContact = function (this: AppModel, id: string) {
  return this.perform(async () => {
    this.crm = await this.crmStore.update((db) => db.deleteContact(id));
  });
};

proto.deleteDeal = function (this: AppModel, id: string) {
  return this.perform(async () => {
    this.crm = await this.crmStore.update((db) => db.deleteDeal(id));
  });
};

proto.deleteActivity = function (this: AppModel, id: string) {
  return this.perform(async () => {
    this.crm = await this.crmStore.update((db) => db.deleteActivity(id));
  });
};

proto.deleteCompany = async function (this: AppModel, id: string) {
  await this.perform(async () => {
    this.crm = await this.crmStore.update((db) => {
      db.companies = db.companies.filter((company) => company.id !== id);
      for (const contact of db.contacts) if (contact.companyID === id) contact.companyID = null;
      for (const deal of db.deals) if (deal.companyID === id) deal.companyID = null;
      for (const activity of db.activities) if (activity.companyID === id) activity.companyID = null;
      for (const document of db.documents) if (document.companyID === id) document.companyID = null;
    });
  });
  const route = CRMRoute.company(id);
  this.companiesPath = this.companiesPath.filter((item) => !CRMRoute.equals(item, route));
};

// MARK: Documenti

proto.chooseDocuments = async function (this: AppModel, companyID: string | null) {
  const paths = await this.platform.chooseFiles({
    title: "Scegli i file del progetto (testo, Markdown, CSV, Excel, Word, PDF): si anonimizzano e restano cifrati su questo PC",
    filters: FilePanels.documentFilters,
  });
  if (paths.length === 0) return;
  await this.addDocuments(paths, companyID);
};

proto.addDocuments = async function (this: AppModel, paths: readonly string[], companyID: string | null) {
  for (const path of paths) {
    let added: string | null = null;
    await this.perform(async () => {
      const result = await this.crmStore.addDocumentFromFile(path, companyID);
      this.crm = result.database;
      added = result.document.id;
    });
    if (added !== null && this.engine) await this.anonymizeDocument(added);
  }
  await this.touchCurrentProject();
};

proto.data = function (this: AppModel, version: DocumentVersion) {
  return this.crmStore.data(version);
};

proto.anonymizeDocument = async function (this: AppModel, documentID: string) {
  const engine = this.engine;
  const document = this.crm.document(documentID);
  const original = document ? CRMDocument.original(document) : null;
  if (!engine || !document || !original || this.busyDocuments.has(documentID)) return;
  this.busyDocuments = new Set([...this.busyDocuments, documentID]);
  const known = this.crm.knownValues();
  const settings = this.settings;
  const store = this.store;
  const crmStore = this.crmStore;
  try {
    await this.perform(async () => {
      const data = await crmStore.data(original);
      const anonymizer = new Anonymizer(engine, store);
      const outcome = await anonymizeFile(anonymizer, data, document.format, {
        fileExtension: pathExtension(original.fileName), settings, client: document.companyID, known,
      });
      let summary = outcome.report ? (outcome.report.isEmpty ? "Nessun dato da nascondere" : `Nascosti: ${outcome.report.summary}`) : "";
      if (outcome.recognizedPages > 0) summary += ` · ${outcome.recognizedPages} pagine lette con l'OCR`;
      this.crm = await crmStore.setAnonymized(outcome.data, summary, documentID);
      await this.refreshVault();
      await this.extractPeople(DocumentPreview.plainText(outcome.preview), original.fileName.length === 0 ? document.title : original.fileName);
    });
  } finally {
    const busy = new Set(this.busyDocuments);
    busy.delete(documentID);
    this.busyDocuments = busy;
  }
};

proto.importAnswer = async function (this: AppModel, documentID: string) {
  const path = await FilePanels.chooseDocument(this.platform);
  if (!path) return;
  const format = DocumentFormat.of(path);
  if (!format) {
    this.alert = FormatError.unsupported(pathExtension(path).toLowerCase()).message;
    return;
  }
  await this.perform(() => addAnswer(this, new Uint8Array(readFileSync(path)), format, basenameOf(path), documentID));
};

proto.pasteAnswer = async function (this: AppModel, documentID: string) {
  let pasted = "";
  try {
    pasted = await this.platform.paste();
  } catch {
    // Appunti illeggibili: come vuoti.
  }
  if (!pasted || pasted.trim().length === 0) {
    this.alert = "Negli appunti non c'è testo da incollare.";
    return;
  }
  await this.perform(() => addAnswer(this, new TextEncoder().encode(pasted), "markdown", "", documentID));
};

async function addAnswer(model: AppModel, data: Uint8Array, format: DocumentFormat, fileName: string, documentID: string): Promise<void> {
  const crmStore = model.crmStore;
  const outcome = await FileReveal.reveal(data, format, await model.store.snapshot(), pathExtension(fileName));
  const result = outcome.reveal ?? new RevealResult("");
  let summary = result.count === 0 ? "Nessun segnaposto da riconvertire" : `Riconvertiti ${result.count} segnaposto`;
  if (result.unknown.length > 0) summary += ` · ${result.unknown.length} sconosciuti`;
  model.crm = await crmStore.addAnswer(data, format, fileName, summary, documentID);
}

proto.removeVersion = function (this: AppModel, versionID: string, documentID: string) {
  return this.perform(async () => {
    this.crm = await this.crmStore.removeVersion(versionID, documentID);
  });
};

proto.deleteDocument = async function (this: AppModel, documentID: string) {
  await this.perform(async () => {
    this.crm = await this.crmStore.deleteDocument(documentID);
  });
  const route = CRMRoute.document(documentID);
  this.companiesPath = this.companiesPath.filter((item) => !CRMRoute.equals(item, route));
  this.documentsPath = this.documentsPath.filter((item) => !CRMRoute.equals(item, route));
};

proto.export = function (this: AppModel, version: DocumentVersion, document: CRMDocument) {
  return this.perform(async () => {
    let data = await this.crmStore.data(version);
    const format = CRMDocument.formatOf(document, version);
    const original = CRMDocument.original(document)?.fileName ?? "";
    const base = original.length === 0 ? `${document.title}.${DocumentFormat.defaultExtension(document.format)}` : original;
    // Una risposta in un altro formato (testo incollato) prende la sua estensione.
    const fileName = version.kind === "aiAnswer" && format !== document.format
      ? `${stem(base)}.${DocumentFormat.defaultExtension(format)}` : base;
    let name: string;
    switch (version.kind) {
      case "original":
        name = fileName;
        break;
      case "anonymized":
        name = DocumentNaming.anonymizedName(fileName, this.vault, this.settings);
        break;
      case "aiAnswer": {
        const current = await this.store.snapshot();
        data = (await FileReveal.reveal(data, format, current, pathExtension(fileName))).data;
        name = DocumentNaming.revealedName(fileName, current);
        break;
      }
    }
    await FilePanels.save(this.platform, data, name, null);
  });
};

proto.preview = async function (this: AppModel, version: DocumentVersion, document: CRMDocument): Promise<VersionPreview> {
  const data = await this.crmStore.data(version);
  const format = CRMDocument.formatOf(document, version);
  const ext = pathExtension(version.fileName);
  switch (version.kind) {
    case "original":
      return { preview: await FileReveal.preview(data, format, ext), compared: null, highlights: [], unknown: [] };
    case "anonymized": {
      const preview = await FileReveal.preview(data, format, ext);
      return { preview, compared: null, highlights: Revealer.placeholderRanges(DocumentPreview.plainText(preview)), unknown: [] };
    }
    case "aiAnswer": {
      const vault = this.vault;
      const raw = await FileReveal.preview(data, format, ext);
      const outcome = await FileReveal.reveal(data, format, vault, ext);
      let highlights: TextRange[] = [];
      if (outcome.preview.kind === "text") {
        const revealed = Revealer.reveal(DocumentPreview.plainText(raw), vault);
        if (revealed.text === DocumentPreview.plainText(outcome.preview)) highlights = revealed.spans;
      }
      return { preview: outcome.preview, compared: raw, highlights, unknown: outcome.reveal?.unknown ?? [] };
    }
  }
};

// MARK: Scheda del cliente

proto.dossier = async function (this: AppModel, companyID: string) {
  const engine = this.engine;
  if (!engine) throw EngineError.notInstalled;
  const markdown = ClientDossier.markdown(companyID, this.crm);
  if (markdown === null) throw EngineError.failed("cliente non trovato");
  const anonymizer = new Anonymizer(engine, this.store);
  const result = await anonymizer.anonymize(markdown, { settings: this.settings, client: companyID, known: this.crm.knownValues(companyID) });
  await this.refreshVault();
  return { original: markdown, anonymized: result };
};

// MARK: Navigazione

proto.openCompany = function (this: AppModel, id: string | null) {
  if (id === null) return;
  this.section = "companies";
  this.companiesPath = [CRMRoute.company(id)];
};

proto.openDocument = function (this: AppModel, id: string) {
  this.section = "documents";
  // Dopo il cambio di sezione: la pila di navigazione nasce adesso.
  setTimeout(() => {
    this.documentsPath = [CRMRoute.document(id)];
  }, 50);
};

proto.showDictionary = function (this: AppModel, companyID: string) {
  this.dictionaryClient = companyID;
  this.section = "dictionary";
};

Object.defineProperty(proto, "companyChoices", {
  configurable: true,
  get(this: AppModel) {
    return this.crm.sortedCompanies;
  },
});

function stem(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function basenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
