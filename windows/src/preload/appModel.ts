import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import {
  AnonymizationReport, AnonymizationSettings, Anonymizer, RevealResult, Revealer, type TextRange,
} from "../core/anonimizzazione";
import { CRMDatabase, type CRMStore } from "../core/crm";
import { Vault, type VaultStore } from "../core/dizionario";
import {
  DocumentFormat, DocumentNaming, DocumentPreview, FileReveal, FormatError, TextDocument, anonymizeFile, type FileOutcome,
} from "../core/documenti";
import { EngineError, PIIEngine } from "../core/motore";
import { ProjectStore, type Project, type ProjectSpace } from "../core/progetti";
import type { ChatStore } from "../core/chat";
import {
  SecureFolder, setDefaultKeyProtection, windowsKeyProtection, type BackupSummary, type KeyProtectionKind,
} from "../core/sicurezza";
import { AppSection, CRMRoute } from "../shared/navigation";
import { Observable } from "../shared/observable";
import { ChatState } from "./chatState";
import { FilePanels } from "./filePanels";
import { observed } from "./observed";
import type { PlatformAPI } from "./platform";
import { Preferences } from "./preferences";
import { UpdateState } from "./updateState";

export const appLog = {
  notice(message: string): void {
    console.info(`[app] ${message}`);
  },
  error(message: string): void {
    console.error(`[app] ${message}`);
  },
};

// MARK: - Lo stato dell'app
//
// Il motore (dentro l'app), la cartella cifrata, i progetti e la navigazione. Ogni progetto ha i suoi documenti, il suo
// CRM, il suo dizionario e le sue conversazioni: l'app lavora sempre dentro il progetto aperto. Tutto resta sul PC.

export { AppSection, CRMRoute } from "../shared/navigation";

/// Un file aperto: il percorso, il formato e i byte; per testo e Markdown anche il testo con la sua codifica.
export class OpenedFile {
  constructor(
    readonly path: string,
    readonly format: DocumentFormat,
    readonly data: Uint8Array,
    readonly text: TextDocument | null,
  ) {}

  /// Il nome del file («Contratto.docx»).
  get name(): string {
    return basename(this.path);
  }

  /// CSV, Excel, Word, PDF: si lavora sul file, non su un testo modificabile.
  get isFile(): boolean {
    return this.text === null;
  }
}

export type WorkspaceMode = "anonymize" | "reveal";

export type WorkspaceOutcome = { kind: "anonymized"; report: AnonymizationReport } | { kind: "revealed"; result: RevealResult };

/// Un banco di lavoro: il testo di partenza a sinistra, il risultato a destra.
export class Workspace extends Observable {
  readonly mode: WorkspaceMode;
  declare input: string;
  declare source: OpenedFile | null;
  /// Il cliente del CRM a cui legare i dati (solo «Anonimizza»).
  declare clientID: string | null;
  declare output: string;
  /// Le parti da evidenziare nel risultato (segnaposto o dati rimessi), in unità UTF-16.
  declare highlights: TextRange[];
  declare outcome: WorkspaceOutcome | null;
  /// Da 0 a 1 mentre il motore lavora.
  declare progress: number | null;
  /// Il testo da cui viene il risultato: se l'ingresso cambia, il risultato è vecchio.
  declare ranInput: string | null;
  declare isRunning: boolean;
  /// Con un file (CSV, Excel, Word, PDF): l'anteprima di partenza, il file prodotto e la sua anteprima.
  declare inputPreview: DocumentPreview | null;
  declare outputData: Uint8Array | null;
  declare outputPreview: DocumentPreview | null;
  /// Pagine del PDF lette con il riconoscimento del testo.
  declare recognizedPages: number;
  /// Cosa è successo nel progetto: «Salvato nei documenti · 3 persone nuove nel CRM».
  declare projectNote: string | null;
  /// Il lavoro in corso (per annullarlo).
  task: AbortController | null = null;

  constructor(mode: WorkspaceMode) {
    super();
    this.mode = mode;
    observed<Workspace, WorkspaceField>(this, Workspace.initial());
  }

