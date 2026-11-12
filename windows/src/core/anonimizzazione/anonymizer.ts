import { Vault, type VaultMatching, type VaultStore } from "../dizionario";
import { PIIAnalysis, PIICategory, PIIDetectors, PIIText, isWhitespace, type PIIEngine, type PIIEntity, type Progress } from "../motore";
import { Masking } from "./masking";
import { Revealer, type RevealResult } from "./revealer";

// MARK: - Anonimizzare e riconvertire, con il dizionario unico
//
// Il motore trova le entità, le regole decidono quali nascondere, il dizionario dà a ognuna il suo segnaposto e si salva
// cifrato. Al ritorno i segnaposto tornano i dati veri con lo stesso dizionario.

/** Una parola da nascondere sempre, con la sua categoria (azienda, persona o altro dato). */
export class ForcedTerm {
  value: string;
  label: string;

  constructor(value: string, label: string) {
    this.value = value;
    this.label = label;
  }

  get id(): string {
    return Vault.normalized(this.value);
  }

  /** Le categorie fra cui scegliere, nell'ordine del menu. */
  static readonly labels = ["ORG", "FULLNAME", "OTHER"] as const;

  static title(label: string): string {
    switch (label) {
      case "ORG": return "Azienda o attività";
      case "FULLNAME": return "Persona";
      default: return "Altro dato";
    }
  }

  toJSON(): { value: string; label: string } {
    return { value: this.value, label: this.label };
  }
}

/** Cosa nascondere: categorie, eccezioni e dati già noti. */
export class AnonymizationSettings {
  /** Categorie che diventano segnaposto (di serie: dati personali e aziende). */
  hidden: Set<string>;
  /** «Mai nascondere»: per esempio il nome della tua agenzia. Si confrontano senza badare a maiuscole e forma societaria. */
  exceptions: string[];
  /** «Nascondi sempre»: parole che il motore non riconosce da solo (per esempio un'attività dal nome vago come
   *  «On Location»). Si nascondono ovunque compaiano, con la loro categoria, anche se la categoria è in chiaro. */
  forcedTerms: ForcedTerm[];
  /** Nascondi anche i dati già nel dizionario che il modello non ha riconosciuto in questo testo. */
  maskKnownValues: boolean;

  constructor(options: { hidden?: Iterable<string>; exceptions?: string[]; forcedTerms?: ForcedTerm[]; maskKnownValues?: boolean } = {}) {
    this.hidden = new Set(options.hidden ?? PIICategory.defaultHidden);
    this.exceptions = options.exceptions ?? [];
    this.forcedTerms = options.forcedTerms ?? [];
    this.maskKnownValues = options.maskKnownValues ?? true;
  }

  equals(other: AnonymizationSettings): boolean {
    return this.hidden.size === other.hidden.size && [...this.hidden].every((h) => other.hidden.has(h))
      && JSON.stringify(this.exceptions) === JSON.stringify(other.exceptions)
      && JSON.stringify(this.forcedTerms) === JSON.stringify(other.forcedTerms)
      && this.maskKnownValues === other.maskKnownValues;
  }

  toJSON(): { hidden: string[]; exceptions: string[]; forcedTerms: { value: string; label: string }[]; maskKnownValues: boolean } {
    return { hidden: [...this.hidden], exceptions: this.exceptions, forcedTerms: this.forcedTerms.map((t) => t.toJSON()), maskKnownValues: this.maskKnownValues };
  }

  // Le impostazioni salvate dalle versioni precedenti non hanno «nascondi sempre»: un campo che manca (o non si
  // legge) prende il valore di serie.
  static fromJSON(json: unknown): AnonymizationSettings {
    const o = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
    const strings = (v: unknown): string[] | undefined => Array.isArray(v) && v.every((x) => typeof x === "string") ? v as string[] : undefined;
    const terms = Array.isArray(o.forcedTerms) && o.forcedTerms.every((t) => typeof t === "object" && t !== null
      && typeof (t as Record<string, unknown>).value === "string" && typeof (t as Record<string, unknown>).label === "string")
      ? (o.forcedTerms as { value: string; label: string }[]).map((t) => new ForcedTerm(t.value, t.label)) : undefined;
    return new AnonymizationSettings({
      hidden: strings(o.hidden), exceptions: strings(o.exceptions), forcedTerms: terms,
      maskKnownValues: typeof o.maskKnownValues === "boolean" ? o.maskKnownValues : undefined,
    });
  }
}

