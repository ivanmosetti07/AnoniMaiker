#!/bin/zsh
# Prepara AnoniMaiker da dare ad altri: build Release universale (Apple Silicon e Intel), firma Developer ID con runtime
# protetto, DMG, notarizzazione Apple e graffatura. Il risultato si apre su qualsiasi Mac con macOS 26 senza avvisi.
#
# Uso: Scripts/distribuisci.sh [--senza-notarizzare | --senza-firma]
#   --senza-notarizzare  firma Developer ID ma salta l'invio ad Apple (per una prova veloce)
#   --senza-firma        firma «ad hoc», senza Apple Developer Program: sugli altri Mac la prima apertura va
#                        confermata in Impostazioni di Sistema › Privacy e sicurezza › «Apri comunque» (istruzioni
#                        nel file «Leggimi» dentro il DMG)
#
# Una volta sola, prima della prima distribuzione:
#   1. Certificato: Xcode › Impostazioni › Account › Gestisci certificati › + › «Developer ID Application»
#      (serve l'Apple Developer Program a pagamento).
#   2. Credenziali per la notarizzazione, salvate nel portachiavi (la password è una «password specifica per app»
#      creata su account.apple.com, non quella dell'ID Apple):
#        xcrun notarytool store-credentials AnoniMaiker --apple-id <la tua email> --team-id <il tuo team>
set -euo pipefail
ROOT="${0:A:h:h}"
cd "$ROOT"

MODE="${1:-}"
PROFILE="${NOTARY_PROFILE:-AnoniMaiker}"
TEAM="${DEVELOPMENT_TEAM:-}"
BUILD="$ROOT/build/distribuzione"
ARCHIVE="$BUILD/AnoniMaiker.xcarchive"

fail() { print -u2 "❌ $1"; exit 1; }

[[ -f Engine/model.mlmodelc/coremldata.bin ]] || fail "Manca il motore in Engine/: esegui prima Scripts/prepara-motore.sh"

if [[ "$MODE" == "--senza-firma" ]]; then
  IDENTITY="-"
  SIGNING=(CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=)
