import type { LucideIcon } from "lucide-react";
import { File, FileScan, FileText, IdCard, Sheet } from "lucide-react";
import type { ChatConversation, ChatProposal } from "../../core/chat";

// MARK: - Aiuti della chat per l'interfaccia
//
// Copie di poche funzioni di `src/core/chat` e `src/core/anonimizzazione`: quei moduli importano Node e il renderer
// non può caricarli (vedi UI-CONTRACT.md).

const segmenter = new Intl.Segmenter("it", { granularity: "grapheme" });

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/// Da `ChatConversation.displayTitle` (src/core/chat/chatModel.ts).
export function displayTitle(conversation: ChatConversation): string {
  if (conversation.title.trim().length > 0) return conversation.title;
  const first = conversation.messages.find((message) => message.role === "user");
  if (!first) return "Nuova conversazione";
  const line = (first.text.split(/\r\n|\r|\n/).find((item) => item.trim().length > 0) ?? "").trim();
  if (line.length === 0) return first.attachments[0]?.name ?? "Nuova conversazione";
  const characters = graphemes(line);
  return characters.length > 60 ? characters.slice(0, 59).join("") + "…" : line;
}

/// Da `ChatProposal.isNewDocument` (src/core/chat/chatModel.ts).
export function isNewDocument(proposal: ChatProposal): boolean {
  return proposal.documentID === null;
}

/// Da `CodexClient.effortTitle` (src/core/chat/codexClient.ts).
export function effortTitle(effort: string): string {
  switch (effort) {
    case "minimal": return "Minimo";
    case "low": return "Veloce";
    case "medium": return "Normale";
    case "high": return "Accurato";
    case "xhigh": return "Molto accurato";
    case "max": return "Massimo";
    case "ultra": return "Ultra";
    default: return effort;
  }
}

/// I segnaposto come li scrivono le AI: «[FULLNAME_1]», «[ FULLNAME_1 ]», «\[FULLNAME\_1\]», «FULLNAME_1».
/// Più largo di `Revealer.regex` (che elenca le categorie): qui un segnaposto che il dizionario non conosce resta com'è,
/// quindi «MAX_SIZE_1» in un pezzo di codice non cambia.
const inner = String.raw`[A-Z][A-Z]*(?:\\?_[A-Z]+)*\\?_\d+`;
const revealPattern = new RegExp(
  String.raw`\\?\[\s*(` + inner + String.raw`)\s*\\?\]|(?<![\p{L}\p{N}_\\])(` + inner + String.raw`)(?![\p{L}\p{N}_])`,
  "gu",
);

/// Come `Revealer.reveal(…).text`: i segnaposto che il dizionario conosce tornano i dati veri.
export function reveal(text: string, value: (placeholder: string) => string | null): string {
  if (!text.includes("_")) return text;
  return text.replace(revealPattern, (match, bracketed: string | undefined, bare: string | undefined) => {
    const group = bracketed ?? bare ?? match;
    return value("[" + group.replaceAll("\\", "") + "]") ?? match;
  });
}

/// I simboli del Mac per i formati (`DocumentFormat.symbol`) tradotti nelle icone di lucide.
export function symbolIcon(symbol: string): LucideIcon {
  switch (symbol) {
    case "doc.text":
    case "doc.text.fill":
    case "doc.richtext":
      return FileText;
    case "tablecells":
      return Sheet;
    case "doc.viewfinder":
      return FileScan;
    case "person.text.rectangle":
      return IdCard;
    default:
      return File;
  }
}
