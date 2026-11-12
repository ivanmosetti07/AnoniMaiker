import {
  PIIText, characters, characterCount, icu, isAlphabetic, isASCIIAlnum, pyIsAlnum, pyIsDigit, pyIsSpace, trimmed,
} from "./piiText";

// MARK: - Rete regex + checksum
//
// I dati a forma fissa (email, codici fiscali, IBAN, carte, partite IVA, telefoni, targhe, indirizzi web e IP, codici
// di atti, date e importi): li trova la rete regex, e dove c'è un codice di controllo lo verifica prima di fidarsi.

export type PIIEntitySource = "modello" | "regex";

/** Un dato personale trovato nel testo (posizioni in code point). */
export interface PIIEntity {
  label: string;
  start: number;
  end: number;
  score: number;
  validated: boolean;
  source: PIIEntitySource;
}

/** Le due origini di un'entità, con i nomi di Swift (`.model`, `.regex`). */
export const PIIEntitySource = { model: "modello", regex: "regex" } as const;

const ASCII_DIGIT = /^[0-9]$/;

/** `Int(String(c))` di Swift su una cifra: solo le cifre ASCII. */
function asciiDigit(cp: number): number | null {
  return cp >= 0x30 && cp <= 0x39 ? cp - 0x30 : null;
}

interface Detector {
  label: string;
  regex: RegExp;
  validator: ((value: string) => boolean) | null;
  strict: boolean;
}

