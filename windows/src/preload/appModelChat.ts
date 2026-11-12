import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Anonymizer, Revealer } from "../core/anonimizzazione";
import { Activity, ClientDossier, CRMDocument } from "../core/crm";
import { DocumentFormat, DocumentPreview, FileReveal, FormatError, TextDocument } from "../core/documenti";
import { EngineError } from "../core/motore";
import {
  ChatConversation, ChatInput, ChatProposal, ChatShield, CodexClient, CodexError, CodexModel, ProjectAgent, chatMessage,
  type AgentDocument, type ChatMessage, type ChatProposalStatus,
} from "../core/chat";
import { Format } from "../shared/format";
import { AppModel, appLog, describe, pathExtension } from "./appModel";
import { PendingAttachment } from "./chatState";
import { FilePanels } from "./filePanels";

// MARK: - La chat con GPT, nel pannello a destra
//
// Ogni progetto ha le sue conversazioni. Domanda e allegati passano dal motore di anonimizzazione prima di partire; GPT
// vede l'elenco dei documenti del progetto (titoli anonimizzati), chiede di leggerli e propone modifiche o documenti
// nuovi, che diventano versioni solo con la conferma. La risposta torna con i dati veri. GPT è quello
// dell'abbonamento ChatGPT dell'utente, via Codex.

declare module "./appModel" {
  interface AppModel {
    /// Il modello scelto, se è fra quelli ammessi; altrimenti il primo della lista.
    readonly chatModel: CodexModel | null;
    /// Il ragionamento scelto (null: quello predefinito del modello).
    readonly chatEffort: string | null;
    readonly codexClient: CodexClient;
    refreshCodexStatus(): Promise<void>;
    /// Sceglie il modello; il ragionamento torna quello predefinito se il nuovo modello non lo accetta.
    chooseChatModel(slug: string): void;
    /// Sceglie il ragionamento (null: quello predefinito).
    chooseChatEffort(effort: string | null): void;

    // Conversazioni
    newConversation(): void;
    select(conversationID: string | null): void;
    deleteConversation(id: string): Promise<void>;

    // Allegati
    /// Sceglie uno o più file da allegare.
    attachFiles(): Promise<void>;
    /// Allega dei file (anche trascinati nella finestra).
    attach(paths: readonly string[]): void;
    /// La scheda di un'azienda del progetto (anagrafica, persone, trattative, note, documenti).
    attachDossier(companyID: string): void;
    /// Un documento del progetto: parte l'originale, anonimizzato adesso con il dizionario del progetto.
    attachDocument(document: CRMDocument): Promise<void>;
    removePending(id: string): void;

    // Domanda e risposta
    readonly canSendChat: boolean;
    /// Anonimizza la domanda con i suoi allegati, la salva e la manda a GPT.
    sendChat(): Promise<void>;
    /// Rimanda l'ultima domanda rimasta senza risposta (già anonimizzata).
    retryChat(): Promise<void>;
    cancelChat(): void;
    /// Il testo anonimizzato più recente di un documento; se non è ancora stato anonimizzato, lo si anonimizza adesso.
    anonymizedText(documentID: string): Promise<string>;

    // Le proposte di GPT
    /// Applica una proposta: una modifica diventa una nuova versione del documento, un documento nuovo entra nel progetto.
    apply(proposal: ChatProposal, messageID: string): Promise<void>;
    discard(proposal: ChatProposal, messageID: string): Promise<void>;
    /// Il documento creato da una proposta applicata (per aprirlo).
    document(proposal: ChatProposal): CRMDocument | null;

    // Le risposte nel CRM
    /// Una risposta di GPT (con i dati veri) diventa una nota del progetto.
    saveAsNote(message: ChatMessage): Promise<void>;
    /// La conversazione in Markdown, con i dati veri.
    exportConversation(conversation: ChatConversation): Promise<void>;

    // Il proprio account ChatGPT
    /// Ognuno collega il proprio abbonamento ChatGPT: se serve installa Codex, poi apre l'accesso di OpenAI nel browser.
    connectChatGPT(): Promise<void>;
    cancelChatGPTConnection(): void;
    /// Toglie l'account ChatGPT da questo PC (le conversazioni restano).
    disconnectChatGPT(): Promise<void>;
  }
}

