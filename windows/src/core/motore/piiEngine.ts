import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EngineError } from "./engineError";
import { PIIDetectors, type PIIEntity } from "./piiDetectors";
import { PIIModel } from "./piiModel";
import { PIIText, icu, isWordCharacter, pyIsSpace } from "./piiText";
import { PIITokenizer } from "./piiTokenizer";

// MARK: - Il motore di anonimizzazione sul PC
//
// Il testo si divide in blocchi di 120 parole (20 in comune fra un blocco e il successivo), il modello etichetta ogni
// blocco, la rete regex + checksum aggiunge i dati a forma fissa, la fusione tiene i candidati migliori senza
// sovrapposizioni e li allinea alle parole. Niente esce dal PC.

/** Il registro del motore: in silenzio, a meno di `ANONIMAIKER_LOG` nell'ambiente. */
export const engineLog = {
  info(message: string): void {
    if (process.env.ANONIMAIKER_LOG) console.info(`[motore] ${message}`);
  },
};

/** Avanzamento da 0 a 1. */
export type Progress = (fraction: number) => void;

const defaultMaxWords = 120;
const defaultOverlap = 20;

export const PIIAnalysis = {
  maxWords: defaultMaxWords,
  overlap: defaultOverlap,

  /** Blocchi di parole intere (spezzati dove c'è spazio), con l'offset di partenza. */
  chunks(text: PIIText, maxWords: number = defaultMaxWords, overlap: number = defaultOverlap): { start: number; end: number }[] {
    const words: { start: number; end: number }[] = [];
    let index = 0;
    while (index < text.count) {
      if (pyIsSpace(text.at(index))) { index += 1; continue; }
      const start = index;
      while (index < text.count && !pyIsSpace(text.at(index))) index += 1;
      words.push({ start, end: index });
    }
    if (words.length === 0) return [];
    const chunks: { start: number; end: number }[] = [];
    const step = Math.max(1, maxWords - overlap);
    let i = 0;
    while (i < words.length) {
      const block = words.slice(i, Math.min(words.length, i + maxWords));
      chunks.push({ start: block[0].start, end: block[block.length - 1].end });
      if (i + maxWords >= words.length) break;
      i += step;
    }
    return chunks;
  },

  /** Senza sovrapposizioni: prima i checksum validi, poi la rete regex (non «soft»), poi punteggio e lunghezza;
   *  niente spazi ai bordi, parole mai tagliate a metà, pezzi contigui della stessa categoria uniti. */
  merge(candidates: PIIEntity[], text: PIIText): PIIEntity[] {
    const key = (e: PIIEntity): [number, number, number, number] =>
      [e.validated ? 1 : 0, e.source === "regex" && !PIIDetectors.softRegexLabels.has(e.label) ? 1 : 0, e.score, e.end - e.start];
    const order = candidates.map((element, offset) => ({ element, offset, key: key(element) })).sort((a, b) => {
      for (let i = 0; i < 4; i++) if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i];
      return a.offset - b.offset;       // ordinamento stabile, come quello della pipeline originale
    }).map((x) => x.element);
    let kept: PIIEntity[] = [];
    for (const entity of order) {
      // Ricerca binaria sugli inizi: le entità tenute sono ordinate e senza sovrapposizioni.
      let low = 0, high = kept.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (entity.start < kept[mid].start) high = mid; else low = mid + 1;
      }
      if ((low > 0 && kept[low - 1].end > entity.start) || (low < kept.length && kept[low].start < entity.end)) continue;
      kept.splice(low, 0, { ...entity });
    }
    for (const e of kept) {
      while (e.start < e.end && pyIsSpace(text.at(e.start))) e.start += 1;
      while (e.end > e.start && pyIsSpace(text.at(e.end - 1))) e.end -= 1;
    }
    kept = kept.filter((e) => e.end > e.start);
    for (const e of kept) {
      while (e.start > 0 && isWordCharacter(text.at(e.start - 1)) && isWordCharacter(text.at(e.start))) e.start -= 1;
      while (e.end < text.count && isWordCharacter(text.at(e.end)) && isWordCharacter(text.at(e.end - 1))) e.end += 1;
    }
    kept = kept.map((element, offset) => ({ element, offset })).sort((a, b) => {
      if (a.element.start !== b.element.start) return a.element.start - b.element.start;
      const la = a.element.end - a.element.start, lb = b.element.end - b.element.start;
      return la !== lb ? lb - la : a.offset - b.offset;
    }).map((x) => x.element);
    const merged: PIIEntity[] = [];
    for (const entity of kept) {
      const last = merged[merged.length - 1];
      if (last && entity.start < last.end) {
        last.end = Math.max(last.end, entity.end);
        continue;
      }
      if (last && entity.start === last.end && entity.label === last.label) {
        last.end = entity.end;
        continue;
      }
      merged.push(entity);
    }
    return merged;
  },

  /** Segnaposto già presenti nel testo («[FULLNAME_1]»): non si rianonimizzano. */
  placeholderRegex: icu(String.raw`\[\s*[A-Z][A-Z_]*_\d+\s*\]`),
};

