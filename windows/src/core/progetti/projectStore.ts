import { ChatConversation, ChatStore, type ChatFolder } from "../chat/chatModel";
import { container, decodeDate, decodeString, decodeUUID, encodeDate, type JSONObject, required, value } from "../crm/codable";
import { CRMDatabase } from "../crm/crmDatabase";
import { DocumentVersion } from "../crm/crmModel";
import { CRMStore, type CRMFolder } from "../crm/crmStore";
import { Vault, VaultStore, type VaultFolder } from "../dizionario";
import { FolderError } from "../sicurezza";
import { newUUID } from "../sicurezza/swiftCoding";

// MARK: - I progetti
//
// Un progetto contiene tutto quello che serve a un lavoro: i suoi documenti, il suo CRM (persone, aziende, trattative,
// attività), il suo dizionario dei segnaposto e le sue conversazioni con GPT. Ognuno sta nella cartella cifrata in file
// suoi («progetti/<id>_dizionario», «progetti/<id>_crm», «progetti/<id>_chat»); l'elenco sta in «elenco-progetti».
// I documenti restano in «documenti/…», uno per versione, come prima.
//
// Alla prima apertura i dati delle versioni precedenti (un dizionario, un CRM e una chat per tutta l'app) diventano
// progetti: uno per ogni cliente, con i suoi contatti, trattative, attività, documenti, voci del dizionario e
// conversazioni; quello che non è di nessun cliente va nel progetto «Generale». I segnaposto restano quelli di prima.

export interface Project {
  id: string;
  name: string;
  notes: string;
  created: Date;
  updated: Date;
}

export const Project = {
  create(name: string, notes = "", created: Date = new Date()): Project {
    return { id: newUUID(), name, notes, created, updated: created };
  },

  decode(json: unknown): Project {
    const c = container(json);
    return {
      id: required(c, "id", decodeUUID),
      name: value(c, "name", decodeString, "Progetto"),
      notes: value(c, "notes", decodeString, ""),
      created: value(c, "created", decodeDate, new Date()),
      updated: value(c, "updated", decodeDate, new Date()),
    };
  },

  encode(project: Project): JSONObject {
    return { id: project.id, name: project.name, notes: project.notes, created: encodeDate(project.created), updated: encodeDate(project.updated) };
  },
};

/// Quello che serve della cartella cifrata (`SecureFolder`) per i progetti e i loro archivi.
export type ProjectFolder = VaultFolder & CRMFolder & ChatFolder;

/// Gli archivi di un progetto: dizionario, CRM e conversazioni. Uno solo per progetto, condiviso da tutta l'app.
export class ProjectSpace {
  readonly id: string;
  readonly vault: VaultStore;
  readonly crm: CRMStore;
  readonly chat: ChatStore;

  constructor(id: string, folder: ProjectFolder) {
    this.id = id;
    this.vault = new VaultStore(folder, ProjectSpace.fileName(id, "dizionario"));
    this.crm = new CRMStore(folder, ProjectSpace.fileName(id, "crm"));
    this.chat = new ChatStore(folder, ProjectSpace.fileName(id, "chat"));
  }

  static fileName(id: string, kind: string): string {
    return `progetti/${id.toUpperCase()}_${kind}`;
  }

  get fileNames(): string[] {
    return ["dizionario", "crm", "chat"].map((kind) => ProjectSpace.fileName(this.id, kind));
  }
}

/// Come si dividono i dati di prima: una parte per cliente, più «Generale».
export interface ProjectPart {
  name: string;
  created: Date;
  updated: Date;
  vault: Vault;
  crm: CRMDatabase;
  chats: ChatConversation[];
}

/// Come l'attore di Swift: le operazioni passano una alla volta (una coda di promesse).
export class ProjectStore {
  static readonly indexName = "elenco-progetti";

  readonly folder: ProjectFolder;
  private projects: Project[] = [];
  private isOpen = false;
  /// Gli archivi già aperti, uno per progetto.
  private readonly spaces = new Map<string, ProjectSpace>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(folder: ProjectFolder) {
    this.folder = folder;
  }

