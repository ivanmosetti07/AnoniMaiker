import * as ort from "onnxruntime-node";
import { EngineError } from "./engineError";
import type { PIIEntity } from "./piiDetectors";
import type { PIIToken } from "./piiTokenizer";

// MARK: - Il modello del motore in ONNX
//
// ModernBERT (base mmBERT) da 0,3B parametri che etichetta ogni token con 45 classi (B-/I- di 22 categorie e O).
// Sul Mac è Core ML con forme fisse (64, 128, 256 o 512 token); qui ONNX accetta qualsiasi lunghezza, quindi niente
// riempimento: resta il limite di 512 token. Le etichette si raggruppano come la pipeline di Hugging Face con
// `aggregation_strategy="simple"`.

export interface PIIPrediction {
  label: number;
  score: number;
}

export class PIIModel {
  /** Il blocco più lungo che il modello accetta, compresi «<bos>» e «<eos>». */
  static readonly maxTokens = 512;

  private constructor(private readonly session: ort.InferenceSession, readonly labels: string[]) {}

  /** `executionProviders`: dove far girare il modello (di serie il processore, come sul Mac). */
  static async load(path: string, labels: string[], executionProviders: string[] = ["cpu"]): Promise<PIIModel> {
    const session = await ort.InferenceSession.create(path, { executionProviders, graphOptimizationLevel: "all" });
    return new PIIModel(session, labels);
  }

  /** Etichetta e probabilità di ogni token (al massimo 512, compresi «<bos>» e «<eos>»). */
  async predict(ids: number[]): Promise<PIIPrediction[]> {
    if (ids.length > PIIModel.maxTokens) throw EngineError.failed("blocco troppo lungo per il modello");
    const size = ids.length;
    const input = new ort.Tensor("int64", BigInt64Array.from(ids, (id) => BigInt(id)), [1, size]);
    const mask = new ort.Tensor("int64", new BigInt64Array(size).fill(1n), [1, size]);
    const output = await this.session.run({ input_ids: input, attention_mask: mask });
    const logits = output.logits;
    if (!logits) throw EngineError.failed("il modello non ha restituito le etichette");
    const data = logits.data as Float32Array;
    const classes = this.labels.length;
    const stride = logits.dims[2] ?? classes;
    const result: PIIPrediction[] = [];
    const values = new Float64Array(classes);
    for (let token = 0; token < size; token++) {
      let best = 0;
      for (let label = 0; label < classes; label++) {
        values[label] = data[token * stride + label];
        if (values[label] > values[best]) best = label;
      }
      // Softmax: la probabilità della classe scelta.
      const top = values[best];
      let sum = 0;
      for (let label = 0; label < classes; label++) sum += Math.exp(values[label] - top);
      result.push({ label: best, score: 1 / sum });
    }
    return result;
  }

  /** Libera la memoria del modello. */
  async release(): Promise<void> {
    await this.session.release();
  }

  /** Entità di un blocco di testo (posizioni in code point del blocco), come `aggregation_strategy="simple"`:
   *  token consecutivi con la stessa categoria (un «B-» ne apre una nuova), punteggio medio, «O» scartati. */
  static entities(tokens: PIIToken[], predictions: PIIPrediction[], labels: string[]): PIIEntity[] {
    const tag = (name: string): { begin: boolean; tag: string } => {
      if (name.startsWith("B-")) return { begin: true, tag: name.slice(2) };
      if (name.startsWith("I-")) return { begin: false, tag: name.slice(2) };
      return { begin: false, tag: name };
    };
    type Group = { tag: string; scores: number[]; start: number; end: number };
    const groups: Group[] = [];
    let current: Group | null = null;
    const count = Math.min(tokens.length, predictions.length);
    for (let i = 0; i < count; i++) {
      const token = tokens[i];
      if (token.special) continue;
      const { begin, tag: name } = tag(labels[predictions[i].label]);
      if (current && current.tag === name && !begin) {
        current = { tag: name, scores: [...current.scores, predictions[i].score], start: current.start, end: token.end };
      } else {
        if (current) groups.push(current);
        current = { tag: name, scores: [predictions[i].score], start: token.start, end: token.end };
      }
    }
    if (current) groups.push(current);
    return groups.filter((g) => g.tag !== "O").map((g) => ({
      label: g.tag, start: g.start, end: g.end, score: g.scores.reduce((a, b) => a + b, 0) / g.scores.length,
      validated: false, source: "modello" as const,
    }));
  }
}
