import { container, DecodingError, decodeArray, decodeDate, decodeEnum, decodeString, decodeUUID, encodeDate, type JSONObject, required, value } from "../crm/codable";
import { trimSpaces } from "../crm/crmModel";
import { FolderError, type SecureFolder } from "../sicurezza";
import { characterCount, newUUID } from "../sicurezza/swiftCoding";

// MARK: - Le conversazioni con GPT
//
// Ogni messaggio tiene due forme: quella vera, che vede solo l'utente, e quella anonimizzata, l'unica che esce dal PC.
// La conversazione si rimanda intera a ogni domanda (Codex non tiene memoria), sempre nella forma anonimizzata.
//
// Il JSON è quello del Mac (`JSONEncoder` di serie): date in secondi dal 2001, UUID in maiuscolo, facoltativi assenti
// quando mancano (in TypeScript `null`). Come in crmModel, ogni tipo è un'interfaccia con le sue funzioni accanto.

/// Un allegato della chat: un file, la scheda di un cliente, un documento del CRM.
export interface ChatAttachment {
  id: string;
  /// Il nome vero (solo sul PC).
  name: string;
  /// Il nome e il contenuto come sono partiti.
  sentName: string;
  sentText: string;
  /// «3 nomi, 1 IBAN» oppure vuoto.
  summary: string;
}

export const ChatAttachment = {
  create(name: string, sentName: string, sentText: string, summary: string, id: string = newUUID()): ChatAttachment {
    return { id, name, sentName, sentText, summary };
  },

  /// `Codable` sintetizzato: tutti i campi devono esserci.
  decode(json: unknown): ChatAttachment {
    const c = container(json);
    return {
      id: required(c, "id", decodeUUID),
      name: required(c, "name", decodeString),
      sentName: required(c, "sentName", decodeString),
      sentText: required(c, "sentText", decodeString),
      summary: required(c, "summary", decodeString),
    };
  },

  encode(attachment: ChatAttachment): JSONObject {
    return { id: attachment.id, name: attachment.name, sentName: attachment.sentName, sentText: attachment.sentText, summary: attachment.summary };
  },
};

export type ChatProposalStatus = "pending" | "applied" | "discarded";
const proposalStatuses = ["pending", "applied", "discarded"] as const satisfies readonly ChatProposalStatus[];

/// Una modifica a un documento del progetto, o un documento nuovo, proposta da GPT. Il contenuto è anonimizzato.
export interface ChatProposal {
  id: string;
  /// Il documento da modificare; null per un documento nuovo.
  documentID: string | null;
  /// Il titolo con i segnaposto (per un documento nuovo è quello scritto da GPT).
  sentTitle: string;
  /// Il testo completo proposto, con i segnaposto.
  content: string;
  status: ChatProposalStatus;
}

export const ChatProposal = {
  create(documentID: string | null, sentTitle: string, content: string): ChatProposal {
    return { id: newUUID(), documentID, sentTitle, content, status: "pending" };
  },

  /// `Codable` sintetizzato: tutto obbligatorio tranne `documentID`.
  decode(json: unknown): ChatProposal {
    const c = container(json);
    return {
      id: required(c, "id", decodeUUID),
      documentID: optional(c, "documentID", decodeUUID),
      sentTitle: required(c, "sentTitle", decodeString),
      content: required(c, "content", decodeString),
      status: required(c, "status", decodeEnum(proposalStatuses)),
    };
  },

  encode(proposal: ChatProposal): JSONObject {
    const json: JSONObject = { id: proposal.id };
    if (proposal.documentID !== null) json.documentID = proposal.documentID;
    json.sentTitle = proposal.sentTitle;
    json.content = proposal.content;
    json.status = proposal.status;
    return json;
  },

  isNewDocument(proposal: ChatProposal): boolean {
    return proposal.documentID === null;
  },
};

export type ChatRole = "user" | "assistant";
const roles = ["user", "assistant"] as const satisfies readonly ChatRole[];

export interface ChatMessage {
  id: string;
  role: ChatRole;
  date: Date;
  /// Il testo con i dati veri: quello scritto dall'utente, o la risposta riconvertita.
  text: string;
  /// Il testo con i segnaposto: quello partito, o la risposta così come è arrivata.
  sent: string;
  attachments: ChatAttachment[];
  /// Cosa è stato nascosto (domande) o rimesso (risposte).
  summary: string;
  /// Segnaposto che il dizionario non conosce (inventati da GPT): restano come sono.
  unknown: string[];
  /// Le modifiche ai documenti (o i documenti nuovi) che GPT propone: si applicano solo con la conferma.
  proposals: ChatProposal[];
  /// I documenti del progetto che GPT ha letto per rispondere (titoli veri).
  readDocuments: string[];
}