export const PIIDetectors = {
  // MARK: Checksum

  ibanOK(value: string): boolean {
    let compact = "";
    for (const ch of value) {
      const cp = ch.codePointAt(0)!;
      if (!(pyIsSpace(cp) || ch === "." || ch === "-")) compact += ch;
    }
    const s = characters(compact.toUpperCase());
    if (s.length < 15 || s.length > 34) return false;
    const rotated = [...s.slice(4), ...s.slice(0, 4)];
    let remainder = 0;
    for (const character of rotated) {
      const scalars = Array.from(character);
      if (scalars.length !== 1) return false;
      const scalar = character.codePointAt(0)!;
      if (isAlphabetic(scalar)) {
        // ord(c) - 55: «A» vale 10 (anche per le lettere non latine, che poi non passano il conto)
        const number = scalar - 55;
        if (number < 0) return false;
        for (const digit of String(number)) remainder = (remainder * 10 + Number(digit)) % 97;
      } else if (ASCII_DIGIT.test(character) && pyIsDigit(scalar)) {
        remainder = (remainder * 10 + Number(character)) % 97;
      } else {
        return false;
      }
    }
    return remainder === 1;
  },

  pivaOK(value: string): boolean {
    const digits: number[] = [];
    for (const ch of value) {
      const cp = ch.codePointAt(0)!;
      if (pyIsDigit(cp)) {
        const d = asciiDigit(cp);
        if (d !== null) digits.push(d);
      }
    }
    if (digits.length !== 11) return false;
    let total = 0;
    for (let index = 0; index < 10; index++) {
      const digit = digits[index];
      if (index % 2 === 0) {
        total += digit;
      } else {
        const doubled = digit * 2;
        total += doubled > 9 ? doubled - 9 : doubled;
      }
    }
    return (10 - (total % 10)) % 10 === digits[10];
  },

  cfOK(value: string): boolean {
    const c = characters(trimmed(value).toUpperCase());
    if (c.length !== 16 || !c.every((ch) => Array.from(ch).every((s) => pyIsAlnum(s.codePointAt(0)!)))) return false;
    let total = 0;
    for (let index = 0; index < 15; index++) {
      const character = c[index];
      if (index % 2 === 0) {
        const value = cfOdd.get(character);
        if (value === undefined) return false;
        total += value;
      } else if (/^[0-9]$/.test(character)) {
        total += Number(character);
      } else if (character.length === 1 && character.charCodeAt(0) < 0x80) {
        total += character.charCodeAt(0) - 65;
      } else if (character === "\r\n") {
        total += 10 - 65;
      } else {
        return false;
      }
    }
    return String.fromCharCode(65 + (((total % 26) + 26) % 26)) === c[15];
  },

  luhnOK(value: string): boolean {
    const digits: number[] = [];
    for (const ch of value) {
      const cp = ch.codePointAt(0)!;
      if (pyIsDigit(cp)) {
        const d = asciiDigit(cp);
        if (d !== null) digits.push(d);
      }
    }
    if (digits.length < 13 || digits.length > 19) return false;
    let total = 0;
    let alternate = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = digits[i];
      if (alternate) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      total += n;
      alternate = !alternate;
    }
    return total % 10 === 0;
  },

  /** Etichette della rete regex senza un checksum a confermarle: il modello può sovrascriverle. */
  softRegexLabels: new Set(["DATE"]) as ReadonlySet<string>,

  // MARK: IBAN a gruppi

  ibanLength: ((): ReadonlyMap<string, number> => {
    const list = "AD24 AE23 AL28 AT20 AZ28 BA20 BE16 BG22 BH22 BI27 BR29 BY28 CH21 CR22 CY28 CZ24 DE22 DJ27 DK18 DO28 EE20 EG29 ES24 FI18 FK18 FO18 FR27 GB22 GE22 GI23 GL18 GR27 GT28 HN28 HR21 HU28 IE22 IL23 IQ23 IS26 IT27 JO30 KW30 KZ20 LB28 LC32 LI21 LT20 LU20 LV21 LY25 MC27 MD24 ME22 MK19 MN20 MR27 MT31 MU30 NI28 NL18 NO15 OM23 PK24 PL28 PS29 PT25 QA29 RO24 RS22 RU33 SA24 SC31 SD18 SE24 SI19 SK24 SM27 SO23 ST25 SV28 TL23 TN24 TR26 UA29 VA22 VG24 XK20 YE30";
    return new Map(list.split(" ").map((item) => [item.slice(0, 2), Number(item.slice(2))]));
  })(),

  /** IBAN stampato a gruppi («IT60 X054 2811 …»): dalla sigla del paese si consumano esattamente i caratteri previsti. */
  detectIBAN(text: PIIText): PIIEntity[] {
    const entities: PIIEntity[] = [];
    for (const match of text.matches(ibanHead)) {
      const head = text.slice(match.start, match.start + 2).toUpperCase();
      const expected = PIIDetectors.ibanLength.get(head);
      if (expected === undefined) continue;
      let i = match.start;
      if (i > 0 && pyIsAlnum(text.at(i - 1))) continue;
      const start = i;
      let chars = 0, separators = 0, run = 0, newlines = 0;
      let grouped = false;
      while (i < text.count && chars < expected) {
        const c = text.at(i);
        if (isASCIIAlnum(c)) {
          chars += 1;
          run += 1;
          separators = 0;
        } else if (separators < ibanMaxSeparators && run <= ibanRun && (c === 0x2e || c === 0x2d || pyIsSpace(c))) {
          separators += 1;
          run = 0;
          grouped = true;
          if (pyIsSpace(c) && c !== 0x20 && c !== 0x09 && c !== 0xa0) newlines += 1;
          if (newlines > 1) break;
        } else {
          break;
        }
        i += 1;
      }
      if (chars < expected || (i < text.count && isASCIIAlnum(text.at(i)))) continue;
      const value = text.slice(start, i);
      if (grouped) {
        const groups: number[] = [];
        let current = 0;
        for (const ch of value) {
          const cp = ch.codePointAt(0)!;
          if (pyIsSpace(cp) || ch === "." || ch === "-") {
            if (current > 0) groups.push(current);
            current = 0;
          } else {
            current += 1;
          }
        }
        if (current > 0) groups.push(current);
        if (groups.length === 0) continue;
        const first = groups[0], last = groups[groups.length - 1];
        if (new Set(groups.slice(0, -1)).size > 1 || last > first) continue;
      }
      if (PIIDetectors.ibanOK(value)) {
        entities.push({ label: "IBAN", start, end: i, score: 1, validated: true, source: "regex" });
      }
    }
    // Due candidati sovrapposti: si maschera l'unione.
    entities.sort((a, b) => a.start - b.start);
    for (let index = 0; index < entities.length - 1; index++) {
      if (entities[index + 1].start < entities[index].end) {
        entities[index + 1].start = entities[index].start;
        entities[index + 1].end = Math.max(entities[index].end, entities[index + 1].end);
        entities[index].end = entities[index].start;
      }
    }
    return entities.filter((e) => e.end > e.start);
  },

  /** Entità della rete regex. `validated` solo quando il checksum passa. */
  detect(text: PIIText): PIIEntity[] {
    const entities = PIIDetectors.detectIBAN(text);
    for (const detector of detectors()) {
      for (const match of text.matches(detector.regex)) {
        let end = match.end;
        if (detector.label === "URL") {
          while (end > match.start && urlTrail.has(text.at(end - 1))) end -= 1;
          if (end <= match.start) continue;
        }
        let ok = detector.validator ? detector.validator(text.slice(match.start, match.end)) : false;
        if (!ok && detector.label === "CREDITCARDNUMBER") {
          ({ end, ok } = cardWithoutExpiry(text, match.start, end));
        }
        if (detector.validator !== null && detector.strict && !ok) continue;
        entities.push({ label: detector.label, start: match.start, end, score: ok ? 1 : 0.9, validated: ok, source: "regex" });
      }
    }
    return entities;
  },

  // MARK: Ore

  /** Estende le ore trovate dal modello all'ora intera («18[TIME_1]28» → «[TIME_1]»). Solo allargamenti. */
  completeTime(entities: PIIEntity[], text: PIIText): void {
    if (!entities.some((e) => e.label === "TIME")) return;
    const spans = text.matches(timeRegex);
    for (const entity of entities) {
      if (entity.label !== "TIME") continue;
      let j = -1;
      for (let k = spans.length - 1; k >= 0; k--) {
        if (spans[k].start < entity.end) { j = k; break; }
      }
      while (j >= 0 && spans[j].end > entity.start) {
        entity.start = Math.min(entity.start, spans[j].start);
        entity.end = Math.max(entity.end, spans[j].end);
        j -= 1;
      }
    }
  },
};

