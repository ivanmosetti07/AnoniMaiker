import { ColumnHints, SegmentedText, type SegmentReplacements } from "../documenti/segmentedText";
import { PIIAnalysis, PIIText, pyIsSpace, type PIIEntity } from "../motore";
import { AnonymizationReport, AnonymizationSettings, type Anonymizer, type AnonymizeOptions } from "./anonymizer";
import { Masking } from "./masking";

// MARK: - Anonimizzare un testo a segmenti (celle, paragrafi, pagine)
//
// Stesse regole del testo semplice (categorie, eccezioni, dati noti del cliente e del dizionario), più le colonne
// riconosciute dall'intestazione. Il risultato sono le sostituzioni di ogni segmento: chi legge il file le rimette nei
// suoi nodi di testo.

/** `anonymize(_ content: SegmentedText, …)` di Swift: in TypeScript una funzione a parte (niente overload per tipo). */
export async function anonymizeSegmented(anonymizer: Anonymizer, content: SegmentedText, options: Omit<AnonymizeOptions, "signal"> & { signal?: AbortSignal } = {})
  : Promise<{ replacements: SegmentReplacements; report: AnonymizationReport }> {
  const { settings = new AnonymizationSettings(), client = null, known = [], matching = "exact", progress, signal } = options;
  if (content.isEmpty) return { replacements: new Map(), report: new AnonymizationReport([], 0) };
  const { text, ranges } = content.layout();
  const found = await anonymizer.finder.entities(text, progress, signal);
  const exceptions = Masking.normalizedExceptions(settings.exceptions);
  const entities = Masking.withForced(Masking.withoutExceptions(Masking.masked(found, text, settings.hidden), text, exceptions),
    text, settings.forcedTerms);

  const trimmed = (start: number, end: number): [number, number] => {
    while (start < end && pyIsSpace(text.at(start))) start += 1;
    while (end > start && pyIsSpace(text.at(end - 1))) end -= 1;
    return [start, end];
  };

  // Ai confini dei segmenti un dato si spezza: ogni pezzo resta nella sua cella o nel suo paragrafo.
  const pieces: { segment: number; start: number; end: number; label: string }[] = [];
  const covered = new Set<number>();
  for (const entity of entities) {
    let segment = SegmentedText.firstSegment(entity.start, ranges);
    while (segment < ranges.length && ranges[segment].start < entity.end) {
      const [start, end] = trimmed(Math.max(entity.start, ranges[segment].start), Math.min(entity.end, ranges[segment].end));
      // Anche il pezzo che resta in una cella deve avere la forma del dato («AB-12» non è un documento).
      const piece: PIIEntity = { label: entity.label, start, end, score: entity.score, validated: entity.validated, source: entity.source };
      if (end > start && (entity.source !== "modello" || Masking.isPlausible(piece, text.slice(start, end), text))) {
        pieces.push({ segment, start, end, label: entity.label });
        covered.add(segment);
      }
      segment += 1;
    }
  }
  // Le colonne riconosciute dall'intestazione: la cella intera, se il motore non ci ha trovato niente.
  for (const [segment, label] of [...content.hints].sort((a, b) => a[0] - b[0])) {
    if (!settings.hidden.has(label) || covered.has(segment)) continue;
    const [start, end] = trimmed(ranges[segment].start, ranges[segment].end);
    if (end <= start) continue;
    const value = text.slice(start, end);
    if (!ColumnHints.accepts(value, label) || Masking.isException(value, exceptions)
      || new PIIText(value).matches(PIIAnalysis.placeholderRegex).length > 0) continue;
    pieces.push({ segment, start, end, label });
  }

  const hidden = settings.hidden;
  const maskKnown = settings.maskKnownValues;
  // In ordine di documento: i numeri dei segnaposto seguono l'ordine in cui i dati compaiono.
  const finalPieces = [...pieces].sort((a, b) => a.start - b.start);
  const { replacements, used, added } = await anonymizer.store.update((vault) => {
    const before = new Set(vault.entries.map((e) => e.placeholder));
    const seeded: string[] = [];
    for (const value of known) {
      if (hidden.has(value.label) && !Masking.isException(value.value, exceptions)) {
        seeded.push(vault.placeholder(value.label, value.value, { client }).placeholder);
      }
    }
    const replacements: SegmentReplacements = new Map();
    const add = (segment: number, replacement: SegmentedText.Replacement) => {
      const list = replacements.get(segment);
      if (list) list.push(replacement); else replacements.set(segment, [replacement]);
    };
    const used: string[] = [];
    for (const piece of finalPieces) {
      const placeholder = vault.placeholder(piece.label, text.slice(piece.start, piece.end), { client, matching }).placeholder;
      const base = ranges[piece.segment].start;
      add(piece.segment, { start: piece.start - base, end: piece.end - base, text: placeholder });
      used.push(placeholder);
    }
    // I dati già noti dove il motore non li ha visti (con «dati già noti» spento, almeno quelli del cliente).
    const candidates = maskKnown ? vault.entries : seeded.map((p) => vault.entry(p)).filter((e) => e !== null);
    if (candidates.length > 0) {
      for (const match of Masking.knownMatches(text, candidates, hidden, exceptions)) {
        const segment = SegmentedText.firstSegment(match.start, ranges);
        if (!(segment < ranges.length && ranges[segment].start <= match.start && match.end <= ranges[segment].end)) continue;
        const base = ranges[segment].start;
        if ((replacements.get(segment) ?? []).some((r) => r.start < match.end - base && match.start - base < r.end)) continue;
        // Ogni grafia ha il suo segnaposto: il file riconvertito torna identico.
        const placeholder = vault.placeholder(match.label, text.slice(match.start, match.end), { client, matching }).placeholder;
        add(segment, { start: match.start - base, end: match.end - base, text: placeholder });
        used.push(placeholder);
      }
    }
    return { replacements, used, added: [...new Set(used)].filter((p) => !before.has(p)).length };
  });
  return { replacements, report: new AnonymizationReport(used, added) };
}
