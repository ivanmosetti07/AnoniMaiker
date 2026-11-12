import { Vault, type VaultEntry } from "../dizionario";
import {
  PIIAnalysis, PIICategory, PIIText, characterCount, characters, charIsLetter, charIsNumber, escapedPattern, icu, trimmed,
  type PIIEntity,
} from "../motore";

// MARK: - Quali entità diventano segnaposto
//
// Solo le categorie scelte; restano in chiaro gli indirizzi IP del PC e delle reti private, i numeri che il modello
// prende per civici senza una via davanti e le eccezioni («mai nascondere»). Dentro un indirizzo web lasciato in
// chiaro l'email si nasconde lo stesso. Quello che il modello dà per un dato a forma fissa (codice fiscale, IBAN, carta,
// targa, documento) deve averne almeno la forma: senza il contesto di una frase (le celle di una tabella) scambia per
// codici fiscali gli orari e i codici brevi. I luoghi che il modello prende per persone, aziende o vie restano in chiaro:
// «Hotel», «Circo Massimo», «Castel Sant'Angelo», «Via Cavour» senza numero civico.

/** Una parola da nascondere sempre, con la sua categoria (azienda, persona o altro dato). */
export interface ForcedTermLike {
  value: string;
  label: string;
}

/** Un dato già noto trovato nel testo. */
export interface KnownMatch {
  start: number;
  end: number;
  label: string;
  placeholder: string;
}

const emailRegex = icu(String.raw`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`);
/** Le parole che annunciano un dato catastale («Foglio 12, particella 345, sub. 6»). */
const cadastral = icu(String.raw`(?i)\b(?:fogli?o|fg|particell[ae]|part|mappal[ei]|map|sub|subalterno|catast[oa]|nceu|nct|categoria catastale|rendita)\b`, { global: false });
const legalFormDot = icu(String.raw`(?:^|\s)S(?:\.[A-Za-z]){1,4}$`, { global: false });
/** Un numero civico dopo una via: «Via Roma 12», «Via Roma, 12», «Via Roma n. 12». */
const civicNumber = icu(String.raw`^[ ,]{0,3}(?:n\.?\s?|nr\.?\s?|civico\s)?\d`, { global: false });
const legalForm = icu(String.raw`[\s,]*(?:S\.?\s?r\.?\s?l\.?|S\.?\s?p\.?\s?A\.?|S\.?\s?a\.?\s?s\.?|S\.?\s?n\.?\s?c\.?|S\.?\s?s\.?|&\s*C\.?|Srl|SpA|Sas|Snc)\s*$`, { ignoreCase: true });

/** Lo schema che trova una lista di valori a parola intera, senza badare a maiuscole e spazi. */
function wholeWords(values: string[]): RegExp | null {
  const pattern = values.map((v) => escapedPattern(v).replaceAll(" ", String.raw`\s+`)).join("|");
  try {
    return icu(String.raw`(?<![\p{L}\p{N}_])(?:` + pattern + String.raw`)(?![\p{L}\p{N}_])`, { ignoreCase: true });
  } catch {
    return null;
  }
}

/** Ordinamento dal più lungo (in caratteri), stabile come quello di Swift. */
function longestFirst(values: string[]): string[] {
  return values.map((v) => ({ v, n: characterCount(v) })).sort((a, b) => b.n - a.n).map((x) => x.v);
}

