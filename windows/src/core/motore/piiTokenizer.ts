import { readFileSync } from "node:fs";
import { EngineError } from "./engineError";
import type { PIIText } from "./piiText";

// MARK: - Tokenizer del motore (quello di Gemma, 256.000 voci)
//
// Stessi passaggi di `tokenizers` di Hugging Face con il tokenizer.json del modello:
// 1. i token aggiunti (a-capo ripetuti, «<bos>», «<unusedN>»…) si riconoscono sul testo grezzo, prima di tutto;
// 2. il resto: spazi → «▁», un «▁» davanti a ogni pezzo (Metaspace, «always»), divisione a ogni «▁»;
// 3. BPE con le fusioni in ordine di rango; un carattere fuori vocabolario diventa i suoi byte («<0xE2>»…);
// 4. «<bos>» … «<eos>» ai bordi.
// Ogni token porta le posizioni (in code point) del testo originale, per riportare le etichette sui caratteri.

export interface PIIToken {
  id: number;
  start: number;
  end: number;
  special: boolean;
}

interface Added {
  scalars: number[];
  id: number;
  special: boolean;
}

interface Symbol {
  id: number;
  first: number;
  last: number;
}

interface TokenizerJSON {
  model?: { vocab?: Record<string, number>; merges?: (string | [string, string])[] };
  added_tokens?: { content?: string; id?: number; special?: boolean }[];
}

const META = 0x2581;
const encoder = new TextEncoder();

export class PIITokenizer {
  /** Chiavi come stringhe esatte (unità UTF-16): a differenza delle stringhe di Swift, in JavaScript «;» (U+003B) e
   *  «;» (U+037E), o «é» composta e scomposta, sono già chiavi diverse, come nel vocabolario. */
  private readonly vocab: Map<string, number>;
  /** I token di un carattere solo, per carattere. */
  private readonly charIDs: Map<number, number>;
  /** Coppia di id → rango e id della fusione. */
  private readonly merges: Map<number, { rank: number; id: number }>;
  private readonly byteIDs: Int32Array;
  /** Token aggiunti per primo carattere, dal più lungo. */
  private readonly added: Map<number, Added[]>;
  readonly bos: number;
  readonly eos: number;
  private readonly unk: number;
  private cache = new Map<string, Symbol[]>();