else
  IDENTITY="$(security find-identity -v -p codesigning | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"')" || true
  [[ -n "$IDENTITY" ]] || fail "Nessun certificato «Developer ID Application» nel portachiavi.
   Crealo da Xcode › Impostazioni › Account › Gestisci certificati › + › Developer ID Application
   (serve l'Apple Developer Program). Senza: Scripts/distribuisci.sh --senza-firma"
  # Il team è quello tra parentesi nel nome del certificato.
  [[ -n "$TEAM" ]] || TEAM="$(print -r -- "$IDENTITY" | sed -nE 's/.*\(([A-Z0-9]{10})\)$/\1/p')"
  SIGNING=(CODE_SIGN_IDENTITY="$IDENTITY" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$TEAM" "OTHER_CODE_SIGN_FLAGS=--timestamp")
fi

VERSION="$(grep -m1 'MARKETING_VERSION' "Anonimizzatore AI.xcodeproj/project.pbxproj" | sed -E 's/.*= ([^;]+);/\1/')"
DMG="$BUILD/AnoniMaiker-$VERSION.dmg"
print "▶︎ AnoniMaiker $VERSION · firma: $IDENTITY"

rm -rf "$BUILD"
mkdir -p "$BUILD"
# Gli attributi estesi (Finder, iCloud) fanno fallire la firma.
xattr -cr Engine App 2>/dev/null || true

print "▶︎ Archivio Release universale…"
xcodebuild -project "Anonimizzatore AI.xcodeproj" -scheme "Anonimizzatore AI" -configuration Release \
  -archivePath "$ARCHIVE" -destination "generic/platform=macOS" ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO \
  "${SIGNING[@]}" archive > "$BUILD/xcodebuild.log" 2>&1 || { tail -30 "$BUILD/xcodebuild.log"; fail "Archivio non riuscito (log: $BUILD/xcodebuild.log)"; }
APP="$ARCHIVE/Products/Applications/AnoniMaiker.app"
[[ -d "$APP" ]] || fail "L'archivio non contiene AnoniMaiker.app"

print "▶︎ Controllo la firma…"
codesign --verify --deep --strict "$APP" || fail "Firma non valida"
if [[ "$IDENTITY" != "-" ]]; then
  codesign -dvv "$APP" 2>&1 | grep -q "flags=.*runtime" || fail "Manca il runtime protetto (necessario per la notarizzazione)"
fi
print "   $(lipo -archs "$APP/Contents/MacOS/AnoniMaiker") · $(du -sh "$APP" | cut -f1)"

print "▶︎ Creo il DMG…"
STAGE="$BUILD/dmg"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/AnoniMaiker.app"
ln -s /Applications "$STAGE/Applicazioni"
if [[ "$IDENTITY" == "-" ]]; then
  # Senza notarizzazione macOS chiede una conferma la prima volta: le istruzioni viaggiano con l'app.
  cat > "$STAGE/Leggimi – come aprire AnoniMaiker.txt" <<'LEGGIMI'
AnoniMaiker – installazione

1. Trascina AnoniMaiker nella cartella Applicazioni.
2. Apri AnoniMaiker. La prima volta macOS dice che non può verificarla: è normale, l'app non passa dall'App Store
   né dalla notarizzazione Apple. Premi «Fine» (non «Sposta nel Cestino»).
3. Apri Impostazioni di Sistema › Privacy e sicurezza, scorri in fondo fino al messaggio su AnoniMaiker e premi
   «Apri comunque». Conferma con la password o Touch ID.
4. Riapri AnoniMaiker e premi «Apri». Da qui in poi si apre normalmente.

In alternativa, dal Terminale, dopo averla copiata in Applicazioni:
   xattr -dr com.apple.quarantine /Applications/AnoniMaiker.app

Requisiti: macOS 26 o successivo, Mac con Apple Silicon o Intel, circa 1,5 GB di memoria libera mentre il motore lavora.

Chat con GPT (facoltativa): serve un tuo abbonamento ChatGPT. Nella chat premi «Collega il tuo account ChatGPT»:
l'app prepara Codex (la riga di comando di OpenAI) e apre l'accesso nel browser. Per la prima installazione di Codex
serve Node.js (https://nodejs.org) oppure Homebrew.

Tutti i dati restano cifrati sul tuo Mac. Fai subito una copia di sicurezza con password (File › Crea copia di
sicurezza…): senza, su un Mac nuovo i dati non si riaprono.
LEGGIMI
fi
hdiutil create -volname "AnoniMaiker $VERSION" -srcfolder "$STAGE" -fs APFS -format ULFO -ov "$DMG" 2>&1 | grep -v "deprecated" || true
rm -rf "$STAGE"
if [[ "$IDENTITY" == "-" ]]; then
  codesign --force --sign - "$DMG"
else
  codesign --force --sign "$IDENTITY" --timestamp "$DMG"
fi

if [[ "$IDENTITY" == "-" ]]; then
  print "⚠️  DMG firmato ad hoc: $DMG"
  print "   Sugli altri Mac la prima apertura va confermata in Privacy e sicurezza › «Apri comunque»: le istruzioni sono"
  print "   nel file «Leggimi» dentro il DMG."
  exit 0
fi
if [[ "$MODE" == "--senza-notarizzare" ]]; then
  print "⚠️  DMG firmato ma non notarizzato: $DMG"
  exit 0
fi

print "▶︎ Notarizzazione Apple (qualche minuto: si carica tutto il DMG)…"
if ! xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait --output-format plist > "$BUILD/notarizzazione.plist" 2> "$BUILD/notarizzazione.err"; then
  cat "$BUILD/notarizzazione.err" >&2
  fail "Invio non riuscito. Hai salvato le credenziali? xcrun notarytool store-credentials $PROFILE --apple-id <email> --team-id $TEAM"
fi
STATUS="$(/usr/libexec/PlistBuddy -c 'Print :status' "$BUILD/notarizzazione.plist")"
ID="$(/usr/libexec/PlistBuddy -c 'Print :id' "$BUILD/notarizzazione.plist")"
if [[ "$STATUS" != "Accepted" ]]; then
  xcrun notarytool log "$ID" --keychain-profile "$PROFILE" "$BUILD/notarizzazione-log.json" || true
  fail "Apple ha risposto «$STATUS». Dettagli: $BUILD/notarizzazione-log.json"
fi

print "▶︎ Graffatura e controllo di Gatekeeper…"
xcrun stapler staple "$DMG" > /dev/null
xcrun stapler validate "$DMG" > /dev/null
spctl --assess --type open --context context:primary-signature -v "$DMG" 2>&1 | sed 's/^/   /'
print "✅ Pronto da distribuire: $DMG ($(du -sh "$DMG" | cut -f1))"
