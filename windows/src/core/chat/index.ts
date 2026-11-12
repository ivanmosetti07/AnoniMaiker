// La chat con GPT: conversazioni cifrate, scudo di anonimizzazione, Codex CLI e la chat sui documenti del progetto.
//
// Nomi diversi da Swift:
// - `ChatMessage.Role` → `ChatRole`; `ChatProposal.Status` → `ChatProposalStatus`; i costruttori sono `X.create(…)`,
//   le proprietà calcolate funzioni (`ChatConversation.displayTitle(c)`, `ChatProposal.isNewDocument(p)`).
// - `ChatInput.text(name:text:)` / `.file(…)` → `ChatInput.text(…)` / `ChatInput.file(…)` (unione con `kind`), il nome è `input.name`.
// - `Anonymizer.chatMessage(_:inputs:…)` → la funzione `chatMessage(anonymizer, text, { inputs, … , signal })`.
// - `CodexClient.Status` → `CodexStatus`; `CodexClient.CodexError` → `CodexError`; `CodexClient.SetupError` → `SetupError`.
// - `CodexClient.Output` → `CodexOutput`; `CodexClient.run(_:arguments:input:stopOn:onOutput:)` → `run(file, args, { input, stopOn, onOutput, signal })`.
// - `CodexClient.loginURL(in:)` → `loginURL(text)`; `executable()` restituisce un percorso (o null).
// - Annullare: dove Swift annulla il Task, qui c'è `signal` (AbortSignal) e l'errore è `CancellationError`.
// - In più: `CodexClient.executableOverride` / `toolOverrides` (per le prove), `spawnCommand` (come si avvia un `.cmd`).
// - `AgentReply.proposals` è un elenco di `AgentProposal` (in Swift tuple); `AgentReply.equals(a, b)`.
export {
  ChatAttachment, ChatConversation, ChatMessage, ChatProposal, ChatStore,
  type ChatFolder, type ChatProposalStatus, type ChatRole,
} from "./chatModel";
export { ChatInput, ChatShield, chatMessage, type ChatMessageOptions } from "./chatShield";
export {
  CodexClient, CodexError, CodexModel, CodexStatus, SetupError, spawnCommand,
  type CodexErrorCode, type CodexOutput, type RunOptions, type SetupErrorCode,
} from "./codexClient";
export { AgentReply, ProjectAgent, type AgentDocument, type AgentProposal } from "./projectAgent";
