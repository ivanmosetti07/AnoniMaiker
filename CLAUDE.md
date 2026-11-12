# AnoniMaiker: due app, una sola app

AnoniMaiker esiste per Mac (SwiftUI: `App/` + `Packages/AnonymizerKit/`) e per Windows (Electron: `windows/`).
Sono la stessa app: **stesse funzioni, stessi testi, stesso aspetto, stesso numero di versione**.

## Regola
- Ogni modifica (funzione, correzione, testo, interfaccia, formato dei dati) si fa **in tutte e due** nello stesso
  lavoro, con i test in tutte e due. Non si chiude un lavoro con una sola delle due aggiornata.
- La corrispondenza file↔file è in `windows/PORTING.md`. L'aspetto: `App/Tema/Tema.swift` ↔
  `windows/src/renderer/styles.css` (stessi colori, raggi, misure dei caratteri); le viste Swift ↔ le viste `.tsx` con
  lo stesso nome.
- I formati dei dati (cartella cifrata, dizionario, CRM, progetti, chat, copia di sicurezza) restano identici: una copia
  di sicurezza fatta su un sistema si ripristina sull'altro (i test lo controllano con i file in `windows/tests/fixtures/mac/`).
- Si pubblicano insieme, con lo stesso numero:
  `Scripts/pubblica-rilascio.sh <versione> novita.md` (Mac, release «latest») e
  `Scripts/pubblica-windows.sh <versione> novita.md` (Windows, release `windows-v<versione>`, mai «latest»).
  Servono la chiave «AnoniMaiker – firma aggiornamenti» nel Portachiavi e `gh` collegato.

## Differenze ammesse (solo di sistema)
- Testi che nominano il computer: «Mac» / «PC», «Finder» / «Esplora file», ⌘ / Ctrl.
- Custode della chiave dei dati: Secure Enclave / DPAPI.
- OCR dei PDF scansionati: solo sul Mac (Apple Vision); su Windows i PDF senza testo danno l'errore «nessun testo».
- Menu dell'app, finestre di Apri e Salva, avvisi di conferma: quelli nativi di ciascun sistema.

## Prove
- Mac: `cd Packages/AnonymizerKit && swift test`; build con `xcodebuild -project "Anonimizzatore AI.xcodeproj" -scheme "Anonimizzatore AI" -derivedDataPath build/DerivedData build`.
  Schermate senza mouse: build Debug con `ANONIMAIKER_PROVA=copione.json` (vedi `App/Prova/ProvaScript.swift`).
- Windows: `cd windows && npm test && npm run typecheck`; schermate con `ANONIMAIKER_PROVA` (vedi `windows/src/main/index.ts`);
  il workflow `.github/workflows/windows.yml` prova l'app installata su una macchina Windows vera.
- Usare sempre `ANONIMAIKER_DATI` su una cartella temporanea: mai i dati veri.
