// MARK: - Testo indicizzato per code point
//
// Le posizioni del motore sono in code point (come le stringhe di Python della pipeline originale): così i risultati
// del porting coincidono con quelli di riferimento.

/** Testo indicizzato per caratteri Unicode (code point). */
export class PIIText {
  readonly string: string;
  readonly scalars: number[];
  /** Da offset UTF-16 (regex di JavaScript) a indice di code point. */
  private readonly fromUTF16: Int32Array;
  /** Da indice di code point a offset UTF-16. */
  private readonly toUTF16: Int32Array;

  constructor(string: string) {
    this.string = string;
    const scalars: number[] = [];
    const from = new Int32Array(string.length + 1);
    const to: number[] = [];
    let i = 0;
    while (i < string.length) {
      const cp = string.codePointAt(i)!;
      const width = cp > 0xffff ? 2 : 1;
      to.push(i);
      from[i] = scalars.length;
      if (width === 2) from[i + 1] = scalars.length;
      scalars.push(cp);
      i += width;
    }
    from[string.length] = scalars.length;
    to.push(string.length);
    this.scalars = scalars;
    this.fromUTF16 = from;
    this.toUTF16 = Int32Array.from(to);
  }

  get count(): number {
    return this.scalars.length;
  }

  /** Il code point in posizione `index` (il `subscript` di Swift). */
  at(index: number): number {
    return this.scalars[index];
  }

  slice(start: number, end: number): string {
    if (start >= end) return "";
    const a = Math.max(0, start);
    const b = Math.min(end, this.scalars.length);
    if (a >= b) return "";
    return this.string.substring(this.toUTF16[a], this.toUTF16[b]);
  }

