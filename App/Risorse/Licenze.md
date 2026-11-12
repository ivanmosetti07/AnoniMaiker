# Licenze di terze parti

AnoniMaiker · © 2026 Ivan Mosetti · software libero con licenza GNU GPL v3 o successiva
(https://www.gnu.org/licenses/gpl-3.0.html). Le parti di terzi qui sotto mantengono le loro licenze, compatibili con la GPL.

## Motore di anonimizzazione

Il motore di anonimizzazione usa un modello di classificazione dei token (pesi convertiti in Core ML, inclusi nell'app)
e una pipeline di rilevamento (espressioni regolari, controlli di checksum e post-elaborazione) portata in Swift.
Modello e pipeline sono distribuiti con la licenza seguente.

```text
MIT License

Copyright (c) 2026 Simone Rizzo — Rizzo AI Academy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Modello di base

Il modello del motore deriva da mmBERT-base (jhu-clsp/mmBERT-base), degli autori di mmBERT del Center for Language
and Speech Processing della Johns Hopkins University, pubblicato con licenza MIT (stesso testo di permesso riportato
sopra).

## Versione Windows

La versione per Windows include anche: Electron, React, ONNX Runtime, pdf-lib, @pdf-lib/fontkit e fflate (licenza
MIT); PDF.js (licenza Apache 2.0); il carattere Liberation Sans, usato nei PDF creati dall'app (licenza SIL Open Font
License 1.1). Le icone dell'interfaccia vengono da Lucide (licenza ISC). Il motore è lo stesso modello del Mac,
convertito in ONNX, con la licenza MIT riportata sopra.