  private static initial(): Pick<Workspace, WorkspaceField> {
    return {
      input: "", source: null, clientID: null, output: "", highlights: [], outcome: null, progress: null, ranInput: null,
      isRunning: false, inputPreview: null, outputData: null, outputPreview: null, recognizedPages: 0, projectNote: null,
    };
  }

  get isFile(): boolean {
    return this.source?.isFile === true;
  }

  get isStale(): boolean {
    return this.ranInput !== null && this.ranInput !== this.input;
  }

  get hasInput(): boolean {
    return this.isFile || this.input.trim().length > 0;
  }

  get hasOutput(): boolean {
    return this.output.length > 0 || this.outputData !== null;
  }

  get isEmpty(): boolean {
    return this.input.length === 0 && this.output.length === 0 && this.source === null;
  }

  clear(): void {
    this.task?.abort();
    this.task = null;
    // Il cliente resta quello scelto.
    const { clientID: _client, ...rest } = Workspace.initial();
    Object.assign(this, rest);
  }
}

type WorkspaceField =
  | "input" | "source" | "clientID" | "output" | "highlights" | "outcome" | "progress" | "ranInput" | "isRunning"
  | "inputPreview" | "outputData" | "outputPreview" | "recognizedPages" | "projectNote";

export type EngineState = { kind: "loading" } | { kind: "ready" } | { kind: "missing" } | { kind: "failed"; message: string };
export type VaultState = { kind: "opening" } | { kind: "ready"; protection: KeyProtectionKind } | { kind: "failed"; message: string };

/// Le finestre della copia di sicurezza.
export type BackupStep = { kind: "export" } | { kind: "restore"; path: string };

/// I passi della guida che portano altrove.
export type GuideAction = "backup" | "createProject" | "anonymize" | "chat";

/// I comandi dei menu di Windows (canale «menu»).
export type MenuCommand =
  | "nuovo-progetto" | "progetti" | "copia" | "ripristina" | "impostazioni" | "chat" | "guida" | "aggiornamenti" | "informazioni";

export interface AppModelOptions {
  /// La cartella del motore (per le prove); di serie `<risorse>/engine` nell'app installata, `<app>/engine` in sviluppo.
  engineDirectory?: string;
  /// Un motore già pronto (per le prove: uno solo per tutte); `null` per un'app senza motore.
  engine?: PIIEngine | null;
  /// La cartella cifrata (per le prove); di serie quella dei dati (`ANONIMAIKER_DATI` la sostituisce).
  folder?: SecureFolder;
}

type AppModelField =
  | "engineState" | "vaultState" | "vault" | "crm" | "alert" | "section" | "companiesPath" | "documentsPath" | "projects"
  | "showsChat" | "totals" | "backupStep" | "busyDocuments" | "dictionaryClient" | "showsGuide" | "requestsNewProject"
  | "showsSettings" | "showsAbout";

export class AppModel extends Observable {
  static readonly currentProjectKey = "progetto.corrente";
  static readonly settingsKey = "impostazioni.anonimizzazione";
  static readonly lastBackupKey = "copia.ultima";
  static readonly guideSeenKey = "guida.vista";
  /// Senza progetto aperto le sezioni non si vedono: questo identificativo non arriva mai a un file.
  static readonly noProject = "00000000-0000-0000-0000-000000000000";