/** Il motore: tokenizer e modello caricati la prima volta che servono. Come l'attore di Swift, un'analisi alla volta:
 *  due richieste non si contendono il modello. */
export class PIIEngine {
  /** Cartella con `model.onnx`, `tokenizer.json` e `config.json`. */
  readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  /** Il motore dentro l'app (`resources/engine`). */
  static bundled(resourcesDirectory: string = (process as { resourcesPath?: string }).resourcesPath ?? ""): PIIEngine | null {
    if (!resourcesDirectory) return null;
    const directory = join(resourcesDirectory, "engine");
    return existsSync(directory) ? new PIIEngine(directory) : null;
  }

  get modelPath(): string {
    return join(this.directory, "model.onnx");
  }

  /** Modello, tokenizer ed etichette ci sono tutti. */
  get isInstalled(): boolean {
    return existsSync(this.modelPath) && existsSync(join(this.directory, "tokenizer.json")) && existsSync(join(this.directory, "config.json"));
  }

  private tokenizer: PIITokenizer | null = null;
  private model: PIIModel | null = null;
  private loading: Promise<{ tokenizer: PIITokenizer; model: PIIModel }> | null = null;
  private lastUse = 0;
  /** Solo processore: come sul Mac, il più veloce per blocchi così piccoli. */
  private executionProviders: string[] = ["cpu"];
  /** La coda delle analisi: una alla volta, come le chiamate a un attore. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Per le prove: dove far girare il modello. */
  use(executionProviders: string[]): void {
    this.executionProviders = executionProviders;
    this.dropModel();
  }

  get isLoaded(): boolean {
    return this.model !== null;
  }

  private dropModel(): void {
    const model = this.model;
    this.model = null;
    this.loading = null;
    void model?.release().catch(() => undefined);
  }

