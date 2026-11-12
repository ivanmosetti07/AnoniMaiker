#!/usr/bin/env python3
"""Riferimenti per il confronto col Mac: per ogni frase di tests/fixtures/parity-sentences.json
- gli id del tokenizer di Hugging Face (`tokenizers`, con lo stesso tokenizer.json);
- il testo anonimizzato dalla riga di comando Swift (`anonimizza`, motore Core ML del Mac), con le regole di serie
  e con `--tutte` (tutte le entità, senza le regole delle categorie).
Scrive tests/fixtures/parity-reference.json, che la prova `parity.test.ts` usa senza bisogno di Swift.

Uso (dal Mac, con un Python che ha `tokenizers`):
  python scripts/parity-reference.py [--motore /Applications/AnoniMaiker.app/Contents/Resources/Engine]
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WINDOWS = os.path.dirname(HERE)
REPO = os.path.dirname(WINDOWS)
PACKAGE = os.path.join(REPO, "Packages", "AnonymizerKit")


def cli_text(output: str) -> str:
    """Il testo anonimizzato dall'uscita di `anonimizza`: dopo «Motore caricato in … s» e la riga vuota, fino a « \\n\\n»
    (`print(testo, "\\n")` mette uno spazio e due a-capo)."""
    header_end = output.index("\n\n") + 2
    body = output[header_end:]
    return body[: body.index(" \n\n")]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--motore", default="/Applications/AnoniMaiker.app/Contents/Resources/Engine")
    args = parser.parse_args()

    from tokenizers import Tokenizer

    sentences = json.load(open(os.path.join(WINDOWS, "tests", "fixtures", "parity-sentences.json"), encoding="utf-8"))
    tokenizer = Tokenizer.from_file(os.path.join(WINDOWS, "engine", "tokenizer.json"))
    # tokenizer.json tronca a 768 token: il motore invece divide in blocchi, quindi qui si confronta il testo intero.
    tokenizer.no_truncation()
    subprocess.run(["swift", "build", "-c", "release", "--product", "anonimizza"], cwd=PACKAGE, check=True)
    binary = os.path.join(PACKAGE, ".build", "release", "anonimizza")

    cases = []
    for index, sentence in enumerate(sentences):
        encoding = tokenizer.encode(sentence)
        default = subprocess.run([binary, "--motore", args.motore, sentence], capture_output=True, text=True, check=True).stdout
        trial = subprocess.run([binary, "--motore", args.motore, "--tutte", sentence], capture_output=True, text=True, check=True).stdout
        cases.append({
            "text": sentence,
            "ids": encoding.ids,
            "offsets": [list(o) for o in encoding.offsets],
            "anonymized": cli_text(default),
            "trial": cli_text(trial),
        })
        print(f"{index + 1}/{len(sentences)}", file=sys.stderr)
    with open(os.path.join(WINDOWS, "tests", "fixtures", "parity-reference.json"), "w", encoding="utf-8") as f:
        json.dump(cases, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
