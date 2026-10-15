import CoreML
import Foundation
import os

// MARK: - Il motore di anonimizzazione sul Mac
//
// Il testo si divide in blocchi di 120 parole (20 in comune fra un blocco e il successivo), il modello etichetta ogni
// blocco, la rete regex + checksum aggiunge i dati a forma fissa, la fusione tiene i candidati migliori senza
// sovrapposizioni e li allinea alle parole. Niente esce dal Mac.

let engineLog = Logger(subsystem: "com.ivanmosetti.anonimizzatoreai", category: "motore")

/// L'anonimizzazione non è riuscita: niente va avanti.
public enum EngineError: LocalizedError, Equatable {
    case notInstalled
    case failed(String)

    public var errorDescription: String? {
        switch self {
        case .notInstalled:
            "Il motore di anonimizzazione non è nell'app: esegui Scripts/prepara-motore.sh e ricompila."
        case .failed(let reason):
            "L'anonimizzazione non è riuscita (\(reason))."
        }
    }
}

enum PIIAnalysis {
    static let maxWords = 120
    static let overlap = 20

    /// Blocchi di parole intere (spezzati dove c'è spazio), con l'offset di partenza.
    static func chunks(_ text: PIIText, maxWords: Int = maxWords, overlap: Int = overlap) -> [(start: Int, end: Int)] {
        var words: [(start: Int, end: Int)] = []
        var index = 0
        while index < text.count {
            if text[index].pyIsSpace { index += 1; continue }
            let start = index
            while index < text.count, !text[index].pyIsSpace { index += 1 }
            words.append((start, index))
        }
        guard !words.isEmpty else { return [] }
        var chunks: [(Int, Int)] = []
        let step = max(1, maxWords - overlap)
        var i = 0
        while i < words.count {
            let block = words[i..<min(words.count, i + maxWords)]
            chunks.append((block.first!.start, block.last!.end))
            if i + maxWords >= words.count { break }
            i += step
        }
        return chunks
    }

    /// Senza sovrapposizioni: prima i checksum validi, poi la rete regex (non «soft»), poi punteggio e lunghezza;
    /// niente spazi ai bordi, parole mai tagliate a metà, pezzi contigui della stessa categoria uniti.
    static func merge(_ candidates: [PIIEntity], in text: PIIText) -> [PIIEntity] {
        let order = candidates.enumerated().sorted { a, b in
            func key(_ e: PIIEntity) -> (Int, Int, Double, Int) {
                (e.validated ? 1 : 0, e.source == .regex && !PIIDetectors.softRegexLabels.contains(e.label) ? 1 : 0, e.score, e.end - e.start)
            }
            let ka = key(a.element), kb = key(b.element)
            if ka.0 != kb.0 { return ka.0 > kb.0 }
            if ka.1 != kb.1 { return ka.1 > kb.1 }
            if ka.2 != kb.2 { return ka.2 > kb.2 }
            if ka.3 != kb.3 { return ka.3 > kb.3 }
            return a.offset < b.offset       // ordinamento stabile, come quello della pipeline originale
        }.map(\.element)
        var kept: [PIIEntity] = []
        for entity in order {
            // Ricerca binaria sugli inizi: le entità tenute sono ordinate e senza sovrapposizioni.
            var low = 0, high = kept.count
            while low < high {
                let mid = (low + high) / 2
                if entity.start < kept[mid].start { high = mid } else { low = mid + 1 }
            }
            if (low > 0 && kept[low - 1].end > entity.start) || (low < kept.count && kept[low].start < entity.end) { continue }
            kept.insert(entity, at: low)
        }
        for index in kept.indices {
            while kept[index].start < kept[index].end, text[kept[index].start].pyIsSpace { kept[index].start += 1 }
            while kept[index].end > kept[index].start, text[kept[index].end - 1].pyIsSpace { kept[index].end -= 1 }
        }
        kept.removeAll { $0.end <= $0.start }
        for index in kept.indices {
            while kept[index].start > 0, text[kept[index].start - 1].isWordCharacter, text[kept[index].start].isWordCharacter {
                kept[index].start -= 1
            }
            while kept[index].end < text.count, text[kept[index].end].isWordCharacter, text[kept[index].end - 1].isWordCharacter {
                kept[index].end += 1
            }
        }
        kept = kept.enumerated().sorted { a, b in
            if a.element.start != b.element.start { return a.element.start < b.element.start }
            let la = a.element.end - a.element.start, lb = b.element.end - b.element.start
            return la != lb ? la > lb : a.offset < b.offset
        }.map(\.element)
        var merged: [PIIEntity] = []
        for entity in kept {
            if let last = merged.last, entity.start < last.end {
                merged[merged.count - 1].end = max(last.end, entity.end)
                continue
            }
            if let last = merged.last, entity.start == last.end, entity.label == last.label {
                merged[merged.count - 1].end = entity.end
                continue
            }
            merged.append(entity)
        }
        return merged
    }