/** Un dato del cliente con la sua categoria (il `KnownValue` del CRM): «Edilnord S.r.l.» è un'azienda, «Mario Rossi» un nome. */
export interface KnownValue {
  readonly label: string;
  readonly value: string;
}

/** Quanto è stato nascosto in un testo. */
export class AnonymizationReport {
  /** Segnaposto diversi usati, per categoria. */
  counts: Record<string, number>;
  /** Segnaposto usati, in ordine di categoria e numero. */
  placeholders: string[];
  /** Voci aggiunte al dizionario. */
  newEntries: number;

  constructor(used: readonly string[], newEntries: number) {
    const unique = [...new Set(used)].sort((a, b) => {
      const sa = Vault.split(a), sb = Vault.split(b);
      return sa.label === sb.label ? sa.number - sb.number : sa.label < sb.label ? -1 : 1;
    });
    this.placeholders = unique;
    this.counts = {};
    for (const placeholder of unique) {
      const label = Vault.split(placeholder).label;
      this.counts[label] = (this.counts[label] ?? 0) + 1;
    }
    this.newEntries = newEntries;
  }

  get isEmpty(): boolean {
    return this.placeholders.length === 0;
  }

  /** «3 nomi, 2 codici fiscali, 1 IBAN»: prima i più numerosi, a pari numero nell'ordine delle categorie. */
  get summary(): string {
    const labels = PIICategory.placeholderLabels;
    const rank = (label: string) => {
      const index = labels.indexOf(label);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    return Object.entries(this.counts).sort((a, b) => a[1] !== b[1] ? b[1] - a[1] : rank(a[0]) - rank(b[0]))
      .map(([label, count]) => `${count} ${PIICategory.name(label, count)}`).join(", ");
  }
}

export interface AnonymizationResult {
  text: string;
  report: AnonymizationReport;
}

/** Chi trova i dati personali in un testo: il motore vero o, nelle prove, la sola rete regex. */
export interface EntityFinder {
  entities(source: PIIText, progress?: Progress, signal?: AbortSignal): Promise<PIIEntity[]>;
}

/** Solo regex e checksum, senza modello (per le prove dei formati). */
export class RegexFinder implements EntityFinder {
  async entities(source: PIIText): Promise<PIIEntity[]> {
    const existing = source.matches(PIIAnalysis.placeholderRegex);
    return PIIAnalysis.merge(PIIDetectors.detect(source), source)
      .filter((entity) => !existing.some((e) => e.start < entity.end && entity.start < e.end));
  }
}

/** Le opzioni di `anonymize` (i parametri con valore di serie della versione Swift). */
export interface AnonymizeOptions {
  settings?: AnonymizationSettings;
  /** Il cliente del CRM a cui legare i dati trovati (UUID). */
  client?: string | null;
  /** I dati che il CRM sa già essere del cliente. */
  known?: readonly KnownValue[];
  matching?: VaultMatching;
  progress?: Progress;
  /** Per annullare fra un blocco e l'altro del modello. */
  signal?: AbortSignal;
}

/** Un documento di testo: il `TextDocument` dei formati, o qualsiasi cosa con un testo da sostituire. */
export interface TextDocumentLike<T> {
  readonly text: string;
  replacingText(text: string): T;
}

export class Anonymizer {
  readonly finder: EntityFinder;
  readonly store: VaultStore;

  /** `finder`: il motore (`PIIEngine`) o, nelle prove, `RegexFinder`. */
  constructor(finder: EntityFinder | PIIEngine, store: VaultStore) {
    this.finder = finder;
    this.store = store;
  }

