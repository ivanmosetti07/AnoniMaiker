import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { Anonymizer } from "../src/core/anonimizzazione";
import { VaultStore } from "../src/core/dizionario";
import { PIITokenizer, PIIText } from "../src/core/motore";
import { MemoryFolder, TestEngine } from "./support/motoreSupport";

// MARK: - Confronto col motore del Mac
//
// `fixtures/parity-reference.json` (da `scripts/parity-reference.py`): per ogni frase gli id del tokenizer di Hugging
// Face e il testo anonimizzato dalla riga di comando Swift (Core ML, pesi fp16), con le regole di serie e con
// `--tutte`. Il tokenizer deve dare gli stessi id e le stesse posizioni; i testi anonimizzati lo stesso risultato,
// salvo le frasi in `modelDifferences`: lì il modello ONNX (fp32) dà a qualche token un'etichetta diversa da quella del
// modello fp16 del Mac (differenze di punteggio, non di regole).

interface ReferenceCase {
  text: string;
  ids: number[];
  offsets: [number, number][];
  anonymized: string;
  trial: string;
}

const here = fileURLToPath(new URL(".", import.meta.url));
const cases = JSON.parse(readFileSync(join(here, "fixtures", "parity-reference.json"), "utf8")) as ReferenceCase[];

/** Frasi (indice) in cui l'uscita differisce dal Mac solo per il punteggio del modello: spiegate nel resoconto del porting. */
const modelDifferences: Record<number, string> = {
  // «🇹» (seconda metà della bandiera dopo «Torino»): O 0,523 contro I-CITY 0,476 col modello fp32; il fp16 del Mac sceglie
  // I-CITY e con `--tutte` ne fa «[CITY_2]». Con le regole di serie le città restano in chiaro: il testo coincide.
  14: "punteggio quasi pari su un token della bandiera",
};

describe.skipIf(!TestEngine.isAvailable)("ParityTests", () => {
  test("tokenizerIsIdenticalToHuggingFace", () => {
    const tokenizer = new PIITokenizer(join(TestEngine.directory, "tokenizer.json"));
    for (const [index, item] of cases.entries()) {
      const tokens = tokenizer.encode(new PIIText(item.text));
      expect(tokens.map((t) => t.id), `frase ${index}`).toEqual(item.ids);
      expect(tokens.map((t) => [t.start, t.end]), `frase ${index}`).toEqual(item.offsets);
    }
  });

  test("anonymizedTextMatchesTheMac", async () => {
    const engine = TestEngine.engine;
    const differences: string[] = [];
    for (const [index, item] of cases.entries()) {
      const trial = (await Anonymizer.trial(item.text, engine)).text;
      const anonymizer = new Anonymizer(engine, new VaultStore(new MemoryFolder()));
      const anonymized = (await anonymizer.anonymize(item.text)).text;
      // Andata e ritorno: il testo riconvertito è l'originale.
      expect((await anonymizer.reveal(anonymized)).text).toBe(item.text);
      const same = trial === item.trial && anonymized === item.anonymized;
      if (!same) {
        differences.push(`frase ${index}\n  Mac --tutte: ${item.trial}\n  PC  --tutte: ${trial}\n  Mac: ${item.anonymized}\n  PC:  ${anonymized}`);
        expect(modelDifferences[index], `differenza non spiegata:\n${differences[differences.length - 1]}`).toBeDefined();
      } else {
        expect(modelDifferences[index], `frase ${index} ora coincide: togli la differenza`).toBeUndefined();
      }
    }
    if (differences.length > 0 && process.env.ANONIMAIKER_PARITY) console.info(differences.join("\n\n"));
  });
});
