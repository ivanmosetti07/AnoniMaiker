#!/bin/zsh
# Pubblica una nuova versione di AnoniMaiker su GitHub: le app installate la vedono e si aggiornano da sole.
#
# Uso: Scripts/pubblica-rilascio.sh <versione> [novità.md]
#   esempio: Scripts/pubblica-rilascio.sh 0.6 novita.md
#
# Cosa fa: aggiorna il numero di versione, lancia i test, crea il DMG (firma Developer ID e notarizzazione se c'è il
# certificato, altrimenti firma ad hoc), firma il DMG con la chiave degli aggiornamenti, fa commit e tag, e crea la
# release con DMG e firma (.dmg.sig).
#
# La chiave degli aggiornamenti sta nel portachiavi («AnoniMaiker – firma aggiornamenti»). Se la perdi, le app già
# installate non accettano più aggiornamenti automatici: salvane una copia (Accesso Portachiavi › Mostra password).
set -euo pipefail
ROOT="${0:A:h:h}"
cd "$ROOT"

VERSION="${1:-}"
NOTES_FILE="${2:-}"
SERVICE="AnoniMaiker – firma aggiornamenti"
PROJECT="Anonimizzatore AI.xcodeproj/project.pbxproj"

fail() { print -u2 "❌ $1"; exit 1; }

[[ "$VERSION" =~ '^[0-9]+(\.[0-9]+){1,2}$' ]] || fail "Uso: Scripts/pubblica-rilascio.sh <versione> [novità.md]   (es. 0.6)"
[[ -z "$NOTES_FILE" || -f "$NOTES_FILE" ]] || fail "File delle novità non trovato: $NOTES_FILE"
command -v gh > /dev/null || fail "Serve GitHub CLI (brew install gh) con l'accesso fatto (gh auth login)."
[[ -z "$(git status --porcelain)" ]] || fail "Ci sono modifiche non salvate in git: fai prima un commit."
git rev-parse "v$VERSION" > /dev/null 2>&1 && fail "Il tag v$VERSION esiste già."
CURRENT="$(grep -m1 'MARKETING_VERSION' "$PROJECT" | sed -E 's/.*= ([^;]+);/\1/')"
KEY="$(security find-generic-password -a AnoniMaiker -s "$SERVICE" -w 2>/dev/null)" || fail "Manca la chiave «$SERVICE» nel portachiavi."

print "▶︎ Versione $CURRENT → $VERSION"
BUILD_NUMBER=$(( $(grep -m1 'CURRENT_PROJECT_VERSION' "$PROJECT" | sed -E 's/.*= ([0-9]+);/\1/') + 1 ))
sed -i '' -E "s/MARKETING_VERSION = [^;]+;/MARKETING_VERSION = $VERSION;/g; s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = $BUILD_NUMBER;/g" "$PROJECT"

print "▶︎ Test…"
mkdir -p build
(cd Packages/AnonymizerKit && swift test > "$ROOT/build/test.log" 2>&1) || { git checkout -- "$PROJECT"; tail -20 build/test.log; fail "I test non passano (log: build/test.log)."; }

if security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  Scripts/distribuisci.sh
  SIGNED=1
else
  Scripts/distribuisci.sh --senza-firma
  SIGNED=0
fi
DMG="build/distribuzione/AnoniMaiker-$VERSION.dmg"
[[ -f "$DMG" ]] || fail "DMG non trovato: $DMG"

print "▶︎ Firma per gli aggiornamenti…"
(cd Packages/AnonymizerKit && swift build -c release --product firma-rilascio > /dev/null)
SIGNER="Packages/AnonymizerKit/.build/release/firma-rilascio"
FIRMA_CHIAVE="$KEY" "$SIGNER" firma "$DMG" > "$DMG.sig"
unset KEY
"$SIGNER" verifica "$DMG" "$(cat "$DMG.sig")" > /dev/null || fail "La firma non corrisponde alla chiave pubblica dentro l'app."

NOTES="build/distribuzione/novita.md"
{
  if [[ -n "$NOTES_FILE" ]]; then cat "$NOTES_FILE"; else print "Novità di AnoniMaiker $VERSION."; fi
  print "\n## Installazione\n"
  print "1. Scarica **AnoniMaiker-$VERSION.dmg** qui sotto, aprilo e trascina AnoniMaiker in Applicazioni."
  if (( SIGNED == 0 )); then
    print "2. La prima volta macOS dice che non può verificare l'app (non è notarizzata da Apple): premi **Fine**, poi apri"
    print "   Impostazioni di Sistema › Privacy e sicurezza e premi **Apri comunque**."
  fi
  print "\nChi ha già AnoniMaiker riceve l'aggiornamento dall'app. Requisiti: macOS 26, Mac con Apple Silicon o Intel."
} > "$NOTES"

print "▶︎ Commit, tag e release su GitHub…"
git add "$PROJECT"
git commit -q -m "Versione $VERSION"
git tag -a "v$VERSION" -m "AnoniMaiker $VERSION"
git push -q origin HEAD "v$VERSION"
gh release create "v$VERSION" "$DMG" "$DMG.sig" --title "AnoniMaiker $VERSION" --notes-file "$NOTES" --latest
print "✅ Pubblicata: $(gh release view "v$VERSION" --json url -q .url)"