  declare engineState: EngineState;
  declare vaultState: VaultState;
  /// Il dizionario com'è adesso (per la vista Dizionario e i conteggi).
  declare vault: Vault;
  /// Il CRM com'è adesso.
  declare crm: CRMDatabase;
  /// Un messaggio da mostrare (errori di lettura, salvataggio, motore).
  declare alert: string | null;
  declare section: AppSection;
  declare companiesPath: CRMRoute[];
  declare documentsPath: CRMRoute[];
  /// I progetti, dal più recente, e quello aperto (null: la schermata dei progetti).
  declare projects: Project[];
  /// La chat a destra.
  declare showsChat: boolean;
  /// Quanto c'è in tutti i progetti (per la copia di sicurezza), aggiornato quando serve.
  declare totals: BackupSummary | null;
  declare backupStep: BackupStep | null;
  /// I documenti che il motore sta anonimizzando.
  declare busyDocuments: ReadonlySet<string>;
  /// Il cliente con cui filtrare il dizionario (null: tutti).
  declare dictionaryClient: string | null;
  /// La guida (al primo avvio o da Aiuto).
  declare showsGuide: boolean;
  /// La guida chiede di creare subito un progetto.
  declare requestsNewProject: boolean;
  /// Su Windows Impostazioni e «Informazioni su» sono finestre dentro l'app.
  declare showsSettings: boolean;
  declare showsAbout: boolean;

  readonly chat = new ChatState();
  readonly updates: UpdateState;
  /// La versione dell'app (da `Platform.version()`, letta all'avvio).
  appVersion = "?";

  // Non osservati (come @ObservationIgnored).
  readonly platform: PlatformAPI;
  readonly preferences: Preferences;
  engine: PIIEngine | null = null;
  readonly folder: SecureFolder;
  readonly projectStore: ProjectStore;
  /** @internal */ started = false;
  /** @internal */ timers: ReturnType<typeof setInterval>[] = [];
  /** @internal */ unsubscribeMenu: (() => void) | null = null;
  /// I banchi «Anonimizza» e «Riconverti» di ogni progetto (restano com'erano quando si torna al progetto).
  /** @internal */ workspaces = new Map<string, { anonymize: Workspace; reveal: Workspace }>();
  readonly #options: AppModelOptions;
  #settings: AnonymizationSettings;
  #currentProjectID: string | null = null;
  #lastBackup: Date | null;

  constructor(platform: PlatformAPI, options: AppModelOptions = {}) {
    super();
    this.platform = platform;
    this.#options = options;
    this.preferences = new Preferences(platform);
    this.updates = new UpdateState(this.preferences);
    this.folder = options.folder ?? new SecureFolder();
    this.projectStore = new ProjectStore(this.folder);
    this.#settings = AppModel.loadSettings(this.preferences);
    this.#lastBackup = this.preferences.date(AppModel.lastBackupKey);
    observed<AppModel, AppModelField>(this, {
      engineState: { kind: "loading" },
      vaultState: { kind: "opening" },
      vault: new Vault(),
      crm: new CRMDatabase(),
      alert: null,
      section: "anonymize",
      companiesPath: [],
      documentsPath: [],
      projects: [],
      showsChat: false,
      totals: null,
      backupStep: null,
      busyDocuments: new Set<string>(),
      dictionaryClient: null,
      showsGuide: false,
      requestsNewProject: false,
      showsSettings: false,
      showsAbout: false,
    });
  }

  get settings(): AnonymizationSettings {
    return this.#settings;
  }

  /// Le impostazioni si salvano a ogni cambio (assegnare un oggetto nuovo, o usare `updateSettings`).
  set settings(value: AnonymizationSettings) {
    this.#settings = value;
    this.saveSettings();
    this.changed();
  }

