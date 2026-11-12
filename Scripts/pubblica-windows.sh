#!/bin/zsh
# Pubblica una nuova versione di AnoniMaiker per Windows su GitHub: le app installate la vedono e si aggiornano da sole.
#
# Uso: Scripts/pubblica-windows.sh <versione> [novità.md]
#   esempio: Scripts/pubblica-windows.sh 0.15 novita.md
#
# Cosa fa: aggiorna il numero di versione in windows/package.json e il link «Scarica per Windows» del README, lancia
# controllo dei tipi e test, fa commit e push. L'installatore lo crea GitHub Actions su una macchina Windows (workflow
# «Windows»: sul Mac con Apple Silicon makensis non gira). Poi lo scarica, lo firma con la stessa chiave degli
# aggiornamenti del Mac, mette il tag windows-v<versione> e crea la release con installatore e firma (.exe.sig).
#
# La release NON diventa «latest»: le app Mac chiedono a GitHub l'ultima release e devono trovarci il DMG.
# Il motore ONNX sta nella release «motore-onnx-1» (npm run motore lo scarica in windows/engine/).
set -euo pipefail
ROOT="${0:A:h:h}"
cd "$ROOT"

VERSION="${1:-}"
NOTES_FILE="${2:-}"
SERVICE="AnoniMaiker – firma aggiornamenti"
PACKAGE="windows/package.json"

fail() { print -u2 "❌ $1"; exit 1; }

[[ "$VERSION" =~ '^[0-9]+(\.[0-9]+){1,2}$' ]] || fail "Uso: Scripts/pubblica-windows.sh <versione> [novità.md]   (es. 0.15)"
[[ -z "$NOTES_FILE" || -f "$NOTES_FILE" ]] || fail "File delle novità non trovato: $NOTES_FILE"
command -v gh > /dev/null || fail "Serve GitHub CLI (brew install gh) con l'accesso fatto (gh auth login)."
command -v npm > /dev/null || fail "Serve Node.js (nodejs.org)."
[[ -z "$(git status --porcelain)" ]] || fail "Ci sono modifiche non salvate in git: fai prima un commit."
git rev-parse "windows-v$VERSION" > /dev/null 2>&1 && fail "Il tag windows-v$VERSION esiste già."
KEY="$(security find-generic-password -a AnoniMaiker -s "$SERVICE" -w 2>/dev/null)" || fail "Manca la chiave «$SERVICE» nel portachiavi."

# 0.15 → 0.15.0 (npm vuole tre numeri); il nome dell'installatore usa la versione della release.
SEMVER="$VERSION"
[[ "$SEMVER" =~ '^[0-9]+\.[0-9]+$' ]] && SEMVER="$SEMVER.0"
print "▶︎ Versione Windows $VERSION"
(cd windows && npm version "$SEMVER" --no-git-tag-version --allow-same-version > /dev/null)
# Il pulsante «Scarica per Windows» del README punta all'installatore nuovo.
sed -i '' -E "s#windows-v[0-9.]+/AnoniMaiker-Setup-[0-9.]+\.exe#windows-v$VERSION/AnoniMaiker-Setup-$VERSION.exe#g; s#AnoniMaiker-Setup-[0-9.]+\.exe\]#AnoniMaiker-Setup-$VERSION.exe]#g" README.md

print "▶︎ Dipendenze, motore, controllo dei tipi e test…"
mkdir -p build
(
  cd windows
  npm ci > "$ROOT/build/windows.log" 2>&1
  npm run motore >> "$ROOT/build/windows.log" 2>&1
  npm run typecheck >> "$ROOT/build/windows.log" 2>&1
  npm test >> "$ROOT/build/windows.log" 2>&1
) || { git checkout -- "$PACKAGE" windows/package-lock.json README.md; tail -30 build/windows.log; fail "Controlli non riusciti (log: build/windows.log)."; }

print "▶︎ Commit e push…"
if [[ -n "$(git status --porcelain)" ]]; then
  git add "$PACKAGE" windows/package-lock.json README.md
  git commit -q -m "Versione Windows $VERSION"
fi
git push -q origin HEAD
COMMIT="$(git rev-parse HEAD)"

print "▶︎ Installatore su GitHub Actions (Windows)…"
gh workflow run windows.yml --ref "$(git branch --show-current)" > /dev/null
RUN=""
for _ in {1..30}; do
  RUN="$(gh run list --workflow windows.yml --commit "$COMMIT" --event workflow_dispatch --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
  [[ -n "$RUN" ]] && break
  sleep 5
done
[[ -n "$RUN" ]] || fail "La corsa del workflow Windows non è partita."
gh run watch "$RUN" --exit-status > /dev/null || fail "Il workflow Windows non è riuscito: gh run view $RUN --log-failed"
rm -rf build/windows-dist
gh run download "$RUN" --name AnoniMaiker-Windows --dir build/windows-dist
EXE="build/windows-dist/AnoniMaiker-Setup-$VERSION.exe"
[[ -f "build/windows-dist/AnoniMaiker-Setup-$SEMVER.exe" && "$SEMVER" != "$VERSION" ]] && mv "build/windows-dist/AnoniMaiker-Setup-$SEMVER.exe" "$EXE"
[[ -f "$EXE" ]] || fail "Installatore non trovato: $EXE"

print "▶︎ Firma per gli aggiornamenti…"
(cd Packages/AnonymizerKit && swift build -c release --product firma-rilascio > /dev/null)
SIGNER="Packages/AnonymizerKit/.build/release/firma-rilascio"
FIRMA_CHIAVE="$KEY" "$SIGNER" firma "$EXE" > "$EXE.sig"
unset KEY
"$SIGNER" verifica "$EXE" "$(cat "$EXE.sig")" > /dev/null || fail "La firma non corrisponde alla chiave pubblica dentro l'app."

NOTES="build/windows-dist/novita.md"
{
  if [[ -n "$NOTES_FILE" ]]; then cat "$NOTES_FILE"; else print "AnoniMaiker $VERSION per Windows."; fi
  print "\n## Installazione\n"
  print "1. Scarica **AnoniMaiker-Setup-$VERSION.exe** qui sotto e aprilo: si installa da solo, senza permessi di amministratore."
  print "2. La prima volta Windows può mostrare «Windows ha protetto il PC» (l'installatore non ha un certificato a"
  print "   pagamento): premi **Ulteriori informazioni**, poi **Esegui comunque**."
  print "\nChi ha già AnoniMaiker per Windows riceve l'aggiornamento dall'app. Requisiti: Windows 10 o 11 a 64 bit."
  print "Per portare i dati dal Mac: sul Mac «Crea copia di sicurezza», su Windows «Ripristina da una copia di sicurezza»."
} > "$NOTES"

print "▶︎ Tag e release su GitHub…"
git tag -a "windows-v$VERSION" -m "AnoniMaiker $VERSION per Windows" "$COMMIT"
git push -q origin "windows-v$VERSION"
gh release create "windows-v$VERSION" "$EXE" "$EXE.sig" --title "AnoniMaiker $VERSION per Windows" --notes-file "$NOTES" --latest=false --verify-tag
print "✅ Pubblicata: $(gh release view "windows-v$VERSION" --json url -q .url)"