export const chatModelKey = "chat.modello";
export const chatEffortKey = "chat.ragionamento";

const proto = AppModel.prototype;

Object.defineProperties(proto, {
  chatModel: {
    configurable: true,
    get(this: AppModel): CodexModel | null {
      const saved = this.preferences.string(chatModelKey);
      return this.chat.models.find((model) => model.slug === saved) ?? this.chat.models[0] ?? null;
    },
  },
  chatEffort: {
    configurable: true,
    get(this: AppModel): string | null {
      return this.preferences.string(chatEffortKey);
    },
  },
  codexClient: {
    configurable: true,
    get(this: AppModel): CodexClient {
      const saved = this.preferences.string(chatModelKey);
      const chosen = this.chatModel;
      // Solo terra, luna e sol dalla versione 6: se il catalogo non si legge, vale il nome salvato solo se ammesso.
      const model = chosen?.slug ?? (saved !== null && CodexModel.isAllowed(saved) ? saved : null);
      const savedEffort = this.preferences.string(chatEffortKey);
      const effort = savedEffort !== null && (chosen ? chosen.efforts.includes(savedEffort) : true) ? savedEffort : null;
      return new CodexClient(model, effort);
    },
  },
  canSendChat: {
    configurable: true,
    get(this: AppModel): boolean {
      return this.chat.hasDraft && !this.chat.isBusy && this.isVaultReady && this.engine !== null && this.engineState.kind !== "missing";
    },
  },
});

proto.refreshCodexStatus = async function (this: AppModel) {
  this.chat.codexStatus = await CodexClient.status();
  this.chat.models = await CodexClient.models();
};

proto.chooseChatModel = function (this: AppModel, slug: string) {
  this.preferences.set(chatModelKey, slug);
  const effort = this.preferences.string(chatEffortKey);
  const model = this.chat.models.find((item) => item.slug === slug);
  if (effort !== null && model && !model.efforts.includes(effort)) this.preferences.set(chatEffortKey, null);
  this.chat.modelRevision += 1;
};

proto.chooseChatEffort = function (this: AppModel, effort: string | null) {
  this.preferences.set(chatEffortKey, effort);
  this.chat.modelRevision += 1;
};

// MARK: Conversazioni

proto.newConversation = function (this: AppModel) {
  if (this.chat.isBusy) return;
  this.chat.selectedID = null;
  this.chat.error = null;
};

proto.select = function (this: AppModel, conversationID: string | null) {
  if (this.chat.isBusy) return;
  this.chat.selectedID = conversationID;
  this.chat.error = null;
};

proto.deleteConversation = async function (this: AppModel, id: string) {
  await this.perform(async () => {
    this.chat.conversations = await this.chatStore.delete(id);
  });
  if (this.chat.selectedID === id) this.chat.selectedID = null;
};

// MARK: Allegati

proto.attachFiles = async function (this: AppModel) {
  const paths = await this.platform.chooseFiles({
    title: "Allega uno o più file: si anonimizzano prima di partire",
    filters: FilePanels.documentFilters,
  });
  if (paths.length > 0) this.attach(paths);
};

proto.attach = function (this: AppModel, paths: readonly string[]) {
  const added: PendingAttachment[] = [];
  for (const path of paths) {
    const format = DocumentFormat.of(path);
    if (!format) {
      this.chat.error = FormatError.unsupported(pathExtension(path).toLowerCase()).message;
      continue;
    }
    try {
      const data = new Uint8Array(readFileSync(path));
      added.push(new PendingAttachment(DocumentFormat.symbol(format), ChatInput.file(basename(path), data, format, pathExtension(path))));
    } catch (error) {
      this.chat.error = describe(error);
    }
  }
  if (added.length > 0) this.chat.pending = [...this.chat.pending, ...added];
};

proto.attachDossier = function (this: AppModel, companyID: string) {
  const company = this.crm.company(companyID);
  const markdown = ClientDossier.markdown(companyID, this.crm);
  if (!company || markdown === null) return;
  this.chat.pending = [...this.chat.pending, new PendingAttachment("person.text.rectangle", ChatInput.text(`Scheda di ${company.name}`, markdown))];
};