  /// Cambia una copia delle impostazioni e la salva.
  updateSettings(body: (settings: AnonymizationSettings) => void): void {
    const copy = AnonymizationSettings.fromJSON(this.#settings.toJSON());
    body(copy);
    this.settings = copy;
  }

  get currentProjectID(): string | null {
    return this.#currentProjectID;
  }

  set currentProjectID(value: string | null) {
    this.#currentProjectID = value;
    this.preferences.set(AppModel.currentProjectKey, value);
    this.changed();
  }

  get lastBackup(): Date | null {
    return this.#lastBackup;
  }

  set lastBackup(value: Date | null) {
    this.#lastBackup = value;
    this.preferences.set(AppModel.lastBackupKey, value);
    this.changed();
  }

  get isVaultReady(): boolean {
    return this.vaultState.kind === "ready";
  }

  // MARK: Il progetto aperto

  get currentProject(): Project | null {
    return this.projects.find((project) => project.id === this.currentProjectID) ?? null;
  }

  get hasProject(): boolean {
    return this.currentProject !== null;
  }

  /// Gli archivi del progetto aperto.
  get space(): ProjectSpace {
    return this.projectStore.space(this.currentProjectID ?? AppModel.noProject);
  }

  get store(): VaultStore {
    return this.space.vault;
  }

  get crmStore(): CRMStore {
    return this.space.crm;
  }

  get chatStore(): ChatStore {
    return this.space.chat;
  }

  private spaces(id: string): { anonymize: Workspace; reveal: Workspace } {
    const existing = this.workspaces.get(id);
    if (existing) return existing;
    const created = { anonymize: new Workspace("anonymize"), reveal: new Workspace("reveal") };
    this.workspaces.set(id, created);
    return created;
  }

  removeWorkspaces(id: string): void {
    this.workspaces.delete(id);
  }

  get anonymizeSpace(): Workspace {
    return this.spaces(this.currentProjectID ?? AppModel.noProject).anonymize;
  }

  get revealSpace(): Workspace {
    return this.spaces(this.currentProjectID ?? AppModel.noProject).reveal;
  }

  // MARK: Avvio

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.unsubscribeMenu = this.platform.onMenu((command) => this.handleMenu(command));
    try {
      this.appVersion = await this.platform.version();
    } catch {
      // Resta «?».
    }
    // La chiave dei dati la custodisce Windows (DPAPI), se c'è; altrimenti il custode file, come sul Mac.
    try {
      if (this.platform.keyCustody.isAvailable()) setDefaultKeyProtection(windowsKeyProtection(this.platform.keyCustody));
    } catch (error) {
      appLog.error(`Custode della chiave non disponibile: ${describe(error)}`);
    }
    this.engine = await this.locateEngine();
    await this.openData();
    this.showGuideIfNeeded();
    this.startUpdateChecks();
    const engine = this.engine;
    if (!engine || !engine.isInstalled) {
      appLog.error(`Motore assente in ${engine?.directory ?? "?"}`);
      this.engineState = { kind: "missing" };
      return;
    }
    try {
      await engine.prepare();
      this.engineState = { kind: "ready" };
      appLog.notice("Motore pronto");
    } catch (error) {
      appLog.error(`Motore non avviato: ${describe(error)}`);
      this.engineState = { kind: "failed", message: describe(error) };
    }
    // Il motore occupa circa 700 MB: se non serve da dieci minuti si scarica, e si ricarica alla prossima richiesta.
    this.timers.push(setInterval(() => void engine.releaseIfIdle(), 120_000));
  }