  constructor(path: string) {
    let json: TokenizerJSON;
    try {
      json = JSON.parse(readFileSync(path, "utf8")) as TokenizerJSON;
    } catch {
      throw EngineError.failed("tokenizer.json non leggibile");
    }
    const rawVocab = json.model?.vocab;
    const rawMerges = json.model?.merges;
    if (!rawVocab || typeof rawVocab !== "object" || !Array.isArray(rawMerges)) throw EngineError.failed("tokenizer.json non leggibile");
    const vocab = new Map<string, number>();
    const charIDs = new Map<number, number>();
    // JSON.parse confronta le chiavi alla lettera: i token «uguali» per Unicode restano distinti.
    for (const [token, id] of Object.entries(rawVocab)) {
      if (typeof id !== "number") continue;
      vocab.set(token, id);
      const cp = token.codePointAt(0);
      if (cp !== undefined && token.length === (cp > 0xffff ? 2 : 1)) charIDs.set(cp, id);
    }
    const merges = new Map<number, { rank: number; id: number }>();
    rawMerges.forEach((item, rank) => {
      let pair: [string, string] | null = null;
      if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && typeof item[1] === "string") {
        pair = [item[0], item[1]];
      } else if (typeof item === "string") {
        const space = item.indexOf(" ");
        if (space >= 0) pair = [item.slice(0, space), item.slice(space + 1)];
      }
      if (!pair) return;
      const a = vocab.get(pair[0]), b = vocab.get(pair[1]), merged = vocab.get(pair[0] + pair[1]);
      if (a === undefined || b === undefined || merged === undefined) return;
      const key = pairKey(a, b);
      if (!merges.has(key)) merges.set(key, { rank, id: merged });
    });
    const byteIDs = new Int32Array(256).fill(-1);
    for (let byte = 0; byte < 256; byte++) {
      byteIDs[byte] = vocab.get(`<0x${byte.toString(16).toUpperCase().padStart(2, "0")}>`) ?? -1;
    }
    const added = new Map<number, Added[]>();
    for (const item of json.added_tokens ?? []) {
      const content = item.content, id = item.id;
      if (typeof content !== "string" || typeof id !== "number" || content.length === 0) continue;
      const scalars = Array.from(content, (c) => c.codePointAt(0)!);
      const list = added.get(scalars[0]) ?? [];
      list.push({ scalars, id, special: item.special ?? false });
      added.set(scalars[0], list);
      vocab.set(content, id);
    }
    for (const list of added.values()) list.sort((x, y) => y.scalars.length - x.scalars.length);
    this.vocab = vocab;
    this.charIDs = charIDs;
    this.merges = merges;
    this.byteIDs = byteIDs;
    this.added = added;
    this.bos = vocab.get("<bos>") ?? 2;
    this.eos = vocab.get("<eos>") ?? 1;
    this.unk = vocab.get("<unk>") ?? 3;
  }

  encode(text: PIIText): PIIToken[] {
    const tokens: PIIToken[] = [{ id: this.bos, start: 0, end: 0, special: true }];
    let segmentStart = 0;
    let i = 0;
    while (i < text.count) {
      const match = this.addedToken(text, i);
      if (match) {
        if (segmentStart < i) this.encodeSegment(text, segmentStart, i, tokens);
        tokens.push({ id: match.id, start: i, end: i + match.scalars.length, special: match.special });
        i += match.scalars.length;
        segmentStart = i;
      } else {
        i += 1;
      }
    }
    if (segmentStart < text.count) this.encodeSegment(text, segmentStart, text.count, tokens);
    tokens.push({ id: this.eos, start: 0, end: 0, special: true });
    return tokens;
  }

  private addedToken(text: PIIText, index: number): Added | null {
    const candidates = this.added.get(text.at(index));
    if (!candidates) return null;
    for (const candidate of candidates) {
      if (index + candidate.scalars.length > text.count) continue;
      let equal = true;
      for (let offset = 0; offset < candidate.scalars.length; offset++) {
        if (text.at(index + offset) !== candidate.scalars[offset]) {
          equal = false;
          break;
        }
      }
      if (equal) return candidate;
    }
    return null;
  }

  /** Un tratto di testo fra due token aggiunti: normalizzazione, «▁» iniziale, pezzi, BPE. */
  private encodeSegment(text: PIIText, start: number, end: number, tokens: PIIToken[]): void {
    // Caratteri normalizzati con la posizione originale (il «▁» aggiunto davanti non occupa caratteri).
    const chars: { scalar: number; start: number; end: number }[] = [];
    for (let index = start; index < end; index++) {
      chars.push({ scalar: text.at(index) === 0x20 ? META : text.at(index), start: index, end: index + 1 });
    }
    // Come `prepend` di tokenizers: il «▁» aggiunto prende le posizioni del primo carattere.
    if (chars.length > 0 && chars[0].scalar !== META) chars.unshift({ scalar: META, start: chars[0].start, end: chars[0].end });
    let pieceStart = 0;
    for (let index = 1; index <= chars.length; index++) {
      if (!(index === chars.length || chars[index].scalar === META)) continue;
      const piece = chars.slice(pieceStart, index).map((c) => c.scalar);
      for (const part of this.bpe(piece)) {
        const first = chars[pieceStart + part.first], last = chars[pieceStart + part.last];
        tokens.push({ id: part.id, start: first.start, end: Math.max(first.start, last.end), special: false });
      }
      pieceStart = index;
    }
  }

  /** BPE di un pezzo: (id, primo carattere, ultimo carattere), con la cache delle parole già viste. */
  private bpe(scalars: number[]): Symbol[] {
    const cacheKey = fromCodePoints(scalars);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const symbols: Symbol[] = [];
    scalars.forEach((scalar, index) => {
      const id = this.charIDs.get(scalar);
      if (id !== undefined) {
        symbols.push({ id, first: index, last: index });
      } else {
        // Fuori vocabolario: i suoi byte UTF-8, ognuno con le posizioni del carattere intero.
        for (const byte of encoder.encode(String.fromCodePoint(scalar))) {
          const byteID = this.byteIDs[byte];
          symbols.push({ id: byteID >= 0 ? byteID : this.unk, first: index, last: index });
        }
      }
    });
    while (symbols.length > 1) {
      let best: { index: number; rank: number; id: number } | null = null;
      for (let index = 0; index < symbols.length - 1; index++) {
        const merge = this.merges.get(pairKey(symbols[index].id, symbols[index + 1].id));
        if (merge && merge.rank < (best?.rank ?? Number.MAX_SAFE_INTEGER)) best = { index, rank: merge.rank, id: merge.id };
      }
      if (!best) break;
      symbols[best.index] = { id: best.id, first: symbols[best.index].first, last: symbols[best.index + 1].last };
      symbols.splice(best.index + 1, 1);
    }
    if (this.cache.size > 50_000) this.cache = new Map();
    this.cache.set(cacheKey, symbols);
    return symbols;
  }

  /** Per le prove: l'id di un token del vocabolario. */
  id(token: string): number | undefined {
    return this.vocab.get(token);
  }
}

/** Una stringa dai suoi code point (a pezzi: un pezzo lunghissimo non sfonda lo stack). */
function fromCodePoints(scalars: number[]): string {
  let result = "";
  for (let i = 0; i < scalars.length; i += 4096) result += String.fromCodePoint(...scalars.slice(i, i + 4096));
  return result;
}

/** Coppia di id in un numero solo (gli id stanno sotto i 2^21: niente perdite di precisione). */
function pairKey(a: number, b: number): number {
  return a * 0x200000 + b;
}
