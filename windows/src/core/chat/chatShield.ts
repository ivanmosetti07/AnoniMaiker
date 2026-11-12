import { AnonymizationReport, AnonymizationSettings, Revealer, type Anonymizer, type KnownValue } from "../anonimizzazione";
import type { Vault } from "../dizionario";
import { DocumentFormat, DocumentPreview, TextDocument, anonymizeFile } from "../documenti";
import { pathExtension } from "../documenti/textDocument";
import { ChatAttachment, ChatMessage } from "./chatModel";

// MARK: - Lo scudo della chat
//
// Prima di partire, domanda e allegati passano dal motore di anonimizzazione con il dizionario unico dell'app; al
// ritorno la risposta si riconverte con lo stesso dizionario. Nella chat la corrispondenza è «larga»: «MARIO ROSSI»
// scritto di fretta riceve lo stesso segnaposto di «Mario Rossi», così GPT capisce che è la stessa persona.
// Senza motore la chat non parte: niente esce dal PC senza essere anonimizzato.

/// Quello che l'utente allega a una domanda.
export type ChatInput =
  /// Un testo già pronto: la scheda di un cliente, un testo incollato.
  | { kind: "text"; name: string; text: string }
  /// Un file di un formato gestito (anche un documento del CRM).
  | { kind: "file"; name: string; data: Uint8Array; format: DocumentFormat; fileExtension: string };

export const ChatInput = {
  text(name: string, text: string): ChatInput {
    return { kind: "text", name, text };
  },
  file(name: string, data: Uint8Array, format: DocumentFormat, fileExtension: string): ChatInput {
    return { kind: "file", name, data, format, fileExtension };
  },
};

/// Come trattare i segnaposto: sono dati veri nascosti, da usare così come arrivano.
const modelRule =
  "Privacy: alcuni dati personali ti arrivano come segnaposto tra parentesi quadre, per esempio [FULLNAME_1], [EMAIL_1], " +
  "[IBAN_1], [CF_1], [ORG_1]. Sono dati veri che l'app ha nascosto per privacy e che rimette al loro posto nella tua risposta: " +
  "usali esattamente come li ricevi, come se fossero i valori veri (anche nei testi da scrivere, nelle tabelle e nelle " +
  "email). Non chiedere i dati reali, non trattarli come campi da compilare, non spiegare che sono segnaposto e non " +
  "cambiarne la forma.";

const system =
  "Sei l'assistente di un professionista che lavora con i documenti e i clienti del suo CRM. Rispondi in italiano, in " +
  "modo chiaro e concreto; usa il Markdown quando aiuta (elenchi, tabelle). Gli allegati sono tra le righe «<<<» e «>>>».\n\n" +
  modelRule;