proto.attachDocument = async function (this: AppModel, document: CRMDocument) {
  const original = CRMDocument.original(document);
  if (!original) return;
  try {
    const data = await this.crmStore.data(original);
    const format = CRMDocument.formatOf(document, original);
    const fileExtension = original.fileName.length === 0 ? DocumentFormat.defaultExtension(format) : pathExtension(original.fileName);
    this.chat.pending = [
      ...this.chat.pending,
      new PendingAttachment(DocumentFormat.symbol(format), ChatInput.file(`${document.title}.${fileExtension}`, data, format, fileExtension)),
    ];
  } catch (error) {
    this.chat.error = describe(error);
  }
};

proto.removePending = function (this: AppModel, id: string) {
  this.chat.pending = this.chat.pending.filter((item) => item.id !== id);
};

// MARK: Domanda e risposta

proto.sendChat = async function (this: AppModel) {
  const engine = this.engine;
  if (!this.canSendChat || !engine) return;
  const chat = this.chat;
  const conversation = chat.selected ? ChatConversation.clone(chat.selected) : ChatConversation.create();
  const text = chat.draft.trim();
  const inputs = chat.pending.map((item) => item.input);
  const known = this.crm.knownValues();
  const store = this.store;
  const chatStore = this.chatStore;
  const anonymizer = new Anonymizer(engine, store);
  const settings = this.settings;
  const controller = new AbortController();
  chat.error = null;
  chat.phase = { kind: "anonymizing" };
  chat.task = controller;
  try {
    const message = await chatMessage(anonymizer, text, { inputs, settings, known, signal: controller.signal });
    controller.signal.throwIfAborted();
    conversation.messages.push(message);
    conversation.updated = new Date();
    chat.conversations = await chatStore.save(conversation);
    chat.selectedID = conversation.id;
    chat.draft = "";
    chat.pending = [];
    await this.refreshVault();
    await ask(this, conversation, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) chatFailed(this, error);
  } finally {
    finishChat(this, controller);
  }
};

proto.retryChat = async function (this: AppModel) {
  const chat = this.chat;
  const conversation = chat.selected;
  if (!conversation || conversation.messages.at(-1)?.role !== "user" || chat.isBusy) return;
  const controller = new AbortController();
  chat.error = null;
  chat.phase = { kind: "waiting" };
  chat.task = controller;
  try {
    await ask(this, conversation, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) chatFailed(this, error);
  } finally {
    finishChat(this, controller);
  }
};

proto.cancelChat = function (this: AppModel) {
  this.chat.task?.abort();
};

/// Manda a GPT la conversazione con l'elenco dei documenti del progetto. Se GPT chiede dei documenti, gli si mandano
/// (anonimizzati) e continua, per qualche giro. Le proposte diventano schede da applicare; la risposta si salva
/// riconvertita.
async function ask(model: AppModel, conversation: ChatConversation, signal: AbortSignal): Promise<void> {
  const question = conversation.messages.at(-1);
  if (!question || question.role !== "user") return;
  const chat = model.chat;
  const store = model.store;
  const chatStore = model.chatStore;
  chat.phase = { kind: "waiting" };
  const catalog = await agentCatalog(model);
  const instructions = ProjectAgent.instructions(catalog.projectName, catalog.documents);
  const steps: string[] = [];
  const readIDs: string[] = [];
  let reply = "";
  const client = model.codexClient;
  for (let round = 0; round < ProjectAgent.maxRounds; round++) {
    const transcript = ChatShield.transcript(conversation.messages.slice(0, -1), question, instructions, steps);
    reply = await client.send(transcript, signal);
    signal.throwIfAborted();
    const wanted = ProjectAgent.parse(reply).reads
      .map((ref) => catalog.documents.find((document) => document.ref === ref))
      .filter((document): document is AgentDocument => document !== undefined && !readIDs.includes(document.id));
    if (wanted.length === 0 || round >= ProjectAgent.maxRounds - 1) break;
    chat.phase = { kind: "reading", titles: wanted.map((document) => model.crm.document(document.id)?.title).filter((t): t is string => !!t) };
    const items: { document: AgentDocument; text: string }[] = [];
    for (const document of wanted) {
      items.push({ document, text: await model.anonymizedText(document.id) });
      readIDs.push(document.id);
    }
    signal.throwIfAborted();
    steps.push("Assistente: " + reply);
    steps.push("Documenti richiesti:\n" + ProjectAgent.documentsBlock(items));
    chat.phase = { kind: "waiting" };
  }
  const parsed = ProjectAgent.parse(reply);
  const proposals: ChatProposal[] = [];
  for (const item of parsed.proposals) {
    if (item.ref === null) {
      proposals.push(ChatProposal.create(null, item.title, item.content));
      continue;
    }
    const document = catalog.documents.find((entry) => entry.ref === item.ref);
    if (document) proposals.push(ChatProposal.create(document.id, document.title, item.content));
  }
  const answer = ChatShield.reveal(parsed.text, await store.snapshot());
  // Nella conversazione che si rimanda a GPT bastano i titoli delle proposte, non i documenti interi.
  const noted = proposals.map((proposal) => ChatProposal.isNewDocument(proposal)
    ? `[proposto il documento nuovo «${proposal.sentTitle}»]` : `[proposta una modifica a «${proposal.sentTitle}»]`);
  answer.sent = [parsed.text, ...noted].filter((part) => part.length > 0).join("\n");
  answer.proposals = proposals;
  answer.readDocuments = readIDs.map((id) => model.crm.document(id)?.title).filter((t): t is string => !!t);
  // La conversazione può essere cambiata intanto: si aggiunge la risposta a quella salvata.
  const saved = chat.conversations.find((item) => item.id === conversation.id);
  const current = ChatConversation.clone(saved ?? conversation);
  current.messages.push(answer);
  current.updated = new Date();
  chat.conversations = await chatStore.save(current);
}

