import Foundation

// MARK: - Anonimizzare un testo a segmenti (celle, paragrafi, pagine)
//
// Stesse regole del testo semplice (categorie, eccezioni, dati noti del cliente e del dizionario), più le colonne
// riconosciute dall'intestazione. Il risultato sono le sostituzioni di ogni segmento: chi legge il file le rimette nei
// suoi nodi di testo.

extension SegmentedText {
    /// Il primo segmento che finisce dopo `position` (i segmenti sono in ordine e non si sovrappongono).
    static func firstSegment(endingAfter position: Int, in ranges: [(start: Int, end: Int)]) -> Int {
        var low = 0, high = ranges.count
        while low < high {
            let mid = (low + high) / 2
            if ranges[mid].end <= position { low = mid + 1 } else { high = mid }
        }
        return low
    }
}

extension Anonymizer {
    typealias SegmentReplacements = [Int: [SegmentedText.Replacement]]

    func anonymize(_ content: SegmentedText, settings: AnonymizationSettings, client: UUID?, known: [KnownValue],
                   matching: Vault.Matching = .exact, progress: (@Sendable (Double) -> Void)?) async throws -> (replacements: SegmentReplacements, report: AnonymizationReport) {
        guard !content.isEmpty else { return ([:], AnonymizationReport(used: [], newEntries: 0)) }
        let (text, ranges) = content.layout()
        let found = try await finder.entities(in: text, progress: progress)
        let exceptions = Masking.normalizedExceptions(settings.exceptions)
        let entities = Masking.withForced(Masking.withoutExceptions(Masking.masked(found, in: text, labels: settings.hidden), in: text,
                                                                    exceptions: exceptions), in: text, terms: settings.forcedTerms)

        func trimmed(_ start: Int, _ end: Int) -> (Int, Int) {
            var start = start, end = end
            while start < end, text[start].pyIsSpace { start += 1 }
            while end > start, text[end - 1].pyIsSpace { end -= 1 }
            return (start, end)
        }

        // Ai confini dei segmenti un dato si spezza: ogni pezzo resta nella sua cella o nel suo paragrafo.
        var pieces: [(segment: Int, start: Int, end: Int, label: String)] = []
        var covered = Set<Int>()
        for entity in entities {
            var segment = SegmentedText.firstSegment(endingAfter: entity.start, in: ranges)
            while segment < ranges.count, ranges[segment].start < entity.end {
                let (start, end) = trimmed(max(entity.start, ranges[segment].start), min(entity.end, ranges[segment].end))
                // Anche il pezzo che resta in una cella deve avere la forma del dato («AB-12» non è un documento).
                let piece = PIIEntity(label: entity.label, start: start, end: end, score: entity.score, validated: entity.validated, source: entity.source)
                if end > start, entity.source != .model || Masking.isPlausible(piece, value: text.slice(start, end), in: text) {
                    pieces.append((segment, start, end, entity.label))
                    covered.insert(segment)
                }
                segment += 1
            }
        }
        // Le colonne riconosciute dall'intestazione: la cella intera, se il motore non ci ha trovato niente.
        for (segment, label) in content.hints.sorted(by: { $0.key < $1.key }) where settings.hidden.contains(label) && !covered.contains(segment) {
            let (start, end) = trimmed(ranges[segment].start, ranges[segment].end)
            guard end > start else { continue }
            let value = text.slice(start, end)
            guard ColumnHints.accepts(value, as: label), !Masking.isException(value, exceptions),
                  PIIText(value).matches(PIIAnalysis.placeholderRegex).isEmpty else { continue }
            pieces.append((segment, start, end, label))
        }

        let hidden = settings.hidden
        let maskKnown = settings.maskKnownValues
        // In ordine di documento: i numeri dei segnaposto seguono l'ordine in cui i dati compaiono.
        let finalPieces = pieces.sorted { $0.start < $1.start }
        let (replacements, used, new) = try await store.update { (vault: inout Vault) -> (SegmentReplacements, [String], Int) in
            let before = Set(vault.entries.map(\.placeholder))
            var seeded: [String] = []
            for value in known where hidden.contains(value.label) && !Masking.isException(value.value, exceptions) {
                seeded.append(vault.placeholder(label: value.label, value: value.value, client: client).placeholder)
            }
            var replacements: SegmentReplacements = [:]
            var used: [String] = []
            for piece in finalPieces {
                let placeholder = vault.placeholder(label: piece.label, value: text.slice(piece.start, piece.end), client: client, matching: matching).placeholder
                let base = ranges[piece.segment].start
                replacements[piece.segment, default: []].append(.init(start: piece.start - base, end: piece.end - base, text: placeholder))
                used.append(placeholder)
            }
            // I dati già noti dove il motore non li ha visti (con «dati già noti» spento, almeno quelli del cliente).
            let candidates = maskKnown ? vault.entries : seeded.compactMap { vault.entry($0) }
            if !candidates.isEmpty {
                for match in Masking.knownMatches(in: text, entries: candidates, labels: hidden, exceptions: exceptions) {
                    let segment = SegmentedText.firstSegment(endingAfter: match.start, in: ranges)
                    guard segment < ranges.count, ranges[segment].start <= match.start, match.end <= ranges[segment].end else { continue }
                    let base = ranges[segment].start
                    guard !(replacements[segment] ?? []).contains(where: { $0.start < match.end - base && match.start - base < $0.end }) else { continue }
                    // Ogni grafia ha il suo segnaposto: il file riconvertito torna identico.
                    let placeholder = vault.placeholder(label: match.label, value: text.slice(match.start, match.end), client: client,
                                                        matching: matching).placeholder
                    replacements[segment, default: []].append(.init(start: match.start - base, end: match.end - base, text: placeholder))
                    used.append(placeholder)
                }
            }
            return (replacements, used, Set(used).subtracting(before).count)
        }
        return (replacements, AnonymizationReport(used: used, newEntries: new))
    }
}
