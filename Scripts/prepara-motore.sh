#!/bin/zsh
# Mette il motore di anonimizzazione (modello Core ML compilato, tokenizer ed etichette) in Engine/, da dove Xcode lo
# copia dentro l'app. Una volta sola, o per aggiornarlo.
#
# Uso: Scripts/prepara-motore.sh [cartella]
#   Senza cartella: lo cerca fra i modelli già installati da Siri AI+ su questo Mac e, se non c'è, lo scarica dalla
#   release «motore-1» del progetto su GitHub (circa 560 MB, impronta SHA-256 controllata).
#   Con una cartella: la cartella deve contenere un modello .mlmodelc, tokenizer.json e config.json.
set -euo pipefail
ROOT="${0:A:h:h}"
DEST="$ROOT/Engine"

# Una cartella con un solo modello compilato, il tokenizer e le etichette del motore (cerca anche un livello sotto).
find_engine() {
  local base="$1" dir
  for dir in "$base" "$base"/*(N/); do
    local models=( "$dir"/*.mlmodelc(N/) )
    if (( ${#models} == 1 )) && [[ -f "$dir/tokenizer.json" && -f "$dir/config.json" ]] && grep -q '"B-FULLNAME"' "$dir/config.json"; then
      print -r -- "$dir"
      return 0
    fi
  done
  return 1
}

MOTORE_URL="https://github.com/ivanmosetti07/AnoniMaiker/releases/download/motore-1/motore-anonimizzazione.zip"
MOTORE_SHA256="b2d26035f48f22bed6eae6271ea377e7dbe105ef921143dee57db334acfa0f78"

# Il motore pubblicato nella release del progetto, controllato con la sua impronta.
download_engine() {
  local zip="$DEST.zip" tmp="$DEST.tmp"
  print "▶︎ Scarico il motore (circa 560 MB)…"
  curl -fL --progress-bar -o "$zip" "$MOTORE_URL"
  if [[ "$(shasum -a 256 "$zip" | cut -d' ' -f1)" != "$MOTORE_SHA256" ]]; then
    rm -f "$zip"
    print -u2 "L'impronta del motore scaricato non corrisponde: file scartato."
    exit 1
  fi
  rm -rf "$tmp"
  mkdir -p "$tmp"
  ditto -x -k "$zip" "$tmp"
  rm -f "$zip"
  xattr -cr "$tmp" 2>/dev/null || true
  rm -rf "$DEST"
  mv "$tmp" "$DEST"
  print "✅ Motore pronto in Engine/ ($(du -sh "$DEST" | cut -f1)). Ricompila l'app per includerlo."
}

BASE="${1:-$HOME/Library/Application Support/Siri AI+/Models}"
if (( $# == 0 )) && ! find_engine "$BASE" > /dev/null; then
  download_engine
  exit 0
fi
SRC="$(find_engine "$BASE")" || {
  print -u2 "Motore non trovato in «$BASE»."
  print -u2 "Passa la cartella che contiene il modello .mlmodelc, tokenizer.json e config.json: Scripts/prepara-motore.sh <cartella>"
  exit 1
}
MODEL=( "$SRC"/*.mlmodelc(N/) )

TMP="$DEST.tmp"
rm -rf "$TMP"
mkdir -p "$TMP"
cp -R "$MODEL[1]" "$TMP/model.mlmodelc"
cp "$SRC/tokenizer.json" "$SRC/config.json" "$TMP/"
# Metadati neutri: nell'app il modello si chiama solo «motore di anonimizzazione» (la licenza MIT sta in Licenze.md).
perl -0pi -e 's/("shortDescription"\s*:\s*")[^"]*[Rr]izzo[^"]*(")/$1Motore di anonimizzazione (licenza MIT, vedi Licenze)$2/g; s/("generatedClassName"\s*:\s*")[^"]*[Rr]izzo[^"]*(")/$1MotoreAnonimizzazione$2/g' "$TMP/model.mlmodelc/metadata.json"
# Gli attributi estesi (Finder, iCloud) fanno fallire la firma dell'app.
xattr -cr "$TMP" 2>/dev/null || true
rm -rf "$DEST"
mv "$TMP" "$DEST"
print "✅ Motore pronto in Engine/ ($(du -sh "$DEST" | cut -f1)). Ricompila l'app per includerlo."
