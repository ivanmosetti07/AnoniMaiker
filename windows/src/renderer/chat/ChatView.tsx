import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  ArrowUp, BadgeHelp, Check, ChevronDown, CircleCheck, CircleX, ClipboardPen, Copy, Ellipsis, Eye, EyeOff, File, FilePlus,
  FileSearch, MessagesSquare, NotebookPen, Paperclip, Sparkle, SquarePen, TriangleAlert, Undo2, X,
} from "lucide-react";
import type { ChatConversation, ChatMessage, ChatProposal } from "../../core/chat";
import type { ChatPhase } from "../../shared/api";
import { Format } from "../../shared/format";
import { Alert, Button, Icon, Label, Spinner } from "../ui/components";
import { useObserved } from "../ui/observe";
import { highlighted, placeholderRanges } from "../views/textPane";
import { ChatGPTConnectView } from "./ChatGPTConnectView";
import { displayTitle, effortTitle, isNewDocument, reveal, symbolIcon } from "./helpers";
import { Markdown } from "./markdown";
import { ChatMenu, type ChatMenuEntry } from "./menu";
import "./chat.css";

// MARK: - La chat con GPT, a destra
//
// Un pannello che si apre accanto a ogni sezione (Ctrl+J) e lavora sul progetto aperto: GPT vede l'elenco dei suoi
// documenti, li legge quando servono (sempre anonimizzati) e propone modifiche o documenti nuovi, che si applicano con
// un clic. L'utente vede sempre i dati veri; sotto ogni messaggio c'è «cosa è partito» con i segnaposto.

export function ChatPanel() {
  const { model, pathForFile } = window.anonimaiker;
  useObserved(model);
  const chat = useObserved(model.chat);
  const scroller = useRef<HTMLDivElement>(null);
  const [dropTargeted, setDropTargeted] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    if (model.chat.codexStatus === null) void model.refreshCodexStatus();
  }, [model]);

  // In fondo quando arriva un messaggio, cambia la fase o si cambia conversazione.
  const selected = chat.selected;
  const count = selected?.messages.length ?? 0;
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [count, chat.phase, chat.selectedID, chat.error]);

  // Un file trascinato sulla chat diventa un allegato.
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  const dropHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current += 1;
      setDropTargeted(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = chat.isBusy ? "none" : "copy";
    },
    onDragLeave: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDropTargeted(false);
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDropTargeted(false);
      if (chat.isBusy) return;
      const paths = Array.from(event.dataTransfer.files, (file) => pathForFile(file)).filter((path) => path.length > 0);
      if (paths.length > 0) model.attach(paths);
    },
  };

  return (
    <div className={`chat-panel ${dropTargeted ? "drop" : ""}`} {...dropHandlers}>
      <ChatHeader />
      <div className="divider" />
      <CodexBanner />
      <div className="chat-scroll" ref={scroller}>
        <div className="chat-column">
          {selected ? selected.messages.map((message) => <MessageView key={message.id} message={message} />) : <EmptyChat />}
          <StatusRow />
        </div>
      </div>
      <div className="divider" />
      <Composer dropTargeted={dropTargeted} />
    </div>
  );
}