export const Masking = {
  masked(entities: PIIEntity[], text: PIIText, labels: ReadonlySet<string>): PIIEntity[] {
    const result: PIIEntity[] = [];
    entities.forEach((original, index) => {
      const value = text.slice(original.start, original.end);
      if (!labels.has(original.label)) {
        if (original.label === "URL" && labels.has("EMAIL")) {
          for (const m of new PIIText(value).matches(emailRegex)) {
            result.push({ label: "EMAIL", start: original.start + m.start, end: original.start + m.end, score: 1, validated: false, source: "regex" });
          }
        }
        return;
      }
      if (original.source === "modello" && !Masking.isPlausible(original, value, text)) return;
      if (Masking.isPlace(original.label, value, text.slice(original.end, Math.min(text.count, original.end + 16)))) return;
      if (original.label === "IPADDR" && Masking.isLocalAddress(value)) return;
      if (original.label === "BUILDINGNUM") {
        const previous = index > 0 ? entities[index - 1] : null;
        if (!previous || previous.label !== "STREET" || original.start - previous.end > 6) return;
      }
      const entity = { ...original };
      // «Edilnord S.r.l.»: il modello si ferma prima dell'ultimo punto; senza, riconvertendo uscirebbe «S.r.l».
      if (entity.label === "ORG" && entity.end < text.count && text.at(entity.end) === 0x2e && legalFormDot.test(value)) {
        entity.end += 1;
      }
      result.push(entity);
    });
    return result;
  },

  /** Un dato a forma fissa trovato dal modello ne ha almeno la forma. */
  isPlausible(entity: PIIEntity, value: string, text: PIIText): boolean {
    const chars = characters(value);
    const digits = chars.filter(charIsNumber).length;
    const letters = chars.filter(charIsLetter).length;
    const alphanumerics = digits + letters;
    switch (entity.label) {
      case "CF": return (alphanumerics >= 11 && letters > 0 && digits > 0) || digits === 11;
      case "PIVA": return digits >= 11;
      case "IBAN": return alphanumerics >= 15 && letters >= 2 && digits >= 8;
      case "CREDITCARDNUMBER": return digits >= 12;
      case "TELEPHONENUM": return digits >= 6;
      case "EMAIL": return value.includes("@");
      case "TARGA": return alphanumerics >= 5 && letters >= 2 && digits >= 2;
      case "ID_DOC": return alphanumerics >= 6 && digits >= 2;
      case "DOCID": return alphanumerics >= 5 && digits >= 1;
      case "IPADDR": return digits >= 4 && value.includes(".");
      case "CATASTO": {
        // Solo con le parole del catasto subito prima («Foglio 12», «sub. 6») o dentro il dato stesso.
        const before = text.slice(Math.max(0, entity.start - 16), entity.start);
        return cadastral.test(before + value);
      }
      default: return true;
    }
  },

  // MARK: Luoghi

  /** Parole comuni di luoghi e servizi: da sole (o solo fra loro) non sono un'azienda né una persona. */
  genericPlaceWords: new Set([
    "hotel", "albergo", "resort", "ostello", "residence", "spa", "ristorante", "trattoria", "osteria", "pizzeria", "bar",
    "caffe", "pub", "enoteca", "cantina", "agriturismo", "terrazza", "rooftop", "giardino", "giardini", "sala", "salone",
    "centro", "congressi", "congresso", "convegni", "auditorium", "teatro", "cinema", "museo", "musei", "galleria", "chiesa",
    "basilica", "cattedrale", "duomo", "piazza", "piazzale", "parco", "spiaggia", "porto", "aeroporto", "stazione",
    "terminal", "hall", "lobby", "reception", "ingresso", "uscita", "sede", "ufficio", "uffici", "location", "navetta",
    "pullman", "bus", "transfer", "treno", "volo", "voli", "gala", "cena", "pranzo", "colazione", "aperitivo",
  ]) as ReadonlySet<string>,

  /** Parole che aprono il nome di un luogo e non di una persona («Circo Massimo», «Castel Sant'Angelo», «Borgo Pio»).
   *  Restano fuori quelle che sono anche cognomi frequenti (Fontana, Villa, Torre, Porta, Ponte, Monte, Colle, Sala…). */
  placePrefixes: new Set([
    "circo", "castel", "borgo", "piazza", "piazzale", "palazzo", "basilica", "chiesa", "cattedrale", "duomo", "museo",
    "musei", "teatro", "parco", "giardino", "giardini", "lago", "foro", "fori", "terme", "via", "viale", "vicolo", "largo",
    "lungotevere", "lungarno", "lungomare", "stazione", "aeroporto", "cappella", "santuario", "abbazia", "hotel", "albergo",
    "ristorante", "trattoria", "osteria", "pizzeria",
  ]) as ReadonlySet<string>,

  /** Le parole di un valore, senza accenti e in minuscolo. */
  placeWords(value: string): string[] {
    const folded = value.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC").toLowerCase();
    const words: string[] = [];
    let current = "";
    for (const ch of characters(folded)) {
      if (charIsLetter(ch)) {
        current += ch;
      } else if (current) {
        words.push(current);
        current = "";
      }
    }
    if (current) words.push(current);
    return words;
  },

  /** Un luogo che il modello ha preso per persona, azienda o indirizzo: resta in chiaro. `after` è il testo subito dopo. */
  isPlace(label: string, value: string, after = ""): boolean {
    const words = Masking.placeWords(value);
    if (words.length === 0) return false;
    const first = words[0];
    switch (label) {
      case "ORG":
        return words.length <= 3 && words.every((w) => Masking.genericPlaceWords.has(w));
      case "FULLNAME":
        return words.every((w) => Masking.genericPlaceWords.has(w)) || Masking.placePrefixes.has(first);
      case "STREET":
        // Senza numero civico una via è un luogo («Via Cavour», «Lungotevere»); con il numero è un indirizzo.
        return !characters(value).some(charIsNumber) && !civicNumber.test(after);
      default:
        return false;
    }
  },

  /** Indirizzi del PC stesso e delle reti private (anche intervalli e reti «192.168.1.0/24»). */
  isLocalAddress(value: string): boolean {
    const parts: string[] = [];
    let current = "";
    for (const ch of characters(value)) {
      if (charIsNumber(ch) || ch === ".") {
        current += ch;
      } else if (current) {
        parts.push(current);
        current = "";
      }
    }
    if (current) parts.push(current);
    const first = parts[0] ?? value;
    const octets = first.split(".").filter((p) => p.length > 0).filter((p) => /^[+-]?[0-9]+$/.test(p)).map(Number);
    if (octets.length !== 4) return false;
    const [a, b] = octets;
    if (a === 127 || a === 10 || (a === 192 && b === 168) || a === 0 || (a === 169 && b === 254)) return true;
    return a === 172 && b >= 16 && b <= 31;
  },

  /** «Rossi Moto S.r.l.» → «Rossi Moto»: i testi spesso scrivono l'azienda senza la forma societaria. */
  withoutLegalForm(value: string): string {
    return value.replace(legalForm, "");
  },

  /** Le eccezioni, normalizzate (anche senza forma societaria). */
  normalizedExceptions(exceptions: readonly string[]): Set<string> {
    const result = new Set<string>();
    for (const exception of exceptions) {
      const normalized = Vault.normalized(exception);
      if (normalized === "") continue;
      result.add(normalized);
      result.add(Vault.normalized(Masking.withoutLegalForm(exception)));
    }
    result.delete("");
    return result;
  },

  isException(value: string, exceptions: ReadonlySet<string>): boolean {
    if (exceptions.size === 0) return false;
    return exceptions.has(Vault.normalized(value)) || exceptions.has(Vault.normalized(Masking.withoutLegalForm(value)));
  },

  withoutExceptions(entities: PIIEntity[], text: PIIText, exceptions: ReadonlySet<string>): PIIEntity[] {
    if (exceptions.size === 0) return entities;
    return entities.filter((e) => !Masking.isException(text.slice(e.start, e.end), exceptions));
  },

  /** Le parole di «nascondi sempre» dove compaiono (senza badare a maiuscole e spazi, a parola intera e fuori dai
   *  segnaposto che ci sono già). Vincono su quello che ha trovato il motore nello stesso punto. */
  withForced(entities: PIIEntity[], text: PIIText, terms: readonly ForcedTermLike[]): PIIEntity[] {
    const forced = Masking.forcedMatches(text, terms);
    if (forced.length === 0) return entities;
    const kept = entities.filter((entity) => !forced.some((f) => f.start < entity.end && entity.start < f.end));
    return [...kept, ...forced].sort((a, b) => a.start - b.start);
  },

  forcedMatches(text: PIIText, terms: readonly ForcedTermLike[]): PIIEntity[] {
    const list = terms.filter((t) => trimmed(t.value) !== "");
    if (list.length === 0) return [];
    const byValue = new Map<string, string>();
    for (const term of list) {
      const key = Vault.normalized(term.value);
      if (!byValue.has(key)) byValue.set(key, term.label);
    }
    const regex = wholeWords(longestFirst(list.map((t) => trimmed(t.value))));
    if (!regex) return [];
    const existing = text.matches(PIIAnalysis.placeholderRegex);
    const result: PIIEntity[] = [];
    for (const match of text.matches(regex)) {
      if (existing.some((e) => e.start < match.end && match.start < e.end)) continue;
      const label = byValue.get(Vault.normalized(text.slice(match.start, match.end)));
      if (label === undefined) continue;
      result.push({ label, start: match.start, end: match.end, score: 1, validated: true, source: "regex" });
    }
    return result;
  },

  /** I dati già nel dizionario che il modello non ha visto in questo testo diventano i loro segnaposto: un nome trovato
   *  nel primo paragrafo non resta in chiaro nel quinto. Restano fuori i nomi di una parola sola («Marco»: troppo
   *  comuni) e i valori di meno di 4 caratteri. Con una lista di voci, solo quelle (per esempio i dati noti di un cliente). */
  maskKnown(text: string, vault: Vault | readonly VaultEntry[], labels: ReadonlySet<string>, exceptions: ReadonlySet<string>): { text: string; used: string[] } {
    const entries = Array.isArray(vault) ? (vault as readonly VaultEntry[]) : (vault as Vault).entries;
    const source = new PIIText(text);
    const matches = Masking.knownMatches(source, entries, labels, exceptions);
    if (matches.length === 0) return { text, used: [] };
    let output = "";
    let position = 0;
    for (const match of matches) {
      output += source.slice(position, match.start) + match.placeholder;
      position = match.end;
    }
    return { text: output + source.slice(position, source.count), used: matches.map((m) => m.placeholder) };
  },

  /** Dove compaiono i dati già noti (posizioni in code point), fuori dai segnaposto che ci sono già: categoria e
   *  segnaposto della voce trovata (che può avere un'altra grafia: chi anonimizza ne dà uno alla grafia esatta). */
  knownMatches(text: PIIText, entries: readonly VaultEntry[], labels: ReadonlySet<string>, exceptions: ReadonlySet<string>): KnownMatch[] {
    const identifying = new Set([...labels].filter((l) => PIICategory.identifying.has(l)));
    const known = entries.filter((entry) => {
      if (!identifying.has(entry.label) || characterCount(entry.value) < 4 || Masking.isException(entry.value, exceptions)
        || Masking.isPlace(entry.label, entry.value)) return false;
      return entry.label !== "FULLNAME" || entry.value.split(" ").filter((w) => w.length > 0).length >= 2;
    });
    if (known.length === 0) return [];
    const aliases: { value: string; entry: VaultEntry }[] = known.map((entry) => ({ value: entry.value, entry }));
    for (const entry of known) {
      if (entry.label !== "ORG") continue;
      const core = Masking.withoutLegalForm(entry.value);
      if (core !== entry.value && characterCount(core) >= 4) aliases.push({ value: core, entry });
    }
    const byValue = new Map<string, VaultEntry>();
    for (const alias of aliases) {
      const key = Vault.normalized(alias.value);
      if (!byValue.has(key)) byValue.set(key, alias.entry);
    }
    const regex = wholeWords(longestFirst(aliases.map((a) => a.value)));
    if (!regex) return [];
    // Niente dentro i segnaposto che ci sono già.
    const existing = text.matches(PIIAnalysis.placeholderRegex);
    const result: KnownMatch[] = [];
    for (const match of text.matches(regex)) {
      if (existing.some((e) => e.start < match.end && match.start < e.end)) continue;
      const entry = byValue.get(Vault.normalized(text.slice(match.start, match.end)));
      if (!entry) continue;
      result.push({ start: match.start, end: match.end, label: entry.label, placeholder: entry.placeholder });
    }
    return result;
  },
};