  /** Anonimizza un testo con il dizionario dell'app (che si aggiorna e si salva). `client`: il cliente del CRM a cui
   *  legare i dati trovati. `known`: i dati che il CRM sa già essere del cliente; entrano nel dizionario e si
   *  nascondono anche dove il motore non li riconosce. */
  async anonymize(text: string, options: AnonymizeOptions = {}): Promise<AnonymizationResult> {
    const { settings = new AnonymizationSettings(), client = null, known = [], matching = "exact", progress, signal } = options;
    if (!Array.from(text).some((c) => !isWhitespace(c.codePointAt(0)!))) {
      return { text, report: new AnonymizationReport([], 0) };
    }
    const source = new PIIText(text);
    const found = await this.finder.entities(source, progress, signal);
    const exceptions = Masking.normalizedExceptions(settings.exceptions);
    const entities = Masking.withForced(Masking.withoutExceptions(Masking.masked(found, source, settings.hidden), source, exceptions),
      source, settings.forcedTerms);
    const hidden = settings.hidden;
    const maskKnown = settings.maskKnownValues;
    const { output, used, added } = await this.store.update((vault) => {
      const before = new Set(vault.entries.map((e) => e.placeholder));
      const seeded: string[] = [];
      for (const value of known) {
        if (hidden.has(value.label) && !Masking.isException(value.value, exceptions)) {
          seeded.push(vault.placeholder(value.label, value.value, { client }).placeholder);
        }
      }
      let { output, used } = Anonymizer.substitute(entities, source, vault, client, matching);
      // Con «dati già noti» spento si usano almeno quelli del cliente.
      const candidates = maskKnown ? vault.entries : seeded.map((p) => vault.entry(p)).filter((e) => e !== null);
      if (candidates.length > 0) {
        // Ogni grafia ha il suo segnaposto: «MARIO ROSSI» trovato grazie a «Mario Rossi» torna «MARIO ROSSI».
        const current = new PIIText(output);
        let rebuilt = "";
        let position = 0;
        for (const match of Masking.knownMatches(current, candidates, hidden, exceptions)) {
          const placeholder = vault.placeholder(match.label, current.slice(match.start, match.end), { client, matching }).placeholder;
          rebuilt += current.slice(position, match.start) + placeholder;
          used = [...used, placeholder];
          position = match.end;
        }
        output = rebuilt + current.slice(position, current.count);
      }
      return { output, used, added: [...new Set(used)].filter((p) => !before.has(p)).length };
    });
    return { text: output, report: new AnonymizationReport(used, added) };
  }

  /** Riconverte un testo (anche scritto da un'AI) con il dizionario dell'app. */
  async reveal(text: string): Promise<RevealResult> {
    return Revealer.reveal(text, await this.store.snapshot());
  }

  /** Le entità al posto dei loro segnaposto. */
  static substitute(entities: readonly PIIEntity[], source: PIIText, vault: Vault, client: string | null,
    matching: VaultMatching = "exact"): { output: string; used: string[]; added: number } {
    let output = "";
    const used: string[] = [];
    let added = 0;
    let position = 0;
    for (const entity of entities) {
      output += source.slice(position, entity.start);
      const { placeholder, isNew } = vault.placeholder(entity.label, source.slice(entity.start, entity.end), { client, matching });
      if (isNew) added += 1;
      used.push(placeholder);
      output += placeholder;
      position = entity.end;
    }
    output += source.slice(position, source.count);
    return { output, used, added };
  }

  /** Per le prove: tutte le entità trovate, con un dizionario usa e getta e senza le regole delle categorie (come la
   *  pipeline originale). Non tocca il dizionario dell'app. */
  static async trial(text: string, engine: EntityFinder): Promise<{ text: string; vault: Vault }> {
    const source = new PIIText(text);
    const entities = await engine.entities(source);
    const vault = new Vault();
    const { output } = Anonymizer.substitute(entities, source, vault, null);
    return { text: output, vault };
  }

  // MARK: - Documenti

  /** Un documento di testo anonimizzato, nella stessa codifica dell'originale. */
  async anonymizeDocument<T>(document: TextDocumentLike<T>, options: Omit<AnonymizeOptions, "matching"> = {}): Promise<{ document: T; report: AnonymizationReport }> {
    const result = await this.anonymize(document.text, options);
    return { document: document.replacingText(result.text), report: result.report };
  }

  /** Un documento con i segnaposto riconvertito con i dati veri. */
  async revealDocument<T>(document: TextDocumentLike<T>): Promise<{ document: T; result: RevealResult }> {
    const result = await this.reveal(document.text);
    return { document: document.replacingText(result.text), result };
  }
}
