import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { DocumentFormat, FormatError, TextDocument } from "../documenti";
import { FolderError, type SecureFolder } from "../sicurezza";
import { CRMDatabase } from "./crmDatabase";
import { CRMDocument, DocumentVersion } from "./crmModel";

// MARK: - Il CRM su disco, cifrato
//
// `crm.sigillato` con aziende, contatti, trattative, attività e l'elenco dei documenti; il testo di ogni versione di
// un documento sta in un suo file cifrato (`documenti/<id>.sigillato`), così un salvataggio del CRM non riscrive i
// documenti. Ogni modifica si salva subito.
//
// Come l'attore di Swift: le operazioni passano una alla volta (una coda di promesse) e chi chiama riceve copie.

/// Quello che serve della cartella cifrata (`SecureFolder`).
export type CRMFolder = Pick<SecureFolder, "read" | "write" | "delete" | "unlock" | "sealedNames">;

export class CRMStore {
  static readonly fileName = "crm";

  readonly folder: CRMFolder;
  /// Il file cifrato del CRM («crm», o quello di un progetto).
  readonly fileName: string;
  private database = new CRMDatabase();
  private isOpen = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(folder: CRMFolder, fileName: string = CRMStore.fileName) {
    this.folder = folder;
    this.fileName = fileName;
  }