  private exclusive<T>(body: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(body, body);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /// Gli archivi di un progetto (sempre gli stessi oggetti: due archivi sullo stesso file perderebbero modifiche).
  space(id: string): ProjectSpace {
    const key = id.toUpperCase();
    let space = this.spaces.get(key);
    if (!space) {
      space = new ProjectSpace(key, this.folder);
      this.spaces.set(key, space);
    }
    return space;
  }

  /// I progetti, dal più recente. La prima volta porta nei progetti i dati delle versioni precedenti.
  open(): Promise<Project[]> {
    return this.exclusive(() => this.openUnlocked());
  }

  private openUnlocked(): Project[] {
    if (!this.isOpen) {
      const data = this.folder.read(ProjectStore.indexName);
      if (data !== null) {
        try {
          const json: unknown = JSON.parse(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8"));
          if (!Array.isArray(json)) throw new Error("mi aspettavo un elenco di progetti");
          this.projects = json.map(Project.decode);
        } catch (error) {
          throw FolderError.unreadable(ProjectStore.indexName, error instanceof Error ? error.message : String(error));
        }
      } else {
        this.projects = this.migrateLegacyData();
      }
      this.isOpen = true;
    }
    return this.sorted;
  }

  private get sorted(): Project[] {
    return this.projects.map((project) => ({ ...project })).sort((a, b) => b.updated.getTime() - a.updated.getTime());
  }

  /// Dopo un ripristino: rilegge dal disco (e se la copia era di una versione precedente, la porta nei progetti).
  reload(): Promise<Project[]> {
    return this.exclusive(() => {
      this.isOpen = false;
      this.projects = [];
      this.spaces.clear();
      return this.openUnlocked();
    });
  }

  create(name: string, now: Date = new Date()): Promise<Project> {
    return this.exclusive(() => {
      this.openUnlocked();
      const project = Project.create(ProjectStore.cleaned(name), "", now);
      this.projects.push(project);
      this.save();
      return { ...project };
    });
  }

  rename(id: string, name: string): Promise<Project[]> {
    return this.exclusive(() => {
      this.openUnlocked();
      const project = this.projects.find((item) => item.id === id);
      if (!project) return this.sorted;
      project.name = ProjectStore.cleaned(name);
      this.save();
      return this.sorted;
    });
  }

  /// Il progetto è stato usato adesso: sale in cima all'elenco.
  touch(id: string, now: Date = new Date()): Promise<void> {
    return this.exclusive(() => {
      this.openUnlocked();
      const project = this.projects.find((item) => item.id === id);
      if (!project) return;
      project.updated = now;
      this.save();
    });
  }

  /// Cancella un progetto con tutto quello che contiene: documenti, CRM, dizionario e conversazioni.
  delete(id: string): Promise<Project[]> {
    return this.exclusive(async () => {
      this.openUnlocked();
      const space = this.space(id);
      const database = await space.crm.snapshot();
      for (const blob of database.documents.flatMap((document) => document.versions.map(DocumentVersion.blobName))) {
        this.folder.delete(blob);
      }
      for (const name of space.fileNames) this.folder.delete(name);
      this.projects = this.projects.filter((project) => project.id !== id);
      this.spaces.delete(id.toUpperCase());
      this.save();
      return this.sorted;
    });
  }

  private save(): void {
    this.folder.write(Buffer.from(JSON.stringify(this.projects.map(Project.encode)), "utf8"), ProjectStore.indexName);
  }

  static cleaned(name: string): string {
    const trimmed = name.replace(/^[\p{Zs}\t\n\r\v\f\u0085\u2028\u2029]+|[\p{Zs}\t\n\r\v\f\u0085\u2028\u2029]+$/gu, "");
    return trimmed.length === 0 ? "Nuovo progetto" : trimmed;
  }

  // MARK: Dai dati delle versioni precedenti

  /// Un progetto per ogni cliente, più «Generale» per il resto. Se non c'è niente, nessun progetto.
  private migrateLegacyData(): Project[] {
    const vaultData = this.folder.read(VaultStore.fileName);
    const vault = vaultData !== null ? Vault.decode(vaultData) : new Vault();
    const crmData = this.folder.read(CRMStore.fileName);
    const crm = crmData !== null ? CRMDatabase.fromData(crmData) : new CRMDatabase();
    const chatData = this.folder.read(ChatStore.fileName);
    const chats = chatData !== null ? ChatConversation.decodeList(chatData) : [];
    this.folder.unlock();

    const result: Project[] = [];
    for (const part of ProjectStore.split(vault, crm, chats)) {
      const project = Project.create(part.name, "", part.created);
      project.updated = part.updated;
      const space = new ProjectSpace(project.id, this.folder);
      this.folder.write(part.vault.encode(), space.vault.fileName);
      this.folder.write(part.crm.data(), space.crm.fileName);
      this.folder.write(ChatConversation.encodeList(part.chats), space.chat.fileName);
      result.push(project);
    }
    this.projects = result;
    this.save();
    // I file vecchi servono solo a questo passaggio: tolti, i dati restano solo nei progetti.
    for (const name of [VaultStore.fileName, CRMStore.fileName, ChatStore.fileName]) this.folder.delete(name);
    return result;
  }

  /// Come si dividono i dati di prima: ogni cliente con le sue cose, il resto in «Generale».
  static split(vault: Vault, crm: CRMDatabase, chats: readonly ChatConversation[]): ProjectPart[] {
    const parts: ProjectPart[] = [];
    const placed = { contacts: new Set<string>(), deals: new Set<string>(), activities: new Set<string>(), documents: new Set<string>(), chats: new Set<string>() };
    const latest = (dates: Date[], fallback: Date) => (dates.length === 0 ? fallback : new Date(Math.max(...dates.map((d) => d.getTime()))));
    const earliest = (dates: Date[], fallback: Date) => (dates.length === 0 ? fallback : new Date(Math.min(...dates.map((d) => d.getTime()))));
    for (const company of crm.companies) {
      const database = new CRMDatabase();
      database.companies = [company];
      database.contacts = crm.contacts.filter((item) => item.companyID === company.id);
      database.deals = crm.deals.filter((item) => item.companyID === company.id);
      database.activities = crm.activities.filter((item) => item.companyID === company.id);
      database.documents = crm.documents.filter((item) => item.companyID === company.id);
      for (const item of database.contacts) placed.contacts.add(item.id);
      for (const item of database.deals) placed.deals.add(item.id);
      for (const item of database.activities) placed.activities.add(item.id);
      for (const item of database.documents) placed.documents.add(item.id);
      const conversations = chats.filter((chat) => chat.clientID === company.id);
      for (const chat of conversations) placed.chats.add(chat.id);
      const dates = [...database.documents.map((d) => d.updated), ...database.activities.map((a) => a.updated), company.updated];
      parts.push({
        name: company.name.length === 0 ? "Cliente senza nome" : company.name,
        created: company.created,
        updated: latest(dates, company.updated),
        vault: vault.subset((entry) => entry.clients.has(company.id)),
        crm: database.clone(),
        chats: conversations.map(ChatConversation.clone),
      });
    }
    const rest = new CRMDatabase();
    rest.contacts = crm.contacts.filter((item) => !placed.contacts.has(item.id));
    rest.deals = crm.deals.filter((item) => !placed.deals.has(item.id));
    rest.activities = crm.activities.filter((item) => !placed.activities.has(item.id));
    rest.documents = crm.documents.filter((item) => !placed.documents.has(item.id));
    const companyIDs = new Set(crm.companies.map((company) => company.id));
    const restVault = vault.subset((entry) => ![...entry.clients].some((client) => companyIDs.has(client)));
    const restChats = chats.filter((chat) => !placed.chats.has(chat.id));
    if (!rest.isEmpty || !restVault.isEmpty || restChats.length > 0) {
      const dates = [...rest.documents.map((d) => d.updated), ...restChats.map((c) => c.updated), ...restVault.entries.map((e) => e.lastUsed)];
      const now = new Date();
      parts.push({
        name: "Generale",
        created: earliest(dates, now),
        updated: latest(dates, now),
        vault: restVault,
        crm: rest.clone(),
        chats: restChats.map(ChatConversation.clone),
      });
    }
    return parts;
  }
}