/// In cima: la conversazione aperta e il menu per cambiarla, una nuova, esportare o cancellare.
function ChatHeader() {
  const { model } = window.anonimaiker;
  const chat = useObserved(model.chat);
  const [deleting, setDeleting] = useState<ChatConversation | null>(null);
  const selected = chat.selected;

  const conversations: ChatMenuEntry[] = [
    { kind: "item", label: "Nuova conversazione", icon: SquarePen, onClick: () => model.newConversation() },
    ...(chat.conversations.length > 0 ? [{ kind: "separator" } as const] : []),
    ...chat.conversations.map((conversation): ChatMenuEntry => ({
      kind: "item",
      label: displayTitle(conversation),
      checked: conversation.id === chat.selectedID,
      onClick: () => model.select(conversation.id),
    })),
  ];
  const more: ChatMenuEntry[] = [
    {
      kind: "item",
      label: "Esporta in Markdown…",
      disabled: !selected || selected.messages.length === 0,
      onClick: () => selected && void model.exportConversation(selected),
    },
    { kind: "separator" },
    { kind: "item", label: "Elimina la conversazione…", destructive: true, disabled: !selected, onClick: () => setDeleting(selected) },
  ];

  return (
    <div className="chat-header">
      <ChatMenu
        disabled={chat.isBusy}
        items={conversations}
        label={
          <span className="chat-title">
            <span className="truncate headline">{selected ? displayTitle(selected) : "Nuova conversazione"}</span>
            <Icon icon={ChevronDown} size={12} color="var(--secondary)" />
          </span>
        }
      />
      <div className="spacer" />
      <ChatModelMenu />
      <Button icon={SquarePen} kind="plain" iconOnly onClick={() => model.newConversation()} disabled={chat.isBusy || chat.selectedID === null} title="Nuova conversazione" />
      <ChatMenu align="right" disabled={chat.isBusy} items={more} title="Altro" label={<span className="btn plain icon"><Icon icon={Ellipsis} /></span>} />
      {deleting && (
        <Alert
          title="Eliminare la conversazione?"
          message={`«${displayTitle(deleting)}» si cancella da questo PC. Documenti e dizionario non cambiano.`}
          onClose={() => setDeleting(null)}
          actions={
            <>
              <Button onClick={() => setDeleting(null)}>Annulla</Button>
              <Button
                kind="destructive"
                onClick={() => {
                  const id = deleting.id;
                  setDeleting(null);
                  void model.deleteConversation(id);
                }}
              >
                Elimina
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

/// Il modello in uso, con il menu per cambiarlo (solo terra, luna e sol dalla versione 6).
function ChatModelMenu() {
  const { model } = window.anonimaiker;
  const chat = useObserved(model.chat);
  if (chat.models.length === 0) return null;
  const current = model.chatModel;
  const effort = model.chatEffort;
  const items: ChatMenuEntry[] = [
    { kind: "header", label: "Modello" },
    ...chat.models.map((item): ChatMenuEntry => ({
      kind: "item", label: item.name, checked: item.slug === current?.slug, onClick: () => model.chooseChatModel(item.slug),
    })),
  ];
  if (current && current.efforts.length > 0) {
    items.push(
      { kind: "separator" },
      { kind: "header", label: "Ragionamento" },
      { kind: "item", label: "Predefinito", checked: effort === null, onClick: () => model.chooseChatEffort(null) },
      ...current.efforts.map((level): ChatMenuEntry => ({
        kind: "item", label: effortTitle(level), checked: effort === level, onClick: () => model.chooseChatEffort(level),
      })),
    );
  }
  return (
    <ChatMenu
      align="right"
      disabled={chat.isBusy}
      items={items}
      title="Il modello di GPT per questa chat"
      label={<span className="chat-model caption">{current?.name ?? "Modello"}</span>}
    />
  );
}

/// Manca il collegamento a ChatGPT: si collega da qui.
function CodexBanner() {
  const { model } = window.anonimaiker;
  const chat = useObserved(model.chat);
  const kind = chat.codexStatus?.kind;
  const missing = kind === "notInstalled" || kind === "notLoggedIn";
  if (!missing && chat.connection === null) return null;
  return (
    <div className="chat-codex-banner">
      <ChatGPTConnectView compact />
    </div>
  );
}

function EmptyChat() {
  const { model } = window.anonimaiker;
  const chat = model.chat;
  return (
    <div className="chat-empty">
      <Icon icon={MessagesSquare} size={30} color="var(--secondary)" />
      <div className="headline chat-empty-title">Chiedi a GPT sul progetto</div>
      <div className="callout secondary" style={{ lineHeight: 1.45 }}>
        GPT vede l'elenco dei documenti di «{model.currentProject?.name ?? ""}», li legge quando servono e può proporre modifiche o
        documenti nuovi: li applichi tu con un clic. Prima di partire tutto passa dal motore di anonimizzazione sul PC: a GPT
        arrivano solo segnaposto come [FULLNAME_1].
      </div>
      <div className="col" style={{ gap: 6, paddingTop: 4, alignItems: "flex-start" }}>
        {["Riassumi i documenti del progetto", "Scrivi una mail di conferma ai partecipanti", "Correggi gli orari nel programma"].map((idea) => (
          <Button key={idea} kind="link" icon={Sparkle} className="callout" onClick={() => (chat.draft = idea)}>{idea}</Button>
        ))}
      </div>
    </div>
  );
}

function phaseText(phase: ChatPhase): string {
  switch (phase.kind) {
    case "anonymizing": return "Anonimizzo la domanda sul PC…";
    case "waiting": return "GPT sta scrivendo…";
    case "reading": return "Leggo " + phase.titles.map((title) => `«${title}»`).join(", ") + " (anonimizzati)…";
  }
}

/// Mentre si lavora, o dopo un errore.
function StatusRow() {
  const { model } = window.anonimaiker;
  const chat = useObserved(model.chat);
  if (chat.phase) {
    return (
      <div className="row callout chat-status">
        <Spinner mini />
        <span className="secondary">{phaseText(chat.phase)}</span>
        <Button kind="link" onClick={() => model.cancelChat()}>Annulla</Button>
      </div>
    );
  }
  if (chat.error) {
    return (
      <div className="row callout chat-status" style={{ alignItems: "baseline" }}>
        <TriangleAlert size={14} strokeWidth={1.75} color="var(--orange)" style={{ flexShrink: 0, alignSelf: "center" }} aria-hidden />
        <span className="selectable" style={{ whiteSpace: "pre-wrap" }}>{chat.error}</span>
        {chat.selected?.messages.at(-1)?.role === "user" && <Button small onClick={() => void model.retryChat()}>Riprova</Button>}
      </div>
    );
  }
  return null;
}

/// Un messaggio: i dati veri, gli allegati, i documenti letti, le proposte, e a richiesta la forma con i segnaposto.
function MessageView({ message }: { message: ChatMessage }) {
  const { model } = window.anonimaiker;
  const [showsSent, setShowsSent] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const isUser = message.role === "user";

  return (
    <div className={`chat-message ${isUser ? "user" : "assistant"}`}>
      <div className="row caption" style={{ gap: 6 }}>
        <span className="headline">{isUser ? "Tu" : "GPT"}</span>
        <span className="secondary">{Format.dateTime(message.date)}</span>
      </div>
      {message.readDocuments.length > 0 && (
        <Label icon={FileSearch} className="caption secondary chat-wrap">
          {"Ha letto: " + message.readDocuments.map((title) => `«${title}»`).join(", ")}
        </Label>
      )}
      {message.text.length > 0 && (
        isUser ? <div className="selectable chat-plain">{message.text}</div> : <div className="selectable"><Markdown text={message.text} /></div>
      )}
      {message.attachments.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          {message.attachments.map((attachment) => (
            <Label key={attachment.id} icon={Paperclip} className="callout">{attachment.name}</Label>
          ))}
        </div>
      )}
      {message.proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} messageID={message.id} />)}
      <div className="row caption secondary chat-footer">
        {message.summary.length > 0 ? (
          <Label icon={isUser ? EyeOff : Undo2} title={isUser ? `Nascosti: ${message.summary}` : message.summary}>
            {isUser ? `Nascosti: ${message.summary}` : message.summary}
          </Label>
        ) : isUser ? (
          <Label icon={Eye}>Nessun dato da nascondere</Label>
        ) : null}
        {message.unknown.length > 0 && (
          <span title={`Segnaposto sconosciuti: ${message.unknown.join(", ")} (restano come sono)`} style={{ display: "inline-flex" }}>
            <Icon icon={BadgeHelp} size={14} color="var(--orange)" />
          </span>
        )}
        <div className="spacer" />
        <Button kind="link" className="caption" onClick={() => setShowsSent(!showsSent)}>
          {showsSent ? "Nascondi" : isUser ? "Cosa è partito" : "Com'è arrivata"}
        </Button>
        {!isUser && (
          <>
            <Button icon={Copy} kind="plain" iconOnly small onClick={() => model.copy(message.text)} title="Copia la risposta con i dati veri" />
            <Button
              icon={savedNote ? Check : NotebookPen}
              kind="plain"
              iconOnly
              small
              disabled={savedNote}
              title={savedNote ? "Salvata" : "Salva la risposta fra le note del progetto"}
              onClick={async () => {
                await model.saveAsNote(message);
                setSavedNote(true);
              }}
            />
          </>
        )}
      </div>
      {showsSent && <SentText message={message} />}
    </div>
  );
}

/// Una proposta di GPT: il testo già riconvertito, da applicare (nuova versione o documento nuovo) o scartare.
function ProposalCard({ proposal, messageID }: { proposal: ChatProposal; messageID: string }) {
  const { model } = window.anonimaiker;
  const [expanded, setExpanded] = useState(false);
  const value = (placeholder: string) => model.vault.value(placeholder);
  const title = reveal(proposal.sentTitle, value);
  const content = reveal(proposal.content, value);
  const characters = Array.from(content);
  const long = characters.length > 600;
  const isNew = isNewDocument(proposal);
  const document = proposal.status === "applied" ? model.document(proposal) : null;

  return (
    <div className="chat-proposal">
      <Label icon={isNew ? FilePlus : ClipboardPen} className="headline chat-wrap">
        {isNew ? `Nuovo documento «${title}»` : `Modifica a «${title}»`}
      </Label>
      <div className="callout selectable chat-proposal-text">
        {expanded || !long ? content : characters.slice(0, 600).join("") + "…"}
      </div>
      <div className="row">
        {long && <Button kind="link" className="caption" onClick={() => setExpanded(!expanded)}>{expanded ? "Mostra meno" : "Mostra tutto"}</Button>}
        <div className="spacer" />
        {proposal.status === "pending" && (
          <>
            <Button onClick={() => void model.discard(proposal, messageID)}>Scarta</Button>
            <Button kind="primary" onClick={() => void model.apply(proposal, messageID)}>
              {isNew ? "Aggiungi al progetto" : "Applica come nuova versione"}
            </Button>
          </>
        )}
        {proposal.status === "applied" && (
          <>
            <Label icon={CircleCheck} className="caption" color="var(--green)">Applicata</Label>
            {document && <Button kind="link" className="caption" onClick={() => model.openDocument(document.id)}>Apri il documento</Button>}
          </>
        )}
        {proposal.status === "discarded" && <Label icon={CircleX} className="caption secondary">Scartata</Label>}
      </div>
    </div>
  );
}

const sentLimit = 6000;

/// Il testo con i segnaposto, così com'è partito o arrivato.
function SentText({ message }: { message: ChatMessage }) {
  return (
    <div className="chat-sent selectable">
      <div className="chat-plain">{highlighted(message.sent, placeholderRanges(message.sent), "chat-ph")}</div>
      {message.attachments.map((attachment) => {
        const characters = Array.from(attachment.sentText);
        const text = characters.length > sentLimit ? characters.slice(0, sentLimit).join("") + "\n…" : attachment.sentText;
        return (
          <div key={attachment.id} className="col" style={{ gap: 4 }}>
            <span className="caption secondary">
              {`Allegato «${attachment.sentName}»` + (attachment.summary.length === 0 ? "" : ` · nascosti: ${attachment.summary}`)}
            </span>
            <div className="callout mono chat-plain">{highlighted(text, placeholderRanges(text), "chat-ph")}</div>
          </div>
        );
      })}
    </div>
  );
}

/// La casella in fondo: allegati in attesa, testo, invio.
function Composer({ dropTargeted }: { dropTargeted: boolean }) {
  const { model } = window.anonimaiker;
  useObserved(model);
  const chat = useObserved(model.chat);
  const field = useRef<HTMLTextAreaElement>(null);

  // Da una a otto righe, come il campo del Mac.
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    const line = parseFloat(getComputedStyle(element).lineHeight) || 18;
    element.style.height = `${Math.min(element.scrollHeight, line * 8 + 12)}px`;
  }, [chat.draft]);

  useEffect(() => {
    field.current?.focus();
  }, []);
  // Finita la risposta, si torna a scrivere.
  useEffect(() => {
    if (!chat.isBusy) field.current?.focus();
  }, [chat.isBusy]);

  const send = () => {
    if (model.canSendChat) void model.sendChat();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Invio manda, Maiusc+Invio va a capo.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };
  const missingEngine = model.engine === null || model.engineState.kind === "missing";

  return (
    <div className={`chat-composer ${dropTargeted ? "drop" : ""}`}>
      {chat.pending.length > 0 && (
        <div className="chat-pending">
          {chat.pending.map((attachment) => (
            <span key={attachment.id} className="chat-chip callout">
              <Icon icon={symbolIcon(attachment.symbol)} size={13} />
              <span className="truncate">{attachment.name}</span>
              <button type="button" className="chat-chip-remove" title="Togli" disabled={chat.isBusy} onClick={() => model.removePending(attachment.id)}>
                <Icon icon={X} size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="chat-input-row">
        <AttachMenu />
        <textarea
          ref={field}
          className="chat-input"
          rows={1}
          value={chat.draft}
          placeholder="Chiedi a GPT sul progetto…"
          disabled={chat.isBusy}
          spellCheck={false}
          onChange={(event) => (chat.draft = event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="chat-send"
          disabled={!model.canSendChat}
          onClick={send}
          title={missingEngine ? "Senza motore di anonimizzazione la chat non parte" : "Anonimizza e invia (Invio o Ctrl+Invio; Maiusc+Invio va a capo)"}
        >
          <Icon icon={ArrowUp} size={16} />
        </button>
      </div>
      <div className="caption tertiary">I dati personali partono come segnaposto.</div>
    </div>
  );
}

function AttachMenu() {
  const { model } = window.anonimaiker;
  const chat = useObserved(model.chat);
  const documents = [...model.crm.documents].sort((a, b) => b.updated.getTime() - a.updated.getTime());
  const items: ChatMenuEntry[] = [
    {
      kind: "submenu",
      label: "Documento del progetto",
      disabled: documents.length === 0,
      items: documents.map((document): ChatMenuEntry => ({ kind: "item", label: document.title, onClick: () => void model.attachDocument(document) })),
    },
    {
      kind: "submenu",
      label: "Scheda di un'azienda",
      disabled: model.crm.companies.length === 0,
      items: model.companyChoices.map((company): ChatMenuEntry => ({ kind: "item", label: company.name, onClick: () => model.attachDossier(company.id) })),
    },
    { kind: "separator" },
    { kind: "item", label: "File dal PC…", icon: File, onClick: () => void model.attachFiles() },
  ];
  return (
    <ChatMenu
      disabled={chat.isBusy}
      items={items}
      title="Allega un documento del progetto, la scheda di un'azienda o un file. GPT può anche cercare da solo fra i documenti del progetto."
      label={<span className="btn plain icon chat-attach"><Icon icon={Paperclip} size={17} /></span>}
    />
  );
}
