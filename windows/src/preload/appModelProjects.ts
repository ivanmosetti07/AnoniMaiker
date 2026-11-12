import type { AnonymizationReport } from "../core/anonimizzazione";
import { CRMDatabase } from "../core/crm";
import { Vault } from "../core/dizionario";
import { DocumentFormat, TextDocument, type DocumentFormat as Format } from "../core/documenti";
import { CRMExtraction, type CRMExtractionReport } from "../core/progetti";
import { Format as Formatting } from "../shared/format";
import { AppModel, type Workspace } from "./appModel";

// MARK: - I progetti
//
// Aprire un progetto carica il suo dizionario, il suo CRM e le sue conversazioni. Un file anonimizzato dentro un
// progetto finisce da solo fra i suoi documenti (originale e versione anonimizzata), e le persone e le aziende trovate
// entrano nel suo CRM.

declare module "./appModel" {
  interface AppModel {
    /// Carica gli archivi del progetto aperto.
    loadProject(): Promise<void>;
    /// Apre un progetto (null: nessuno).
    selectProject(id: string | null): Promise<void>;
    /// Torna all'elenco dei progetti.
    showProjects(): Promise<void>;
    createProject(name: string): Promise<void>;
    renameProject(id: string, name: string): Promise<void>;
    /// Cancella il progetto con documenti, CRM, dizionario e conversazioni.
    deleteProject(id: string): Promise<void>;
    /// Un file anonimizzato entra nei documenti del progetto (o aggiorna quello che c'è già con lo stesso nome), e le
    /// persone e aziende trovate entrano nel CRM. Restituisce la nota da mostrare.
    archive(original: Uint8Array, format: Format, fileName: string, anonymized: Uint8Array, anonymizedText: string,
      report: AnonymizationReport | null): Promise<string>;
    /// Persone e aziende di un testo anonimizzato entrano nel CRM del progetto.
    extractPeople(anonymized: string, source: string): Promise<CRMExtractionReport>;
    touchCurrentProject(): Promise<void>;
    /// Il testo del banco «Anonimizza» entra nei documenti del progetto (con il CRM).
    saveToProject(space: Workspace): Promise<void>;
  }
}

const proto = AppModel.prototype;

proto.loadProject = async function (this: AppModel): Promise<void> {
  this.chat.task?.abort();
  this.chat.selectedID = null;
  this.chat.pending = [];
  this.chat.error = null;
  this.companiesPath = [];
  this.documentsPath = [];
  this.dictionaryClient = null;
  if (!this.hasProject) {
    this.vault = new Vault();
    this.crm = new CRMDatabase();
    this.chat.conversations = [];
    return;
  }
  const space = this.space;
  this.vault = await space.vault.open();
  this.crm = await space.crm.open();
  this.chat.conversations = await space.chat.open();
};

proto.selectProject = function (this: AppModel, id: string | null): Promise<void> {
  if (id === this.currentProjectID && id !== null) return Promise.resolve();
  this.currentProjectID = id;
  if (id !== null) {
    this.section = this.section === "dictionary" ? "anonymize" : this.section;
    touch(this, id);
  }
  return this.perform(() => this.loadProject());
};

proto.showProjects = function (this: AppModel): Promise<void> {
  this.currentProjectID = null;
  return this.perform(() => this.loadProject());
};

proto.createProject = async function (this: AppModel, name: string): Promise<void> {
  await this.perform(async () => {
    const project = await this.projectStore.create(name);
    this.projects = await this.projectStore.open();
    this.currentProjectID = project.id;
    this.section = "anonymize";
    await this.loadProject();
  });
};

proto.renameProject = async function (this: AppModel, id: string, name: string): Promise<void> {
  await this.perform(async () => {
    this.projects = await this.projectStore.rename(id, name);
  });
};

proto.deleteProject = async function (this: AppModel, id: string): Promise<void> {
  await this.perform(async () => {
    this.projects = await this.projectStore.delete(id);
    this.removeWorkspaces(id);
    if (this.currentProjectID === id) {
      this.currentProjectID = null;
      await this.loadProject();
    }
  });
};

function touch(model: AppModel, id: string): void {
  void (async () => {
    try {
      await model.projectStore.touch(id);
      model.projects = await model.projectStore.open();
    } catch {
      // Come `try?`.
    }
  })();
}

// MARK: Documenti e CRM dal banco «Anonimizza»

proto.archive = async function (
  this: AppModel, original: Uint8Array, format: Format, fileName: string, anonymized: Uint8Array, anonymizedText: string,
  report: AnonymizationReport | null,
): Promise<string> {
  const title = stem(fileName);
  let summary = report ? (report.isEmpty ? "Nessun dato da nascondere" : `Nascosti: ${report.summary}`) : "";
  if (!summary) summary = "Anonimizzato";
  const crmStore = this.crmStore;
  const existing = this.crm.documents.find((document) =>
    document.title === title && document.versions.find((v) => v.kind === "original")?.fileName === fileName && document.format === format);
  const documentID = existing ? existing.id : (await crmStore.addDocument(title, original, format, fileName, null)).document.id;
  this.crm = await crmStore.setAnonymized(anonymized, summary, documentID);
  const extraction = await this.extractPeople(anonymizedText, fileName);
  await this.touchCurrentProject();
  return ["Salvato nei documenti del progetto", extraction.summary].filter((part) => part.length > 0).join(" · ");
};

proto.extractPeople = async function (this: AppModel, anonymized: string, source: string): Promise<CRMExtractionReport> {
  const store = this.store;
  const crmStore = this.crmStore;
  const current = await store.snapshot();
  const database = await crmStore.snapshot();
  const report = CRMExtraction.apply(anonymized, current, source, database);
  if (report.isEmpty) return report;
  this.crm = await crmStore.update((stored) => {
    stored.companies = database.companies;
    stored.contacts = database.contacts;
    stored.deals = database.deals;
    stored.activities = database.activities;
    stored.documents = database.documents;
  });
  return report;
};

proto.touchCurrentProject = async function (this: AppModel): Promise<void> {
  const id = this.currentProjectID;
  if (id === null) return;
  try {
    await this.projectStore.touch(id);
    this.projects = await this.projectStore.open();
  } catch {
    // Come `try?`.
  }
};

proto.saveToProject = async function (this: AppModel, space: Workspace): Promise<void> {
  const outcome = space.outcome;
  if (!this.hasProject || !space.hasOutput || space.isStale || outcome?.kind !== "anonymized") return;
  const report = outcome.report;
  await this.perform(async () => {
    const source = space.source;
    if (source && source.isFile && space.outputData) {
      space.projectNote = await this.archive(source.data, source.format, source.name, space.outputData, space.output, report);
    } else {
      const text = source?.text ?? new TextDocument(space.input, "plainText");
      const result = text.replacingText(space.output);
      const format: Format = text.kind === "markdown" ? "markdown" : "plainText";
      // Un testo incollato prende il nome dalla sua prima riga.
      const firstLine = (space.input.split(/\r\n|[\n\r\u2028\u2029\u0085\u000b\u000c]/).find((line) => line.length > 0) ?? "")
        .trim().replaceAll("/", "-");
      const title = firstLine.length === 0 ? `Testo del ${Formatting.dateTime(new Date())}` : Array.from(firstLine).slice(0, 60).join("");
      const fileName = source?.name ?? `${title}.${DocumentFormat.defaultExtension(format)}`;
      space.projectNote = await this.archive(text.data(), format, fileName, result.data(), space.output, report);
    }
  });
};

/// Il nome senza estensione («Contratto.docx» → «Contratto»), come `deletingPathExtension`.
function stem(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