const cfOdd = new Map<string, number>(Object.entries({
  0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9,
  F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12,
  T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
}));

// MARK: Rete regex

let detectorList: Detector[] | null = null;

function detectors(): Detector[] {
  if (detectorList) return detectorList;
  const rx = (pattern: string, ignoreCase = false) => icu(pattern, { ignoreCase });
  detectorList = [
    { label: "EMAIL", regex: rx(String.raw`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`), validator: null, strict: true },
    { label: "CF", regex: rx(String.raw`\b[A-Za-z]{6}\d{2}[A-Za-z]\d{2}[A-Za-z]\d{3}[A-Za-z]\b`), validator: PIIDetectors.cfOK, strict: false },
    { label: "CF", regex: rx(String.raw`\b[A-Za-z]{6}[\dLMNPQRSTUVlmnpqrstuv]{2}[A-Za-z][\dLMNPQRSTUVlmnpqrstuv]{2}[A-Za-z][\dLMNPQRSTUVlmnpqrstuv]{3}[A-Za-z]\b`),
      validator: PIIDetectors.cfOK, strict: true },
    { label: "IBAN", regex: rx(String.raw`\b[A-Za-z]{2}\d{2}[A-Za-z0-9]{11,30}\b`), validator: PIIDetectors.ibanOK, strict: true },
    { label: "CREDITCARDNUMBER", regex: rx(String.raw`(?<!\d)\d(?:[ .\-]?\d){12,18}(?!\d)`), validator: PIIDetectors.luhnOK, strict: true },
    { label: "PIVA", regex: rx(String.raw`(?<!\d)\d{11}(?!\d)`), validator: PIIDetectors.pivaOK, strict: true },
    { label: "TELEPHONENUM", regex: rx(String.raw`(?<![\w.])(?:\+39[\s.\-]?)?(?:3\d{2}[\s.\-]?\d{3}[\s.\-]?\d{3,4}|0\d{1,3}[\s.\-]?\d{5,8})(?![\w])`),
      validator: null, strict: true },
    { label: "AMOUNT", regex: rx(String.raw`(?:€|EUR|euro)\s?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?|\d{1,3}(?:\.\d{3})*,\d{2}\s?(?:€|EUR|euro)`, true),
      validator: null, strict: true },
    { label: "TARGA", regex: rx(String.raw`\b[A-Za-z]{2}[\s-]?\d{3}[\s-]?[A-Za-z]{2}\b`), validator: null, strict: true },
    { label: "URL", regex: rx(String.raw`(?:https?|ftp)://[^\s<>"']+|www\.[A-Za-z0-9\-._~%]+\.[A-Za-z]{2,}(?:/[^\s<>"']*)?|\b(?:[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?\.)+(?:it|com|net|org|eu|info|io|dev|app|gov|edu|cloud|online|site|blog)\b(?:/[^\s<>"']*)?`, true),
      validator: null, strict: true },
    { label: "IPADDR", regex: rx(String.raw`\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?:/(?:3[0-2]|[12]?\d))?(?:\s*-\s*(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})?\b`),
      validator: null, strict: true },
    { label: "DOCID", regex: rx(String.raw`\b(?:R\.?G\.?\s*N\.?R\.?|R\.?G\.?|RG|Prot\.?|protocollo|Rep\.?|repertorio)(?:\s*(?:n\.?|num\.?|nro\.?))?\s*\d{1,8}(?:[/\-]\d{2,4})?\b`, true),
      validator: null, strict: true },
    { label: "DATE", regex: rx(String.raw`(?<!\d)(?:0?[1-9]|[12]\d|3[01])[/.\-](?:0?[1-9]|1[0-2])[/.\-](?:19|20)\d{2}(?:\s+\d{1,2}[.:]\d{2})?(?!\d)`),
      validator: null, strict: true },
  ];
  return detectorList;
}