export const ChatMessage = {
  create(
    role: ChatRole,
    text: string,
    sent: string,
    options: Partial<Omit<ChatMessage, "role" | "text" | "sent">> = {},
  ): ChatMessage {
    return {
      id: options.id ?? newUUID(),
      role,
      date: options.date ?? new Date(),
      text,
      sent,
      attachments: options.attachments ?? [],
      summary: options.summary ?? "",
      unknown: options.unknown ?? [],
      proposals: options.proposals ?? [],
      readDocuments: options.readDocuments ?? [],
    };
  },

  /// Lettura tollerante: solo `id` e `role` sono obbligatori.
  decode(json: unknown): ChatMessage {
    const c = container(json);
    return {
      id: required(c, "id", decodeUUID),
      role: required(c, "role", decodeEnum(roles)),
      date: value(c, "date", decodeDate, new Date()),
      text: value(c, "text", decodeString, ""),
      sent: value(c, "sent", decodeString, ""),
      attachments: value(c, "attachments", decodeArray(ChatAttachment.decode), []),
      summary: value(c, "summary", decodeString, ""),
      unknown: value(c, "unknown", decodeArray(strictString), []),
      proposals: value(c, "proposals", decodeArray(ChatProposal.decode), []),
      readDocuments: value(c, "readDocuments", decodeArray(strictString), []),
    };
  },

  encode(message: ChatMessage): JSONObject {
    return {
      id: message.id,
      role: message.role,
      date: encodeDate(message.date),
      text: message.text,
      sent: message.sent,
      attachments: message.attachments.map(ChatAttachment.encode),
      summary: message.summary,
      unknown: [...message.unknown],
      proposals: message.proposals.map(ChatProposal.encode),
      readDocuments: [...message.readDocuments],
    };
  },
};

export interface ChatConversation {
  id: string;
  title: string;
  /// Il cliente del CRM a cui legare i dati trovati (e le note salvate).
  clientID: string | null;
  created: Date;
  updated: Date;
  messages: ChatMessage[];
}

export const ChatConversation = {
  create(options: { id?: string; title?: string; clientID?: string | null; created?: Date; messages?: ChatMessage[] } = {}): ChatConversation {
    const created = options.created ?? new Date();
    return {
      id: options.id ?? newUUID(),
      title: options.title ?? "",
      clientID: options.clientID ?? null,
      created,
      updated: created,
      messages: options.messages ?? [],
    };
  },

  /// `Codable` sintetizzato: tutto obbligatorio tranne `clientID`.
  decode(json: unknown): ChatConversation {
    const c = container(json);
    const messages = c.messages;
    if (!Array.isArray(messages)) throw new DecodingError("campo «messages» mancante o non valido");
    return {
      id: required(c, "id", decodeUUID),
      title: required(c, "title", decodeString),
      clientID: optional(c, "clientID", decodeUUID),
      created: required(c, "created", decodeDate),
      updated: required(c, "updated", decodeDate),
      messages: messages.map(ChatMessage.decode),
    };
  },

  encode(conversation: ChatConversation): JSONObject {
    const json: JSONObject = { id: conversation.id, title: conversation.title };
    if (conversation.clientID !== null) json.clientID = conversation.clientID;
    json.created = encodeDate(conversation.created);
    json.updated = encodeDate(conversation.updated);
    json.messages = conversation.messages.map(ChatMessage.encode);
    return json;
  },

  /// Il titolo da mostrare: quello scelto, o l'inizio della prima domanda.
  displayTitle(conversation: ChatConversation): string {
    if (trimSpaces(conversation.title).length > 0) return conversation.title;
    const first = conversation.messages.find((message) => message.role === "user");
    if (!first) return "Nuova conversazione";
    const line = trimSpaces(nonEmptyLines(first.text)[0] ?? "");
    if (line.length === 0) return first.attachments[0]?.name ?? "Nuova conversazione";
    return characterCount(line) > 60 ? graphemePrefix(line, 59) + "…" : line;
  },

  /// Un elenco di conversazioni dai byte del file («[ChatConversation]» in JSON).
  decodeList(data: Uint8Array): ChatConversation[] {
    const json: unknown = JSON.parse(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8"));
    if (!Array.isArray(json)) throw new DecodingError("mi aspettavo un elenco di conversazioni");
    return json.map(ChatConversation.decode);
  },

  /// I byte del file, come `JSONEncoder().encode([ChatConversation])`.
  encodeList(conversations: readonly ChatConversation[]): Buffer {
    return Buffer.from(JSON.stringify(conversations.map(ChatConversation.encode)), "utf8");
  },

  /// Una copia indipendente (il valore di una struttura Swift).
  clone(conversation: ChatConversation): ChatConversation {
    return ChatConversation.decode(JSON.parse(JSON.stringify(ChatConversation.encode(conversation))));
  },
};

/// `decodeIfPresent`: assente o null → null; presente ma del tipo sbagliato → errore (come Swift).
function optional<T>(c: JSONObject, key: string, decode: (value: unknown) => T | null): T | null {
  const raw = c[key];
  if (raw === undefined || raw === null) return null;
  const decoded = decode(raw);
  if (decoded === null) throw new DecodingError(`campo «${key}» non valido`);
  return decoded;
}

function strictString(value: unknown): string {
  if (typeof value !== "string") throw new DecodingError("mi aspettavo un testo");
  return value;
}

/// `text.split(whereSeparator: \.isNewline)`: le righe non vuote.
export function nonEmptyLines(text: string): string[] {
  return text.split(/[\n\r\v\f\u0085\u2028\u2029]+/u).filter((line) => line.length > 0);
}

/// I primi `count` caratteri come li conta Swift (grafemi).
export function graphemePrefix(text: string, count: number): string {
  let result = "";
  let taken = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    if (taken === count) break;
    result += segment;
    taken += 1;
  }
  return result;
}

