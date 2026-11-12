# AnoniMaiker per Windows: regole del porting

La versione Windows è la stessa app del Mac riscritta in TypeScript su Electron. Il codice Swift resta la fonte di
verità: ogni comportamento, testo dell'interfaccia e formato di file si copia da lì.

## Dove sta cosa

| Mac (Swift)                                          | Windows (TypeScript)                  |
|------------------------------------------------------|---------------------------------------|
| `Packages/AnonymizerKit/Sources/AnonymizerKit/<Cartella>/<Nome>.swift` | `windows/src/core/<cartella>/<nome>.ts` (cartella in minuscolo, nome in camelCase: `Motore/PIIEngine.swift` → `src/core/motore/piiEngine.ts`) |
| `Packages/AnonymizerKit/Tests/AnonymizerKitTests/<Nome>Tests.swift` | `windows/tests/<nome>.test.ts` (vitest) |
| `App/AppModel*.swift`                                | `windows/src/main/` (processo principale di Electron) |
| `App/*View*.swift`                                   | `windows/src/renderer/` (React) |
| `App/Tema/Tema.swift` (colori, misure, pulsanti, mattoni) | `windows/src/renderer/styles.css` e `ui/components.tsx` |
| `App/CRM/*.swift`                                    | `windows/src/renderer/crm/` |
| `App/ChatView.swift`, `ChatGPTConnectView.swift`, `ChatMarkdown.swift` | `windows/src/renderer/chat/` |
| `App/Prova/ProvaScript.swift` (copioni di prova)     | `runScript` in `windows/src/main/index.ts` |

Le due app restano allineate per regola: vedi `CLAUDE.md` alla radice.

- `src/core` è la libreria (AnonymizerKit): solo Node, **mai** `electron` né il DOM. Funziona anche sotto vitest.
- Ogni cartella di `src/core` ha un `index.ts` che riesporta ciò che usano le altre.
- Le dipendenze già installate sono quelle di `package.json`: `onnxruntime-node` (motore), `fflate` (zip),
  `pdfjs-dist` (lettura PDF), `pdf-lib` (scrittura PDF). Non aggiungerne senza motivo; se servono, dillo nel resoconto.

## Stile

- TypeScript `strict`, moduli ES, niente `any` salvo dove non si può evitare.
- Commenti in italiano, brevi, come quelli del file Swift da cui viene il codice (si possono tradurre quasi parola per parola).
- Nomi di tipi e funzioni uguali a Swift (`Anonymizer`, `anonymize`, `PIIEntity`…), così chi passa da un codice all'altro si ritrova.
- I messaggi per l'utente restano in italiano e identici al Mac, cambiando «Mac» in «PC» solo dove parla del computer.
- Funzioni sincrone dove Swift è sincrono; `async` dove Swift è `async` o dove Node lo impone (onnxruntime, file grandi).

## Testi e posizioni

Il motore conta le posizioni in **code point**, come Python e come `PIIText` in Swift. In JavaScript le stringhe sono
UTF-16: usa `Array.from(testo)` (o un tipo come `PIIText`) e converti gli indici delle regex. Le regex Swift sono ICU
(`NSRegularExpression`): in JS servono il flag `u` e attenzione a `\b`, `\w`, `\s` e alle classi Unicode.

## Dati e sicurezza

- Cartella dei dati: `%APPDATA%\AnoniMaiker` su Windows (su Mac/Linux, per le prove, `~/.anonimaiker`); la variabile
  d'ambiente `ANONIMAIKER_DATI` la sostituisce, come su Mac.
- Cifratura: AES-GCM a 256 bit con `node:crypto`, nello stesso formato di CryptoKit (`nonce 12 byte ‖ testo cifrato ‖ tag 16 byte`).
- La chiave dei dati la protegge un «custode» iniettato (interfaccia `KeyProtection`): su Windows lo realizza il
  processo principale con `safeStorage` di Electron (DPAPI); nelle prove una chiave in chiaro.
- Le **copie di sicurezza** hanno lo stesso formato del Mac, byte per byte: una copia fatta su Mac si ripristina su
  Windows e viceversa. È il modo di portare i dati da un computer all'altro.

## Prove

- `npm test` esegue vitest. Ogni file di test Swift ha il suo gemello in `tests/`, con gli stessi casi.
- Il motore ONNX sta in `windows/engine/` (`model.onnx`, `tokenizer.json`, `config.json`); le prove che lo usano si
  saltano se manca.
- Per confrontarsi col Mac: `cd Packages/AnonymizerKit && swift run anonimizza --motore /Applications/AnoniMaiker.app/Contents/Resources/Engine "testo"`.