const urlTrail = new Set(Array.from(".,;:!?)]}»\"'", (c) => c.codePointAt(0)!));

const ibanHead = icu(String.raw`(?<![A-Za-z0-9])[A-Za-z]{2}\d{2}`);
const ibanMaxSeparators = 3;
const ibanRun = 5;

// MARK: Carta con la scadenza attaccata

const cardLengths = [19, 18, 17, 16, 15, 14, 13];

function looksLikeExpiry(tail: string): boolean {
  const count = characterCount(tail);
  if (count < 2 || count > 4) return false;
  const prefix = characters(tail).slice(0, 2).join("");
  if (!/^[0-9]+$/.test(prefix)) return false;
  const month = Number(prefix);
  return month >= 1 && month <= 12;
}

/** «4111 1111 1111 1111 12/26»: si riprova tagliando la scadenza, solo su un separatore e con un mese plausibile. */
function cardWithoutExpiry(text: PIIText, start: number, end: number): { end: number; ok: boolean } {
  const s = text.scalars.slice(start, end);
  const digits: number[] = [];
  s.forEach((cp, index) => { if (pyIsDigit(cp)) digits.push(index); });
  for (const length of cardLengths) {
    const extra = digits.length - length;
    if (!(extra > 0 && extra <= 4)) continue;
    const cut = digits[length - 1] + 1;
    if (!(cut < s.length && (s[cut] === 0x20 || s[cut] === 0x2e || s[cut] === 0x2d))) continue;
    const tail = String.fromCodePoint(...s.slice(cut).filter(pyIsDigit));
    const head = String.fromCodePoint(...s.slice(0, cut));
    if (looksLikeExpiry(tail) && PIIDetectors.luhnOK(head)) return { end: start + cut, ok: true };
  }
  return { end, ok: false };
}

const timeRegex = icu(String.raw`(?<!\d)(?<!\d[.:])(?:[01]?\d|2[0-3])[.:][0-5]\d(?:[.:][0-5]\d)?(?!\d)(?![.:]\d)`);