// MARK: - Su disco, cifrate

/// Quello che serve della cartella cifrata (`SecureFolder`).
export type ChatFolder = Pick<SecureFolder, "read" | "write" | "unlock">;

/// Le conversazioni stanno nella cartella cifrata dell'app (`chat.sigillato`), insieme a dizionario e CRM, e finiscono
/// nella copia di sicurezza. Come l'attore di Swift: le operazioni passano una alla volta e chi chiama riceve copie.
export class ChatStore {
  static readonly fileName = "chat";

  readonly folder: ChatFolder;
  /// Il file cifrato delle conversazioni («chat», o quello di un progetto).
  readonly fileName: string;
  private conversations: ChatConversation[] = [];
  private isOpen = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(folder: ChatFolder, fileName: string = ChatStore.fileName) {
    this.folder = folder;
    this.fileName = fileName;
  }

  private exclusive<T>(body: () => T): Promise<T> {
    const run = this.queue.then(body, body);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private openUnlocked(): ChatConversation[] {
    if (!this.isOpen) {
      const data = this.folder.read(this.fileName);
      if (data !== null) {
        try {
          this.conversations = ChatConversation.decodeList(data);
        } catch (error) {
          throw FolderError.unreadable(this.fileName, error instanceof Error ? error.message : String(error));
        }
      } else {
        this.folder.unlock();
      }
      this.isOpen = true;
    }
    return this.conversations.map(ChatConversation.clone).sort((a, b) => b.updated.getTime() - a.updated.getTime());
  }

  /// Le conversazioni, dalla più recente.
  open(): Promise<ChatConversation[]> {
    return this.exclusive(() => this.openUnlocked());
  }

  /// Salva (o aggiunge) una conversazione.
  save(conversation: ChatConversation): Promise<ChatConversation[]> {
    return this.exclusive(() => {
      const copy = this.openUnlocked();
      const index = copy.findIndex((item) => item.id === conversation.id);
      if (index >= 0) copy[index] = ChatConversation.clone(conversation);
      else copy.push(ChatConversation.clone(conversation));
      this.write(copy);
      return this.openUnlocked();
    });
  }

  delete(id: string): Promise<ChatConversation[]> {
    return this.exclusive(() => {
      this.write(this.openUnlocked().filter((conversation) => conversation.id !== id));
      return this.openUnlocked();
    });
  }

  /// Un cliente cancellato dal CRM: le sue conversazioni restano, senza il legame.
  unlink(client: string): Promise<ChatConversation[]> {
    return this.exclusive(() => {
      const copy = this.openUnlocked().map((conversation) =>
        conversation.clientID === client ? { ...conversation, clientID: null } : conversation,
      );
      this.write(copy);
      return this.openUnlocked();
    });
  }

  /// Dopo un ripristino: rilegge dal disco.
  reload(): Promise<ChatConversation[]> {
    return this.exclusive(() => {
      this.isOpen = false;
      this.conversations = [];
      return this.openUnlocked();
    });
  }

  private write(copy: ChatConversation[]): void {
    const data = ChatConversation.encodeList(copy);
    if (data.equals(ChatConversation.encodeList(this.conversations))) return;
    this.folder.write(data, this.fileName);
    this.conversations = copy;
  }
}
