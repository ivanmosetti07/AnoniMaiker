// Anonimizzare e riconvertire: regole delle categorie, segnaposto, riconversione, testo a segmenti.
export {
  AnonymizationReport, AnonymizationSettings, Anonymizer, ForcedTerm, RegexFinder,
  type AnonymizationResult, type AnonymizeOptions, type EntityFinder, type KnownValue, type TextDocumentLike,
} from "./anonymizer";
export { Masking, type ForcedTermLike, type KnownMatch } from "./masking";
export { RevealResult, Revealer, type TextRange } from "./revealer";
export { anonymizeSegmented } from "./segmentedAnonymizer";