  private exclusive<T>(body: () => T): Promise<T> {
    const run = this.queue.then(body, body);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private openUnlocked(): CRMDatabase {
    if (this.isOpen) return this.database;
    const data = this.folder.read(this.fileName);
    if (data !== null) {
      try {
        this.database = CRMDatabase.fromData(data);
      } catch (error) {
        throw FolderError.unreadable(this.fileName, error instanceof Error ? error.message : String(error));
      }
    } else {
      this.folder.unlock();
    }
    this.isOpen = true;
    return this.database;
  }

  open(): Promise<CRMDatabase> {
    return this.exclusive(() => this.openUnlocked().clone());
  }

  snapshot(): Promise<CRMDatabase> {
    return this.open();
  }

  /// Modifica il CRM e lo salva subito cifrato; restituisce il CRM aggiornato.
  update(body: (database: CRMDatabase) => void): Promise<CRMDatabase> {
    return this.exclusive(() => this.updateUnlocked(body));
  }

  private updateUnlocked(body: (database: CRMDatabase) => void): CRMDatabase {
    const copy = this.openUnlocked().clone();
    body(copy);
    this.save(copy);
    return copy.clone();
  }

  private save(copy: CRMDatabase): void {
    if (copy.equals(this.database)) return;
    this.folder.write(copy.data(), this.fileName);
    this.database = copy.clone();
  }

  /// Dopo un ripristino: rilegge dal disco.
  reload(): Promise<CRMDatabase> {
    return this.exclusive(() => {
      this.isOpen = false;
      this.database = new CRMDatabase();
      return this.openUnlocked().clone();
    });
  }

  // MARK: Cancellazioni con i loro file

  deleteCompany(id: string): Promise<CRMDatabase> {
    return this.exclusive(() => {
      const copy = this.openUnlocked().clone();
      const blobs = copy.deleteCompany(id);
      this.save(copy);
      this.deleteQuietly(blobs);
      return copy;
    });
  }

  deleteDocument(id: string): Promise<CRMDatabase> {
    return this.exclusive(() => {
      const copy = this.openUnlocked().clone();
      const blobs = copy.deleteDocument(id);
      this.save(copy);
      this.deleteQuietly(blobs);
      return copy;
    });
  }

  private deleteQuietly(blobs: string[]): void {
    for (const blob of blobs) {
      try {
        this.folder.delete(blob);
      } catch {
        // Come `try?`: un file rimasto non blocca la cancellazione.
      }
    }
  }

  // MARK: Documenti

  /// Archivia un file (testo, Markdown, CSV, Excel, Word, PDF) nella scheda di un cliente: l'originale si conserva com'è,
  /// byte per byte (`addDocument(from:title:companyID:)`).
  addDocumentFromFile(path: string, companyID: string | null, title?: string): Promise<{ document: CRMDocument; database: CRMDatabase }> {
    return this.exclusive(() => {
      const format = DocumentFormat.of(path);
      if (!format) throw FormatError.unsupported(extname(path).replace(/^\./, "").toLowerCase());
      const name = basename(path);
      const stem = extname(name) ? name.slice(0, -extname(name).length) : name;
      return this.addDocumentUnlocked(title ?? stem, readFileSync(path), format, name, companyID);
    });
  }

  /// Archivia un testo (per esempio incollato) come documento del cliente (`addDocument(title:text:fileName:companyID:)`).
  addTextDocument(
    title: string,
    text: TextDocument,
    fileName: string,
    companyID: string | null,
  ): Promise<{ document: CRMDocument; database: CRMDatabase }> {
    return this.exclusive(() =>
      this.addDocumentUnlocked(title, text.data(), text.kind === "markdown" ? "markdown" : "plainText", fileName, companyID),
    );
  }

  /// Archivia un file già letto.
  addDocument(
    title: string,
    data: Uint8Array,
    format: DocumentFormat,
    fileName: string,
    companyID: string | null,
  ): Promise<{ document: CRMDocument; database: CRMDatabase }> {
    return this.exclusive(() => this.addDocumentUnlocked(title, data, format, fileName, companyID));
  }

  private addDocumentUnlocked(
    title: string,
    data: Uint8Array,
    format: DocumentFormat,
    fileName: string,
    companyID: string | null,
  ): { document: CRMDocument; database: CRMDatabase } {
    const document = CRMDocument.create(title, format, companyID);
    const version = DocumentVersion.create("original", fileName);
    this.folder.write(data, DocumentVersion.blobName(version));
    document.versions = [version];
    const database = this.updateUnlocked((db) => db.saveDocument(document));
    return { document: database.document(document.id) ?? document, database };
  }

  /// Il file di una versione, com'è.
  data(version: DocumentVersion): Promise<Uint8Array> {
    return this.exclusive(() => this.dataUnlocked(version));
  }

  private dataUnlocked(version: DocumentVersion): Uint8Array {
    const data = this.folder.read(DocumentVersion.blobName(version));
    if (data === null) throw FolderError.unreadable(DocumentVersion.blobName(version), "file mancante");
    return data;
  }

  /// Il testo di una versione di testo o Markdown, con la codifica e il BOM con cui è arrivata.
  text(version: DocumentVersion, document: CRMDocument): Promise<TextDocument> {
    return this.exclusive(() => {
      const format = CRMDocument.formatOf(document, version);
      return TextDocument.decode(this.dataUnlocked(version), format === "markdown" ? "markdown" : "plainText");
    });
  }

  /// Mette (o sostituisce) la versione anonimizzata di un documento (i byte del file o un testo).
  setAnonymized(content: Uint8Array | TextDocument, summary: string, documentID: string): Promise<CRMDatabase> {
    return this.exclusive(() => {
      const data = content instanceof TextDocument ? content.data() : content;
      const copy = this.openUnlocked().clone();
      const document = copy.document(documentID);
      if (!document) return copy;
      const old = document.versions.filter((version) => version.kind === "anonymized");
      const version = DocumentVersion.create("anonymized", CRMDocument.original(document)?.fileName ?? "", null, summary);
      this.folder.write(data, DocumentVersion.blobName(version));
      document.versions = [...document.versions.filter((item) => item.kind !== "anonymized"), version];
      copy.saveDocument(document);
      this.save(copy);
      this.deleteQuietly(old.map(DocumentVersion.blobName));
      return copy;
    });
  }

  /// Aggiunge la risposta di un'AI (con i segnaposto) a un documento: un file di qualunque formato
  /// (`addAnswer(data, format, fileName, summary, documentID)`) o un testo incollato
  /// (`addAnswer(text, fileName, summary, documentID)`).
  addAnswer(data: Uint8Array, format: DocumentFormat, fileName: string, summary: string, documentID: string): Promise<CRMDatabase>;
  addAnswer(text: TextDocument, fileName: string, summary: string, documentID: string): Promise<CRMDatabase>;
  addAnswer(...args: [Uint8Array, DocumentFormat, string, string, string] | [TextDocument, string, string, string]): Promise<CRMDatabase> {
    const [data, format, fileName, summary, documentID]: [Uint8Array, DocumentFormat, string, string, string] =
      args[0] instanceof TextDocument
        ? [args[0].data(), args[0].kind === "markdown" ? "markdown" : "plainText", args[1] as string, args[2] as string, args[3] as string]
        : (args as [Uint8Array, DocumentFormat, string, string, string]);
    return this.exclusive(() => {
      const copy = this.openUnlocked().clone();
      const document = copy.document(documentID);
      if (!document) return copy;
      const version = DocumentVersion.create("aiAnswer", fileName, format === document.format ? null : format, summary);
      this.folder.write(data, DocumentVersion.blobName(version));
      document.versions = [...document.versions, version];
      copy.saveDocument(document);
      this.save(copy);
      return copy;
    });
  }

  /// Toglie una versione (non l'originale).
  removeVersion(versionID: string, documentID: string): Promise<CRMDatabase> {
    return this.exclusive(() => {
      const copy = this.openUnlocked().clone();
      const document = copy.document(documentID);
      const version = document?.versions.find((item) => item.id === versionID);
      if (!document || !version || version.kind === "original") return copy;
      document.versions = document.versions.filter((item) => item.id !== versionID);
      copy.saveDocument(document);
      this.save(copy);
      this.deleteQuietly([DocumentVersion.blobName(version)]);
      return copy;
    });
  }
}