export const ChatShield = {
  modelRule,
  system,

  /// Il testo completo che parte: istruzioni, conversazione precedente e nuova richiesta, tutto anonimizzato. Nella chat
  /// di un progetto ci sono anche le istruzioni sui suoi documenti (`project`) e i passaggi già fatti in questa
  /// risposta (`steps`: le risposte intermedie e i documenti letti).
  transcript(history: readonly ChatMessage[], next: ChatMessage, project: string | null = null, steps: readonly string[] = []): string {
    const parts = [system];
    if (project !== null) parts.push(project);
    if (history.length > 0) {
      const previous = history.map((message) => (message.role === "user" ? "Utente: " : "Assistente: ") + ChatShield.rendered(message));
      parts.push("Conversazione precedente:\n" + previous.join("\n\n"));
    }
    parts.push("Richiesta:\n" + ChatShield.rendered(next));
    parts.push(...steps);
    parts.push(
      project === null
        ? "Rispondi solo con il testo della risposta, senza usare strumenti né modificare file."
        : "Rispondi seguendo le istruzioni sui documenti del progetto. Non usare strumenti e non modificare file.",
    );
    return parts.join("\n\n");
  },

  /// Un messaggio come parte: il testo anonimizzato e i suoi allegati.
  rendered(message: ChatMessage): string {
    let text = message.sent;
    for (const attachment of message.attachments) {
      text += `\n\nAllegato «${attachment.sentName}»:\n<<<\n${attachment.sentText}\n>>>`;
    }
    return text;
  },

  /// La risposta di GPT con i dati veri.
  reveal(reply: string, vault: Vault): ChatMessage {
    // «[ORG_1].» a fine frase, con «Edilnord S.r.l.», diventerebbe «S.r.l..»: il punto in più si toglie.
    let text = reply;
    for (const entry of vault.entries) {
      if (entry.value.endsWith(".") && text.includes(entry.placeholder + ".")) {
        text = text.replaceAll(entry.placeholder + ".", entry.placeholder);
      }
    }
    const result = Revealer.reveal(text, vault);
    const summary = result.count === 0 ? "" : `${result.count} ` + (result.count === 1 ? "dato rimesso" : "dati rimessi");
    return ChatMessage.create("assistant", result.text, reply, { summary, unknown: result.unknown });
  },

  /// Mentre la risposta arriva a pezzi: un segnaposto ancora a metà in fondo non si mostra.
  revealPartial(partial: string, vault: Vault): string {
    const text = partial.replace(/\[\s*[A-Z_]*\d*\s*$/u, "");
    return Revealer.reveal(text, vault).text;
  },
};

/// Le opzioni di `chatMessage` (in Swift i parametri con il valore di serie).
export interface ChatMessageOptions {
  inputs?: readonly ChatInput[];
  settings?: AnonymizationSettings;
  client?: string | null;
  known?: readonly KnownValue[];
  /// Per annullare fra un allegato e l'altro (e dentro il motore).
  signal?: AbortSignal;
}

/// Prepara una domanda per GPT: testo e allegati anonimizzati, legati al cliente se c'è.
/// In Swift è `Anonymizer.chatMessage(_:inputs:settings:client:known:)`.
export async function chatMessage(anonymizer: Anonymizer, text: string, options: ChatMessageOptions = {}): Promise<ChatMessage> {
  const { inputs = [], settings = new AnonymizationSettings(), client = null, known = [], signal } = options;
  const common = { settings, client, known, matching: "loose" as const, signal };
  const used: string[] = [];
  let newEntries = 0;
  const anonymized = async (text: string): Promise<string> => {
    const result = await anonymizer.anonymize(text, common);
    used.push(...result.report.placeholders);
    newEntries += result.report.newEntries;
    return result.text;
  };

  const sent = await anonymized(text);
  const attachments: ChatAttachment[] = [];
  for (const input of inputs) {
    signal?.throwIfAborted();
    // Anche il nome di un file può contenere un dato («Contratto Mario Rossi.docx»); l'estensione resta fuori.
    const ext = pathExtension(input.name);
    const base = ext.length === 0 || ext.includes(" ") ? input.name : input.name.slice(0, input.name.length - ext.length - 1);
    const sentName = (await anonymized(base)) + (base === input.name ? "" : "." + ext);
    let content: string;
    let report: AnonymizationReport;
    if (input.kind === "text") {
      const result = await anonymizer.anonymize(input.text, common);
      [content, report] = [result.text, result.report];
    } else if (DocumentFormat.isText(input.format)) {
      const document = TextDocument.decode(input.data, DocumentFormat.textKind(input.format));
      const result = await anonymizer.anonymize(document.text, common);
      [content, report] = [result.text, result.report];
    } else {
      const outcome = await anonymizeFile(anonymizer, input.data, input.format, { ...common, fileExtension: input.fileExtension });
      [content, report] = [DocumentPreview.plainText(outcome.preview), outcome.report ?? new AnonymizationReport([], 0)];
    }
    used.push(...report.placeholders);
    newEntries += report.newEntries;
    attachments.push(ChatAttachment.create(input.name, sentName, content, report.summary));
  }
  const report = new AnonymizationReport(used, newEntries);
  return ChatMessage.create("user", text, sent, { attachments, summary: report.summary });
}
