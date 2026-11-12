import { newUUID } from "../core/sicurezza";
import type { ChatConversation, ChatInput, CodexModel, CodexStatus } from "../core/chat";
import { Observable } from "../shared/observable";
import { observed } from "./observed";

// MARK: - Lo stato della chat, nel pannello a destra
//
// Ogni progetto ha le sue conversazioni. Domanda e allegati passano dal motore di anonimizzazione prima di partire; la
// risposta torna con i dati veri.

/// Un allegato pronto per la prossima domanda (non ancora anonimizzato).
export class PendingAttachment {
  readonly id = newUUID();

  constructor(
    /// Il simbolo del formato (nomi dei simboli del Mac: «doc.text», «tablecells»…).
    readonly symbol: string,
    readonly input: ChatInput,
  ) {}

  get name(): string {
    return this.input.name;
  }
}

export type ChatPhase =
  | { kind: "anonymizing" }
  | { kind: "waiting" }
  /// GPT ha chiesto dei documenti: si leggono (anonimizzati).
  | { kind: "reading"; titles: string[] };

/// Collegare l'account: installare Codex (se manca) e fare l'accesso nel browser.
export type ChatGPTConnection = { kind: "installing" } | { kind: "waitingForBrowser"; url: string | null };

export class ChatState extends Observable {
  declare conversations: ChatConversation[];
  declare selectedID: string | null;
  declare draft: string;
  declare pending: PendingAttachment[];
  declare phase: ChatPhase | null;
  /// Cambia quando si sceglie un altro modello (per aggiornare chi lo mostra).
  declare modelRevision: number;
  /// L'ultimo errore, mostrato sotto la conversazione.
  declare error: string | null;
  declare codexStatus: CodexStatus | null;
  /// I modelli che si possono scegliere (terra, luna e sol dalla versione 6), dal catalogo di Codex.
  declare models: CodexModel[];
  /// Mentre si collega l'account ChatGPT.
  declare connection: ChatGPTConnection | null;
  declare connectionError: string | null;
  connectionTask: AbortController | null = null;
  task: AbortController | null = null;

  constructor() {
    super();
    observed<ChatState, "conversations" | "selectedID" | "draft" | "pending" | "phase" | "modelRevision" | "error" | "codexStatus" | "models" | "connection" | "connectionError">(this, {
      conversations: [],
      selectedID: null,
      draft: "",
      pending: [],
      phase: null,
      modelRevision: 0,
      error: null,
      codexStatus: null,
      models: [],
      connection: null,
      connectionError: null,
    });
  }

  get selected(): ChatConversation | null {
    return this.conversations.find((conversation) => conversation.id === this.selectedID) ?? null;
  }

  get isBusy(): boolean {
    return this.phase !== null;
  }

  get hasDraft(): boolean {
    return this.draft.trim().length > 0 || this.pending.length > 0;
  }
}