    /// Segnaposto già presenti nel testo («[FULLNAME_1]»): non si rianonimizzano.
    static let placeholderRegex = try! NSRegularExpression(pattern: #"\[\s*[A-Z][A-Z_]*_\d+\s*\]"#)
}

/// Il motore: tokenizer e modello caricati la prima volta che servono. Un attore: il lavoro pesante non passa mai
/// dal thread principale, e due richieste non si contendono il modello.
public actor PIIEngine {
    /// Cartella con `model.mlmodelc`, `tokenizer.json` e `config.json`.
    public nonisolated let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    /// Il motore dentro l'app (`Contents/Resources/Engine`).
    public static func bundled(in bundle: Bundle = .main) -> PIIEngine? {
        bundle.url(forResource: "Engine", withExtension: nil).map { PIIEngine(directory: $0) }
    }

    nonisolated var modelURL: URL { directory.appending(path: "model.mlmodelc") }

    /// Modello compilato, tokenizer ed etichette ci sono tutti.
    public nonisolated var isInstalled: Bool {
        let fm = FileManager.default
        return fm.fileExists(atPath: modelURL.path) && fm.fileExists(atPath: directory.appending(path: "tokenizer.json").path)
            && fm.fileExists(atPath: directory.appending(path: "config.json").path)
    }

    private var tokenizer: PIITokenizer?
    private var model: PIIModel?
    private var lastUse = Date.distantPast
    /// Solo processore: il più veloce per blocchi così piccoli (35 ms a blocco, contro 122 della grafica e 317 del
    /// Neural Engine), con gli stessi risultati della pipeline originale.
    private var computeUnits: MLComputeUnits = .cpuOnly

    /// Per le prove: dove far girare il modello.
    public func use(_ units: MLComputeUnits) {
        computeUnits = units
        model = nil
    }

    public var isLoaded: Bool { model != nil }

    private func load() throws -> (PIITokenizer, PIIModel) {
        if let tokenizer, let model { return (tokenizer, model) }
        guard isInstalled else { throw EngineError.notInstalled }
        let started = Date.now
        let config = try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appending(path: "config.json"))) as? [String: Any]
        guard let map = config?["id2label"] as? [String: String] else { throw EngineError.failed("etichette del modello non leggibili") }
        let labels = (0..<map.count).map { map[String($0)] ?? "O" }
        let tokenizer = try self.tokenizer ?? PIITokenizer(url: directory.appending(path: "tokenizer.json"))
        let model = try PIIModel(url: modelURL, labels: labels, computeUnits: computeUnits)
        self.tokenizer = tokenizer
        self.model = model
        engineLog.info("Motore pronto in \(String(format: "%.1f", Date.now.timeIntervalSince(started)), privacy: .public) s")
        return (tokenizer, model)
    }

    /// Carica il motore in anticipo (all'avvio): la prima anonimizzazione non aspetta.
    public func prepare() throws {
        _ = try load()
        lastUse = .now
    }

    /// Libera la memoria se il motore non serve da un po' (circa 700 MB).
    public func releaseIfIdle(after seconds: TimeInterval = 600) {
        guard model != nil, Date.now.timeIntervalSince(lastUse) > seconds else { return }
        model = nil
        tokenizer = nil
        engineLog.info("Motore scaricato dalla memoria (inattivo)")
    }

    /// Le entità di un testo: modello sui blocchi, ore completate, rete regex, fusione.
    /// `progress` va da 0 a 1 man mano che i blocchi passano dal modello; si può annullare fra un blocco e l'altro.
    func analyze(_ text: PIIText, progress: (@Sendable (Double) -> Void)? = nil) throws -> [PIIEntity] {
        let (tokenizer, model) = try load()
        lastUse = .now
        var found: [PIIEntity] = []
        let chunks = PIIAnalysis.chunks(text)
        for (index, chunk) in chunks.enumerated() {
            try Task.checkCancellation()
            try found.append(contentsOf: detect(in: text, from: chunk.start, to: chunk.end, tokenizer: tokenizer, model: model))
            progress?(Double(index + 1) / Double(chunks.count))
        }
        PIIDetectors.completeTime(&found, in: text)
        lastUse = .now
        return PIIAnalysis.merge(found + PIIDetectors.detect(text), in: text)
    }

    /// Un blocco al modello; oltre i 512 token (parole lunghissime, codici) si divide a metà per parole.
    private func detect(in text: PIIText, from start: Int, to end: Int, tokenizer: PIITokenizer, model: PIIModel) throws -> [PIIEntity] {
        let piece = PIIText(text.slice(start, end))
        let tokens = tokenizer.encode(piece)
        if tokens.count > PIIModel.shapes.last! {
            // Si taglia sullo spazio più vicino alla metà (o a metà, se non ce ne sono).
            let spaces = piece.scalars.indices.filter { piece[$0].pyIsSpace && $0 > 0 }
            let cut = spaces.min { abs($0 - piece.count / 2) < abs($1 - piece.count / 2) } ?? piece.count / 2
            return try detect(in: text, from: start, to: start + cut, tokenizer: tokenizer, model: model)
                + detect(in: text, from: start + cut, to: end, tokenizer: tokenizer, model: model)
        }
        let predictions = try model.predict(tokens.map(\.id))
        return PIIModel.entities(tokens: tokens, predictions: predictions, labels: model.labels).map {
            var entity = $0
            entity.start += start
            entity.end += start
            return entity
        }
    }

    /// Entità di un testo, senza quelle sopra a segnaposto già presenti (niente segnaposto dentro un segnaposto).
    func entities(in source: PIIText, progress: (@Sendable (Double) -> Void)? = nil) throws -> [PIIEntity] {
        guard source.count > 0 else { return [] }
        let existing = source.matches(PIIAnalysis.placeholderRegex)
        return try analyze(source, progress: progress).filter { entity in !existing.contains { $0.start < entity.end && entity.start < $0.end } }
    }
}