/// I documenti del progetto per GPT: riferimenti D1, D2… e titoli anonimizzati (anche il nome del progetto).
async function agentCatalog(model: AppModel): Promise<{ projectName: string; documents: AgentDocument[] }> {
  const documents = [...model.crm.documents].sort((a, b) => b.updated.getTime() - a.updated.getTime());
  const engine = model.engine;
  if (!engine) throw EngineError.notInstalled;
  const anonymizer = new Anonymizer(engine, model.store);
  const names = [model.currentProject?.name ?? "Progetto", ...documents.map((document) => document.title)];
  const joined = (await anonymizer.anonymize(names.join("\n"), { settings: model.settings, known: model.crm.knownValues(), matching: "loose" })).text;
  let titles = joined.split("\n");
  if (titles.length !== names.length) titles = ["Progetto", ...documents.map((_, index) => `Documento ${index + 1}`)];
  const catalog = documents.map((document, index): AgentDocument => ({
    ref: `D${index + 1}`, id: document.id, title: titles[index + 1], format: document.format,
  }));
  return { projectName: titles[0], documents: catalog };
}

proto.anonymizedText = async function (this: AppModel, documentID: string) {
  let document = this.crm.document(documentID);
  if (!document) return "";
  if (document.versions.every((version) => version.kind === "original")) {
    await this.anonymizeDocument(documentID);
    document = this.crm.document(documentID);
    if (!document) return "";
  }
  const versions = document.versions.filter((version) => version.kind !== "original");
  if (versions.length === 0) return "";
  const version = versions.reduce((latest, item) => (item.created > latest.created ? item : latest));
  const format = CRMDocument.formatOf(document, version);
  const data = await this.crmStore.data(version);
  return DocumentPreview.plainText(await FileReveal.preview(data, format, pathExtension(version.fileName)));
};

// MARK: Le proposte di GPT

proto.apply = async function (this: AppModel, proposal: ChatProposal, messageID: string) {
  const selected = this.chat.selected;
  if (!selected || proposal.status !== "pending") return;
  await this.perform(async () => {
    const crmStore = this.crmStore;
    const current = await this.store.snapshot();
    const document = proposal.documentID !== null ? this.crm.document(proposal.documentID) : null;
    if (proposal.documentID !== null && document) {
      const kind = document.format === "plainText" ? "plainText" : "markdown";
      this.crm = await crmStore.addAnswer(new TextDocument(proposal.content, kind), "", "Modifica proposta dalla chat", document.id);
    } else {
      const title = Revealer.reveal(proposal.sentTitle, current).text;
      const content = Revealer.reveal(proposal.content, current).text;
      const added = await crmStore.addTextDocument(title, new TextDocument(content, "markdown"), `${title}.md`, null);
      this.crm = await crmStore.setAnonymized(new TextDocument(proposal.content, "markdown"), "Scritto dalla chat", added.document.id);
    }
    const conversation = mark(proposal.id, messageID, selected, "applied");
    this.chat.conversations = await this.chatStore.save(conversation);
    await this.touchCurrentProject();
  });
};

