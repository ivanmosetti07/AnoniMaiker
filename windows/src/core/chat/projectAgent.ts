import { trimWhitespace } from "../crm/crmModel";
import { DocumentFormat } from "../documenti";
import { characterCount } from "../sicurezza/swiftCoding";
import { graphemePrefix } from "./chatModel";

// MARK: - La chat del progetto, come un piccolo «harness»
//
// GPT riceve l'elenco dei documenti del progetto (titoli anonimizzati) e può chiedere di leggerli: scrive «LEGGI D3» e
// l'app gli rimanda il testo anonimizzato del documento, poi GPT continua. Le modifiche le propone scrivendo il
// documento completo fra due righe-marcatore; l'utente le vede riconvertite e decide se applicarle (diventano una
// nuova versione del documento) o scartarle. GPT non tocca mai niente da solo, e vede solo testi anonimizzati.

/// Un documento del progetto come lo vede GPT.
export interface AgentDocument {
  readonly ref: string;
  readonly id: string;
  /// Il titolo con i segnaposto.
  readonly title: string;
  readonly format: DocumentFormat;
}

/// Una proposta letta dalla risposta: `ref` per una modifica («D2»), null per un documento nuovo (con il suo titolo).
export interface AgentProposal {
  ref: string | null;
  title: string;
  content: string;
}

/// Cosa contiene una risposta di GPT: documenti da leggere, proposte, e il messaggio per l'utente.
export interface AgentReply {
  reads: string[];
  proposals: AgentProposal[];
  text: string;
}

export const AgentReply = {
  equals(a: AgentReply, b: AgentReply): boolean {
    return (
      a.text === b.text &&
      a.reads.length === b.reads.length &&
      a.reads.every((read, index) => read === b.reads[index]) &&
      a.proposals.length === b.proposals.length &&
      a.proposals.every((p, index) => p.ref === b.proposals[index].ref && p.title === b.proposals[index].title && p.content === b.proposals[index].content)
    );
  },
};

/// Quanti giri di lettura al massimo per una domanda.
const maxRounds = 4;
/// Oltre questa lunghezza un documento si manda tagliato.
const maxDocumentLength = 40_000;

const readLine = /^\s*\**\s*LEGGI\s+(D\d+(?:\s*[,e]\s*D\d+)*)\s*\**\s*$/gimu;
const block = /<<<\s*(MODIFICA|NUOVO)\s+([^>\n]*?)\s*>>>\s*\n?(.*?)\n?\s*<<<\s*FINE\s*>>>/gsu;

export const ProjectAgent = {
  maxRounds,
  maxDocumentLength,

  /// Le istruzioni sui documenti del progetto, da aggiungere a quelle della chat.
  instructions(project: string, documents: readonly AgentDocument[]): string {
    let text = `Lavori nel progetto «${project}». `;
    if (documents.length === 0) {
      text += "Il progetto non ha ancora documenti.";
    } else {
      text += "I suoi documenti (già anonimizzati) sono:\n";
      text += documents.map((d) => `- ${d.ref}: «${d.title}» (${DocumentFormat.title(d.format)})`).join("\n");
      text +=
        "\n\nPer leggere un documento scrivi su una riga da sola «LEGGI D1» (una riga per documento) e nient'altro: ti " +
        "mando il suo testo e poi continui. Leggi solo i documenti che servono.";
    }
    text +=
      "\n\nPer proporre una modifica a un documento scrivi il documento completo già modificato fra le righe " +
      "«<<<MODIFICA D1>>>» e «<<<FINE>>>». Per proporre un documento nuovo usa «<<<NUOVO Titolo del documento>>>» e " +
      "«<<<FINE>>>». L'utente vede la proposta e decide se applicarla: tu non cambi niente da solo. Fuori dai marcatori " +
      "scrivi il messaggio per l'utente (breve, senza ripetere il documento).";
    return text;
  },

  /// Legge una risposta di GPT.
  parse(reply: string): AgentReply {
    const result: AgentReply = { reads: [], proposals: [], text: reply };
    const remove: { start: number; end: number }[] = [];
    for (const match of reply.matchAll(block)) {
      const kind = match[1].toUpperCase();
      const target = match[2].replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, "");
      const content = match[3];
      if (kind === "MODIFICA") {
        result.proposals.push({ ref: target.toUpperCase(), title: "", content });
      } else {
        result.proposals.push({ ref: null, title: target.length === 0 ? "Nuovo documento" : target, content });
      }
      remove.push({ start: match.index, end: match.index + match[0].length });
    }
    for (const match of reply.matchAll(readLine)) {
      const refs = match[1].toUpperCase().split(/[, E]/u).filter((ref) => ref.startsWith("D"));
      for (const ref of refs) if (!result.reads.includes(ref)) result.reads.push(ref);
      remove.push({ start: match.index, end: match.index + match[0].length });
    }
    let text = reply;
    for (const range of remove.sort((a, b) => b.start - a.start)) {
      text = text.slice(0, range.start) + text.slice(range.end);
    }
    result.text = trimWhitespace(text.replace(/\n{3,}/g, "\n\n"));
    return result;
  },

  /// Il testo dei documenti chiesti, da aggiungere alla conversazione per il giro successivo.
  documentsBlock(documents: readonly { document: AgentDocument; text: string }[]): string {
    return documents
      .map((item) => {
        let text = item.text;
        if (characterCount(text) > maxDocumentLength) {
          text = graphemePrefix(text, maxDocumentLength) + `\n[… documento tagliato: è più lungo di ${maxDocumentLength} caratteri]`;
        }
        return `Documento ${item.document.ref} «${item.document.title}»:\n<<<\n${text}\n>>>`;
      })
      .join("\n\n");
  },
};
