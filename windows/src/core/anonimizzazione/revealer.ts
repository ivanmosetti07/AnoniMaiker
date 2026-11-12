import type { Vault } from "../dizionario";
import { PIIAnalysis, PIICategory, escapedPattern, icu } from "../motore";

// MARK: - Riconversione: i segnaposto tornano i dati veri
//
// Tollerante con quello che fanno le AI e gli editor: grassetto («**[FULLNAME_1]**»), spazi nelle parentesi,
// parentesi perse («FULLNAME_1»), Markdown con le parentesi e i trattini bassi preceduti da «\». Un segnaposto che il
// dizionario non conosce (inventato dall'AI, o di un altro PC) resta com'è e si segnala: meglio di un valore sbagliato.

/** Un tratto di testo in unità UTF-16 (come `NSRange`). */
export interface TextRange {
  location: number;
  length: number;
}

/** Esito di una riconversione. */
export class RevealResult {
  text: string;
  /** Segnaposto rimessi, con quante volte. */
  replaced = new Map<string, number>();
  /** Segnaposto che il dizionario non conosce, nell'ordine in cui compaiono. */
  unknown: string[] = [];
  /** Dove stanno i valori rimessi nel testo riconvertito (offset UTF-16): per evidenziarli. */
  spans: TextRange[] = [];

  constructor(text: string) {
    this.text = text;
  }

  /** Quanti segnaposto sono tornati dati veri. */
  get count(): number {
    let total = 0;
    for (const value of this.replaced.values()) total += value;
    return total;
  }
}

/** Solo le categorie dei segnaposto: «MAX_SIZE_1» in un pezzo di codice non è un segnaposto. */
function makeRegex(): RegExp {
  const labels = [...PIICategory.placeholderLabels].sort((a, b) => b.length - a.length)
    .map((label) => escapedPattern(label).replaceAll("_", String.raw`\\?_`))
    .join("|");
  const inner = "(?:" + labels + String.raw`)\\?_\d+`;
  const pattern = String.raw`\\?\[\s*(` + inner + String.raw`)\s*\\?\]|(?<![\p{L}\p{N}_\\])(` + inner + String.raw`)(?![\p{L}\p{N}_])`;
  return icu(pattern);
}

const regex = makeRegex();

export const Revealer = {
  regex,

  reveal(text: string, vault: Vault): RevealResult {
    const result = new RevealResult(text);
    if (!text.includes("_")) return result;
    let output = "";
    let position = 0;
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const index = match.index ?? 0;
      const group = match[1] ?? match[2] ?? match[0];
      const placeholder = "[" + group.replaceAll("\\", "") + "]";
      output += text.slice(position, index);
      const value = vault.value(placeholder);
      if (value !== null) {
        result.spans.push({ location: output.length, length: value.length });
        result.replaced.set(placeholder, (result.replaced.get(placeholder) ?? 0) + 1);
        output += value;
      } else {
        if (!result.unknown.includes(placeholder)) result.unknown.push(placeholder);
        output += match[0];
      }
      position = index + match[0].length;
    }
    result.text = output + text.slice(position);
    return result;
  },

  /** Dove stanno i segnaposto in un testo anonimizzato (offset UTF-16): per evidenziarli. */
  placeholderRanges(text: string): TextRange[] {
    return Array.from(text.matchAll(PIIAnalysis.placeholderRegex), (m) => ({ location: m.index ?? 0, length: m[0].length }));
  },
};