  private async load(): Promise<{ tokenizer: PIITokenizer; model: PIIModel }> {
    if (this.tokenizer && this.model) return { tokenizer: this.tokenizer, model: this.model };
    if (this.loading) return this.loading;
    if (!this.isInstalled) throw EngineError.notInstalled;
    const loading = (async () => {
      const started = Date.now();
      let map: unknown;
      try {
        map = (JSON.parse(readFileSync(join(this.directory, "config.json"), "utf8")) as { id2label?: unknown }).id2label;
      } catch {
        map = undefined;
      }
      if (!map || typeof map !== "object") throw EngineError.failed("etichette del modello non leggibili");
      const labelsMap = map as Record<string, unknown>;
      const count = Object.keys(labelsMap).length;
      const labels = Array.from({ length: count }, (_, i) => {
        const label = labelsMap[String(i)];
        return typeof label === "string" ? label : "O";
      });
      const tokenizer = this.tokenizer ?? new PIITokenizer(join(this.directory, "tokenizer.json"));
      const model = await PIIModel.load(this.modelPath, labels, this.executionProviders);
      this.tokenizer = tokenizer;
      this.model = model;
      engineLog.info(`Motore pronto in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return { tokenizer, model };
    })();
    this.loading = loading;
    try {
      return await loading;
    } finally {
      if (this.loading === loading) this.loading = null;
    }
  }

  /** In fila dietro alle richieste precedenti. */
  private exclusive<T>(body: () => Promise<T>): Promise<T> {
    const run = this.queue.then(body, body);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Carica il motore in anticipo (all'avvio): la prima anonimizzazione non aspetta. */
  prepare(): Promise<void> {
    return this.exclusive(async () => {
      await this.load();
      this.lastUse = Date.now();
    });
  }

  /** Libera la memoria se il motore non serve da un po' (circa 700 MB). */
  releaseIfIdle(after = 600): Promise<void> {
    return this.exclusive(async () => {
      if (this.model === null || (Date.now() - this.lastUse) / 1000 <= after) return;
      this.dropModel();
      this.tokenizer = null;
      engineLog.info("Motore scaricato dalla memoria (inattivo)");
    });
  }

  /** Le entità di un testo: modello sui blocchi, ore completate, rete regex, fusione.
   *  `progress` va da 0 a 1 man mano che i blocchi passano dal modello; si può annullare fra un blocco e l'altro. */
  analyze(text: PIIText, progress?: Progress, signal?: AbortSignal): Promise<PIIEntity[]> {
    return this.exclusive(async () => {
      const { tokenizer, model } = await this.load();
      this.lastUse = Date.now();
      const found: PIIEntity[] = [];
      const chunks = PIIAnalysis.chunks(text);
      for (let index = 0; index < chunks.length; index++) {
        signal?.throwIfAborted();
        found.push(...await this.detect(text, chunks[index].start, chunks[index].end, tokenizer, model));
        progress?.((index + 1) / chunks.length);
      }
      PIIDetectors.completeTime(found, text);
      this.lastUse = Date.now();
      return PIIAnalysis.merge([...found, ...PIIDetectors.detect(text)], text);
    });
  }

  /** Un blocco al modello; oltre i 512 token (parole lunghissime, codici) si divide a metà per parole. */
  private async detect(text: PIIText, start: number, end: number, tokenizer: PIITokenizer, model: PIIModel): Promise<PIIEntity[]> {
    const piece = new PIIText(text.slice(start, end));
    const tokens = tokenizer.encode(piece);
    if (tokens.length > PIIModel.maxTokens) {
      // Si taglia sullo spazio più vicino alla metà (o a metà, se non ce ne sono).
      const half = Math.trunc(piece.count / 2);
      let cut = -1;
      for (let i = 1; i < piece.count; i++) {
        if (pyIsSpace(piece.at(i)) && (cut < 0 || Math.abs(i - half) < Math.abs(cut - half))) cut = i;
      }
      if (cut < 0) cut = half;
      return [...await this.detect(text, start, start + cut, tokenizer, model), ...await this.detect(text, start + cut, end, tokenizer, model)];
    }
    const predictions = await model.predict(tokens.map((t) => t.id));
    return PIIModel.entities(tokens, predictions, model.labels).map((entity) => ({ ...entity, start: entity.start + start, end: entity.end + start }));
  }

  /** Entità di un testo, senza quelle sopra a segnaposto già presenti (niente segnaposto dentro un segnaposto). */
  async entities(source: PIIText, progress?: Progress, signal?: AbortSignal): Promise<PIIEntity[]> {
    if (source.count === 0) return [];
    const existing = source.matches(PIIAnalysis.placeholderRegex);
    return (await this.analyze(source, progress, signal)).filter((entity) => !existing.some((e) => e.start < entity.end && entity.start < e.end));
  }

  /** Per le prove: i token di un testo (come `tokenizer.encode`), caricando solo il tokenizer. */
  tokenize(text: string): number[] {
    this.tokenizer ??= new PIITokenizer(join(this.directory, "tokenizer.json"));
    return this.tokenizer.encode(new PIIText(text)).map((t) => t.id);
  }
}