proto.discard = async function (this: AppModel, proposal: ChatProposal, messageID: string) {
  const selected = this.chat.selected;
  if (!selected) return;
  await this.perform(async () => {
    this.chat.conversations = await this.chatStore.save(mark(proposal.id, messageID, selected, "discarded"));
  });
};

function mark(proposalID: string, messageID: string, conversation: ChatConversation, status: ChatProposalStatus): ChatConversation {
  const copy = ChatConversation.clone(conversation);
  const message = copy.messages.find((item) => item.id === messageID);
  const proposal = message?.proposals.find((item) => item.id === proposalID);
  if (proposal) proposal.status = status;
  return copy;
}

proto.document = function (this: AppModel, proposal: ChatProposal) {
  if (proposal.documentID !== null) return this.crm.document(proposal.documentID);
  const title = Revealer.reveal(proposal.sentTitle, this.vault).text;
  const matching = this.crm.documents.filter((document) => document.title === title);
  if (matching.length === 0) return null;
  return matching.reduce((latest, item) => (item.created > latest.created ? item : latest));
};

function chatFailed(model: AppModel, error: unknown): void {
  model.chat.error = describe(error);
  if (error instanceof CodexError && (error.code === "notInstalled" || error.code === "notLoggedIn")) {
    void model.refreshCodexStatus();
  }
}

function finishChat(model: AppModel, controller: AbortController): void {
  if (model.chat.task !== controller && model.chat.task !== null) return;
  model.chat.task = null;
  model.chat.phase = null;
}

// MARK: Le risposte nel CRM

proto.saveAsNote = function (this: AppModel, message: ChatMessage) {
  return this.saveActivity(Activity.create("note", message.text, null));
};

proto.exportConversation = async function (this: AppModel, conversation: ChatConversation) {
  const title = ChatConversation.displayTitle(conversation);
  const lines = [`# ${title}`, ""];
  for (const message of conversation.messages) {
    lines.push(message.role === "user" ? `**Tu** · ${Format.dateTime(message.date)}` : `**GPT** · ${Format.dateTime(message.date)}`);
    lines.push("");
    lines.push(message.text);
    if (message.attachments.length > 0) {
      lines.push("");
      lines.push("Allegati: " + message.attachments.map((attachment) => attachment.name).join(", "));
    }
    lines.push("");
  }
  try {
    await FilePanels.save(this.platform, new TextEncoder().encode(lines.join("\n")),
      title.replaceAll("/", "-").replaceAll(":", "-") + ".md", null);
  } catch (error) {
    this.alert = describe(error);
  }
};

// MARK: - Il proprio account ChatGPT

proto.connectChatGPT = async function (this: AppModel) {
  const chat = this.chat;
  if (chat.connection !== null) return;
  chat.error = null;
  chat.connectionError = null;
  const controller = new AbortController();
  chat.connectionTask = controller;
  try {
    if (CodexClient.executable() === null) {
      chat.connection = { kind: "installing" };
      await CodexClient.install(controller.signal);
    }
    chat.connection = { kind: "waitingForBrowser", url: null };
    await CodexClient.login((url) => {
      if (chat.connection?.kind === "waitingForBrowser") chat.connection = { kind: "waitingForBrowser", url };
    }, controller.signal);
    appLog.notice("Account ChatGPT collegato");
  } catch (error) {
    if (!controller.signal.aborted) chat.connectionError = describe(error);
  } finally {
    chat.connection = null;
    chat.connectionTask = null;
  }
  await this.refreshCodexStatus();
};

proto.cancelChatGPTConnection = function (this: AppModel) {
  this.chat.connectionTask?.abort();
};

proto.disconnectChatGPT = async function (this: AppModel) {
  try {
    await CodexClient.logout();
  } catch (error) {
    this.chat.connectionError = describe(error);
  }
  await this.refreshCodexStatus();
};