  /// Il motore dentro l'app: `<risorse>/engine` installata, `<cartella windows>/engine` in sviluppo.
  private async locateEngine(): Promise<PIIEngine | null> {
    if (this.#options.engine !== undefined) return this.#options.engine;
    let directory = this.#options.engineDirectory;
    if (!directory) {
      try {
        const paths = await this.platform.paths();
        directory = join(paths.packaged ? paths.resources : paths.appPath, "engine");
      } catch {
        return null;
      }
    }
    return existsSync(directory) ? new PIIEngine(directory) : null;
  }

  /// Ferma i controlli periodici e i comandi dei menu (alla chiusura, e nelle prove).
  dispose(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.unsubscribeMenu?.();
    this.unsubscribeMenu = null;
  }

  /// Apre (o riapre, dopo un ripristino) i progetti e quello che era aperto.
  async openData(): Promise<void> {
    try {
      this.projects = await this.projectStore.reload();
      this.workspaces = new Map();
      const saved = this.preferences.string(AppModel.currentProjectKey);
      this.currentProjectID = this.projects.find((project) => project.id === saved)?.id ?? this.projects[0]?.id ?? null;
      await this.loadProject();
      this.vaultState = { kind: "ready", protection: this.folder.protection ?? "file" };
      await this.allProjectsSummary();
    } catch (error) {
      appLog.error(`Dati non aperti: ${describe(error)}`);
      this.vaultState = { kind: "failed", message: describe(error) };
    }
  }

  // MARK: Lavoro

  canRun(space: Workspace): boolean {
    if (!space.hasInput || space.isRunning || !this.isVaultReady) return false;
    return space.mode === "reveal" || this.engineState.kind !== "missing";
  }

  /// Anonimizza o riconverte quello che c'è nel banco. La promessa si chiude a lavoro finito (l'interfaccia può ignorarla).
  run(space: Workspace): Promise<void> {
    if (!this.canRun(space)) return Promise.resolve();
    if (space.mode === "anonymize" && !this.engine) {
      this.alert = EngineError.notInstalled.message;
      return Promise.resolve();
    }
    const source = space.source;
    if (source && source.isFile) return this.runFile(source, space);
    const text = space.input;
    space.isRunning = true;
    space.progress = space.mode === "anonymize" ? 0 : null;
    const controller = new AbortController();
    space.task = controller;
    const store = this.store;
    switch (space.mode) {
      case "anonymize": {
        const anonymizer = new Anonymizer(this.engine!, store);
        const settings = this.settings;
        // Quello che il CRM del progetto conosce si nasconde anche dove il motore non lo vede.
        const known = this.crm.knownValues();
        return (async () => {
          try {
            const result = await anonymizer.anonymize(text, {
              settings, known, signal: controller.signal,
              progress: (value) => {
                if (space.isRunning && space.task === controller) space.progress = value;
              },
            });
            controller.signal.throwIfAborted();
            this.show(result.text, Revealer.placeholderRanges(result.text), { kind: "anonymized", report: result.report }, text, space);
            await this.refreshVault();
          } catch (error) {
            if (!controller.signal.aborted) this.alert = describe(error);
          } finally {
            this.finish(space, controller);
          }
        })();
      }
      case "reveal":
        return (async () => {
          try {
            const result = Revealer.reveal(text, await store.snapshot());
            controller.signal.throwIfAborted();
            this.show(result.text, result.spans, { kind: "revealed", result }, text, space);
          } catch (error) {
            if (!controller.signal.aborted) this.alert = describe(error);
          } finally {
            this.finish(space, controller);
          }
        })();
    }
  }

  /// CSV, Excel, Word, PDF: si lavora sul file intero, e ne esce un file dello stesso formato.
  private runFile(source: OpenedFile, space: Workspace): Promise<void> {
    space.isRunning = true;
    space.progress = space.mode === "anonymize" ? 0 : null;
    const ext = pathExtension(source.path);
    const controller = new AbortController();
    space.task = controller;
    const store = this.store;
    switch (space.mode) {
      case "anonymize": {
        const anonymizer = new Anonymizer(this.engine!, store);
        const settings = this.settings;
        const known = this.crm.knownValues();
        return (async () => {
          try {
            const outcome = await anonymizeFile(anonymizer, source.data, source.format, {
              fileExtension: ext, settings, known, signal: controller.signal,
              progress: (value) => {
                if (space.isRunning && space.task === controller) space.progress = value;
              },
            });
            controller.signal.throwIfAborted();
            const plain = DocumentPreview.plainText(outcome.preview);
            this.showFile(outcome, Revealer.placeholderRanges(plain),
              { kind: "anonymized", report: outcome.report ?? new AnonymizationReport([], 0) }, space);
            await this.refreshVault();
            // Un file anonimizzato in un progetto entra da solo nei suoi documenti, e le persone nel suo CRM.
            space.projectNote = await this.archive(source.data, source.format, source.name, outcome.data, plain, outcome.report ?? null);
          } catch (error) {
            if (!controller.signal.aborted) this.alert = describe(error);
          } finally {
            this.finish(space, controller);
          }
        })();
      }
      case "reveal":
        return (async () => {
          try {
            const vault = await store.snapshot();
            const outcome = await FileReveal.reveal(source.data, source.format, vault, ext);
            controller.signal.throwIfAborted();
            // Dove sono i dati rimessi: si riconverte l'anteprima di partenza (se coincide con quella del risultato).
            let highlights: TextRange[] = [];
            if (outcome.preview.kind === "text") {
              let inputPreview = space.inputPreview;
              if (!inputPreview) {
                try {
                  inputPreview = await FileReveal.preview(source.data, source.format, ext);
                } catch {
                  inputPreview = null;
                }
              }
              const revealed = Revealer.reveal(inputPreview ? DocumentPreview.plainText(inputPreview) : "", vault);
              if (revealed.text === DocumentPreview.plainText(outcome.preview)) highlights = revealed.spans;
            }
            this.showFile(outcome, highlights, { kind: "revealed", result: outcome.reveal ?? new RevealResult("") }, space);
          } catch (error) {
            if (!controller.signal.aborted) this.alert = describe(error);
          } finally {
            this.finish(space, controller);
          }
        })();
    }
  }

  cancel(space: Workspace): void {
    space.task?.abort();
  }

  private show(output: string, highlights: TextRange[], outcome: WorkspaceOutcome, input: string, space: Workspace): void {
    space.output = output;
    space.highlights = highlights;
    space.outcome = outcome;
    space.ranInput = input;
  }

  private showFile(result: FileOutcome, highlights: TextRange[], outcome: WorkspaceOutcome, space: Workspace): void {
    space.outputData = result.data;
    space.outputPreview = result.preview;
    space.recognizedPages = result.recognizedPages;
    this.show(DocumentPreview.plainText(result.preview), highlights, outcome, space.input, space);
  }

  private finish(space: Workspace, controller: AbortController): void {
    // Un lavoro più nuovo (dopo «Svuota» o un altro file) non si tocca.
    if (space.task !== controller && space.task !== null) return;
    space.task = null;
    space.isRunning = false;
    space.progress = null;
  }

  // MARK: File

  /// Apre un file (testo, Markdown, CSV, Excel, Word, PDF) e lo elabora subito: non esce niente dal PC.
  /// Anche per i file trascinati nella finestra (il percorso viene da `pathForFile`).
  open(path: string, space: Workspace): Promise<void> {
    const format = DocumentFormat.of(path);
    if (!format) {
      this.alert = FormatError.unsupported(pathExtension(path).toLowerCase()).message;
      return Promise.resolve();
    }
    try {
      const data = new Uint8Array(readFileSync(path));
      const client = space.clientID;
      space.clear();
      space.clientID = client;
      if (DocumentFormat.isText(format)) {
        const document = TextDocument.decode(data, format === "markdown" ? "markdown" : "plainText");
        space.input = document.text;
        space.source = new OpenedFile(path, format, data, document);
      } else {
        const source = new OpenedFile(path, format, data, null);
        space.source = source;
        space.task = null;
        void (async () => {
          try {
            const preview = await FileReveal.preview(data, format, pathExtension(path));
            if (space.source === source) space.inputPreview = preview;
          } catch (error) {
            if (space.source === source) this.alert = describe(error);
          }
        })();
      }
      return this.run(space);
    } catch (error) {
      this.alert = describe(error);
      return Promise.resolve();
    }
  }

  async chooseFile(space: Workspace): Promise<void> {
    const path = await FilePanels.chooseDocument(this.platform);
    if (path) await this.open(path, space);
  }

  /// Salva il risultato: con un file aperto, accanto a lui, con lo stesso formato (e la stessa codifica per il testo).
  async save(space: Workspace): Promise<void> {
    if (!space.hasOutput) return;
    const suffix = space.mode === "anonymize" ? "anonimizzato" : "riconvertito";
    let name: string;
    let data: Uint8Array;
    const source = space.source;
    if (source) {
      name = space.mode === "anonymize" ? DocumentNaming.anonymizedName(source.path, this.vault, this.settings)
        : DocumentNaming.revealedName(source.path, this.vault);
      if (source.text) {
        data = source.text.replacingText(space.output).data();
      } else {
        if (!space.outputData) return;
        data = space.outputData;
      }
    } else {
      name = `Testo (${suffix}).txt`;
      data = new TextEncoder().encode(space.output);
    }
    try {
      await FilePanels.save(this.platform, data, name, source ? dirname(source.path) : null);
    } catch (error) {
      this.alert = describe(error);
    }
  }

  /// Copia un testo negli appunti, o il risultato di un banco.
  copy(value: string | Workspace): void {
    if (typeof value === "string") {
      this.platform.copy(value);
    } else if (value.hasOutput) {
      this.platform.copy(value.output);
    }
  }

  // MARK: Dizionario

  async refreshVault(): Promise<void> {
    try {
      this.vault = await this.store.snapshot();
    } catch {
      // Come `try?`: resta il dizionario di prima.
    }
  }

  async remove(placeholders: Iterable<string>): Promise<void> {
    try {
      for (const placeholder of placeholders) await this.store.remove(placeholder);
    } catch (error) {
      this.alert = describe(error);
    }
    await this.refreshVault();
  }

  /// Mostra la cartella dei dati in Esplora file.
  showVaultInFinder(): void {
    void this.platform.showInFolder(this.folder.directory);
  }

  /// Esegue un'operazione e mostra l'eventuale errore.
  async perform(body: () => Promise<void> | void): Promise<void> {
    try {
      await body();
    } catch (error) {
      this.alert = describe(error);
    }
  }

  // MARK: Impostazioni

  private static loadSettings(preferences: Preferences): AnonymizationSettings {
    const json = preferences.object(AppModel.settingsKey);
    if (json === undefined || json === null) return new AnonymizationSettings();
    try {
      return AnonymizationSettings.fromJSON(typeof json === "string" ? JSON.parse(json) : json);
    } catch {
      return new AnonymizationSettings();
    }
  }

  private saveSettings(): void {
    this.preferences.set(AppModel.settingsKey, this.#settings.toJSON());
  }

  // MARK: La guida (da GuideView.swift)

  /// Al primo avvio la guida si apre da sola.
  showGuideIfNeeded(): void {
    if (this.preferences.bool(AppModel.guideSeenKey) !== true) this.showsGuide = true;
  }

  finishGuide(action: GuideAction | null): void {
    this.preferences.set(AppModel.guideSeenKey, true);
    this.showsGuide = false;
    if (!action) return;
    switch (action) {
      case "backup":
        // Dopo la chiusura della guida: due finestre insieme non si possono aprire.
        setTimeout(() => this.startExport(), 400);
        break;
      case "createProject":
        this.showProjects();
        this.requestsNewProject = true;
        break;
      case "anonymize":
        this.section = "anonymize";
        break;
      case "chat":
        if (this.hasProject) this.showsChat = true;
        else this.showProjects();
        break;
    }
  }

  // MARK: I menu (AnonimizzatoreApp.swift)

  /// Fa quello che fa la voce di menu del Mac. Impostazioni e «Informazioni su» si aprono dentro la finestra.
  handleMenu(command: string): void {
    switch (command as MenuCommand) {
      case "nuovo-progetto":
        if (!this.isVaultReady) return;
        this.showProjects();
        this.requestsNewProject = true;
        break;
      case "progetti":
        this.showProjects();
        break;
      case "copia":
        if (this.isVaultReady) this.startExport();
        break;
      case "ripristina":
        void this.startRestore();
        break;
      case "impostazioni":
        this.showsSettings = true;
        break;
      case "chat":
        if (this.hasProject) this.showsChat = !this.showsChat;
        break;
      case "guida":
        this.showsGuide = true;
        break;
      case "aggiornamenti":
        void this.checkForUpdates(true);
        break;
      case "informazioni":
        this.showsAbout = true;
        break;
    }
  }
}

/// L'estensione di un percorso, senza il punto (come `pathExtension`).
export function pathExtension(path: string): string {
  return extname(path).replace(/^\./, "");
}

/// Il messaggio di un errore, come `localizedDescription`.
export function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