  /** Match di un'espressione regolare, con le posizioni in code point. */
  matches(regex: RegExp): { start: number; end: number }[] {
    const global = regex.global ? regex : new RegExp(regex.source, regex.flags + "g");
    global.lastIndex = 0;
    const result: { start: number; end: number }[] = [];
    let match: RegExpExecArray | null;
    while ((match = global.exec(this.string)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      result.push({ start: this.fromUTF16[start], end: this.fromUTF16[end] });
      if (match[0].length === 0) global.lastIndex = end + (this.string.codePointAt(end)! > 0xffff ? 2 : 1);
    }
    return result;
  }
}

// MARK: - Proprietà dei caratteri (come Unicode.Scalar in Swift)

const whiteSpace = /^\p{White_Space}$/u;
const letter = /^\p{L}$/u;
const number = /^\p{N}$/u;
const decimal = /^\p{Nd}$/u;
const alphabetic = /^\p{Alphabetic}$/u;

/** Caratteri con Numeric_Type=Digit (apici, cifre cerchiate…): JavaScript non ha la proprietà. */
const digitType = new Set<number>([
  0xb2, 0xb3, 0xb9, 0x1369, 0x136a, 0x136b, 0x136c, 0x136d, 0x136e, 0x136f, 0x1370, 0x1371, 0x19da, 0x2070, 0x2074, 0x2075,
  0x2076, 0x2077, 0x2078, 0x2079, 0x2080, 0x2081, 0x2082, 0x2083, 0x2084, 0x2085, 0x2086, 0x2087, 0x2088, 0x2089, 0x24ea,
  0x24ff, 0x10a40, 0x10a41, 0x10a42, 0x10a43,
  ...range(0x2460, 0x2468), ...range(0x2474, 0x247c), ...range(0x2488, 0x2490), ...range(0x24f5, 0x24fd),
  ...range(0x2776, 0x277e), ...range(0x2780, 0x2788), ...range(0x278a, 0x2792), ...range(0x1f100, 0x1f10a),
]);

/** Ideogrammi con un valore numerico (Numeric_Type=Numeric ma lettere): contano come numeri in Swift. */
const numericIdeographs = new Set<number>(Array.from("〇一二三四五六七八九十百千万萬億亿兆零壱弐参拾廿卅", (c) => c.codePointAt(0)!));

function range(a: number, b: number): number[] {
  const result: number[] = [];
  for (let i = a; i <= b; i++) result.push(i);
  return result;
}

const cache = new Map<number, number>();
const SPACE = 1, ALNUM = 2, DIGIT = 4, ALPHA = 8, NUMERIC = 16;

function flags(cp: number): number {
  let value = cache.get(cp);
  if (value !== undefined) return value;
  const s = String.fromCodePoint(cp);
  value = 0;
  if (whiteSpace.test(s) || (cp >= 0x1c && cp <= 0x1f)) value |= SPACE;
  const isNumeric = number.test(s) || numericIdeographs.has(cp);
  if (letter.test(s) || isNumeric) value |= ALNUM;
  if (decimal.test(s) || digitType.has(cp)) value |= DIGIT;
  if (alphabetic.test(s)) value |= ALPHA;
  if (isNumeric) value |= NUMERIC;
  cache.set(cp, value);
  return value;
}

/** `str.isspace()` di Python. */
export function pyIsSpace(cp: number): boolean {
  if (cp < 0x80) return cp === 0x20 || (cp >= 0x09 && cp <= 0x0d) || (cp >= 0x1c && cp <= 0x1f);
  return (flags(cp) & SPACE) !== 0;
}

/** `str.isalnum()` di Python: lettere (categorie L*) o caratteri numerici. */
export function pyIsAlnum(cp: number): boolean {
  if (cp < 0x80) return isASCIIAlnum(cp);
  return (flags(cp) & ALNUM) !== 0;
}

export function pyIsDigit(cp: number): boolean {
  if (cp < 0x80) return cp >= 0x30 && cp <= 0x39;
  return (flags(cp) & DIGIT) !== 0;
}

/** Carattere interno a una parola. */
export function isWordCharacter(cp: number): boolean {
  return pyIsAlnum(cp) || cp === 0x5f;
}

export function isASCIIAlnum(cp: number): boolean {
  return (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
}

/** `properties.isAlphabetic`. */
export function isAlphabetic(cp: number): boolean {
  return (flags(cp) & ALPHA) !== 0;
}

/** `properties.isWhitespace` (proprietà White_Space). */
export function isWhitespace(cp: number): boolean {
  return whiteSpace.test(String.fromCodePoint(cp));
}

// MARK: - Caratteri come in Swift (cluster di grafemi)

const segmenter = new Intl.Segmenter("it", { granularity: "grapheme" });

/** I `Character` di Swift: cluster di grafemi. */
export function characters(text: string): string[] {
  const result: string[] = [];
  for (const { segment } of segmenter.segment(text)) result.push(segment);
  return result;
}

/** `String.count` di Swift. */
export function characterCount(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

/** `Character.isNumber`: il primo code point ha un valore numerico. */
export function charIsNumber(character: string): boolean {
  return (flags(character.codePointAt(0)!) & NUMERIC) !== 0;
}

/** `Character.isLetter`: il primo code point è alfabetico. */
export function charIsLetter(character: string): boolean {
  return isAlphabetic(character.codePointAt(0)!);
}

/** `Character.isWhitespace`. */
export function charIsWhitespace(character: string): boolean {
  return isWhitespace(character.codePointAt(0)!);
}

/** `trimmingCharacters(in: .whitespacesAndNewlines)`: categorie Z*, da U+0009 a U+000D e U+0085. */
export function trimmed(text: string): string {
  return text.replace(/^[\t\n\v\f\r\u0085\p{Z}]+|[\t\n\v\f\r\u0085\p{Z}]+$/gu, "");
}

// MARK: - Espressioni regolari ICU in JavaScript
//
// NSRegularExpression usa ICU: `\d` sono tutte le cifre Unicode, `\s` è [\t\n\f\r\p{Z}], `\w` comprende lettere,
// segni e cifre di ogni alfabeto, `\b` si decide con quel `\w` e `$` vale anche prima dell'a-capo finale. Qui si
// traducono gli schemi copiati da Swift nella sintassi equivalente di JavaScript (con il flag `u`).

const ICU_S = String.raw`\t\n\f\r\p{Z}`;
const ICU_W = String.raw`\p{Alphabetic}\p{M}\p{Nd}\p{Pc}‌‍`;
const ICU_B = String.raw`(?:(?<=[${ICU_W}])(?![${ICU_W}])|(?<![${ICU_W}])(?=[${ICU_W}]))`;
const ICU_END = String.raw`(?=(?:\r\n|[\n\v\f\r\u0085  ])?$)`;

/** Uno schema ICU tradotto per JavaScript. `(?i)` all'inizio diventa il flag `i`. */
export function icu(pattern: string, options: { ignoreCase?: boolean; global?: boolean } = {}): RegExp {
  let ignoreCase = options.ignoreCase ?? false;
  if (pattern.startsWith("(?i)")) {
    ignoreCase = true;
    pattern = pattern.slice(4);
  }
  let out = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      const next = pattern[i + 1];
      i++;
      switch (next) {
        case "d": out += String.raw`\p{Nd}`; break;
        case "s": out += inClass ? ICU_S : `[${ICU_S}]`; break;
        case "w": out += inClass ? ICU_W : `[${ICU_W}]`; break;
        case "b": out += inClass ? String.raw`\x08` : ICU_B; break;
        case "-": out += inClass ? String.raw`\-` : "-"; break;
        default: out += "\\" + next;
      }
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      out += c;
      continue;
    }
    if (c === "[") {
      inClass = true;
      out += c;
      // «[]…]» e «[^]…]»: la prima «]» è letterale.
      if (pattern[i + 1] === "^") { out += "^"; i++; }
      continue;
    }
    if (c === "$") { out += ICU_END; continue; }
    out += c;
  }
  return new RegExp(out, "u" + (ignoreCase ? "i" : "") + (options.global === false ? "" : "g"));
}

/** `NSRegularExpression.escapedPattern(for:)`: i caratteri speciali con la «\» davanti. */
export function escapedPattern(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}
