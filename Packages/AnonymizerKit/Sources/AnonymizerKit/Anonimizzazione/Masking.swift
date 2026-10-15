import Foundation

// MARK: - Quali entità diventano segnaposto
//
// Solo le categorie scelte; restano in chiaro gli indirizzi IP del Mac e delle reti private, i numeri che il modello
// prende per civici senza una via davanti e le eccezioni («mai nascondere»). Dentro un indirizzo web lasciato in
// chiaro l'email si nasconde lo stesso. Quello che il modello dà per un dato a forma fissa (codice fiscale, IBAN, carta,
// targa, documento) deve averne almeno la forma: senza il contesto di una frase (le celle di una tabella) scambia per
// codici fiscali gli orari e i codici brevi.

enum Masking {
    static func masked(_ entities: [PIIEntity], in text: PIIText, labels: Set<String>) -> [PIIEntity] {
        var result: [PIIEntity] = []
        for (index, entity) in entities.enumerated() {
            let value = text.slice(entity.start, entity.end)
            guard labels.contains(entity.label) else {
                if entity.label == "URL", labels.contains("EMAIL") {
                    result += PIIText(value).matches(emailRegex).map {
                        PIIEntity(label: "EMAIL", start: entity.start + $0.start, end: entity.start + $0.end, score: 1, validated: false, source: .regex)
                    }
                }
                continue
            }
            if entity.source == .model, !isPlausible(entity, value: value, in: text) { continue }
            if entity.label == "IPADDR", isLocalAddress(value) { continue }
            if entity.label == "BUILDINGNUM" {
                let previous = index > 0 ? entities[index - 1] : nil
                guard let previous, previous.label == "STREET", entity.start - previous.end <= 6 else { continue }
            }
            var entity = entity
            // «Edilnord S.r.l.»: il modello si ferma prima dell'ultimo punto; senza, riconvertendo uscirebbe «S.r.l».
            if entity.label == "ORG", entity.end < text.count, text[entity.end] == ".",
               value.range(of: #"(?:^|\s)S(?:\.[A-Za-z]){1,4}$"#, options: .regularExpression) != nil {
                entity.end += 1
            }
            result.append(entity)
        }
        return result
    }

    private static let emailRegex = try! NSRegularExpression(pattern: #"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"#)

    /// Le parole che annunciano un dato catastale («Foglio 12, particella 345, sub. 6»).
    private static let cadastral = try! NSRegularExpression(
        pattern: #"(?i)\b(?:fogli?o|fg|particell[ae]|part|mappal[ei]|map|sub|subalterno|catast[oa]|nceu|nct|categoria catastale|rendita)\b"#)

    /// Un dato a forma fissa trovato dal modello ne ha almeno la forma.
    static func isPlausible(_ entity: PIIEntity, value: String, in text: PIIText) -> Bool {
        let digits = value.filter(\.isNumber).count
        let letters = value.filter(\.isLetter).count
        let alphanumerics = digits + letters
        switch entity.label {
        case "CF": return (alphanumerics >= 11 && letters > 0 && digits > 0) || digits == 11
        case "PIVA": return digits >= 11
        case "IBAN": return alphanumerics >= 15 && letters >= 2 && digits >= 8
        case "CREDITCARDNUMBER": return digits >= 12
        case "TELEPHONENUM": return digits >= 6
        case "EMAIL": return value.contains("@")
        case "TARGA": return alphanumerics >= 5 && letters >= 2 && digits >= 2
        case "ID_DOC": return alphanumerics >= 6 && digits >= 2
        case "DOCID": return alphanumerics >= 5 && digits >= 1
        case "IPADDR": return digits >= 4 && value.contains(".")
        case "CATASTO":
            // Solo con le parole del catasto subito prima («Foglio 12», «sub. 6») o dentro il dato stesso.
            let before = text.slice(max(0, entity.start - 16), entity.start)
            let range = NSRange(location: 0, length: (before + value as NSString).length)
            return cadastral.firstMatch(in: before + value, range: range) != nil
        default: return true
        }
    }

    /// Indirizzi del Mac stesso e delle reti private (anche intervalli e reti «192.168.1.0/24»).
    static func isLocalAddress(_ value: String) -> Bool {
        let first = value.split(whereSeparator: { !$0.isNumber && $0 != "." }).first.map(String.init) ?? value
        let octets = first.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4 else { return false }
        switch (octets[0], octets[1]) {
        case (127, _), (10, _), (192, 168), (0, _), (169, 254): return true
        case (172, 16...31): return true
        default: return false
        }
    }

    /// «Rossi Moto S.r.l.» → «Rossi Moto»: i testi spesso scrivono l'azienda senza la forma societaria.
    static func withoutLegalForm(_ value: String) -> String {
        value.replacingOccurrences(of: #"[\s,]*(?:S\.?\s?r\.?\s?l\.?|S\.?\s?p\.?\s?A\.?|S\.?\s?a\.?\s?s\.?|S\.?\s?n\.?\s?c\.?|S\.?\s?s\.?|&\s*C\.?|Srl|SpA|Sas|Snc)\s*$"#,
                                   with: "", options: [.regularExpression, .caseInsensitive])
    }

    /// Le eccezioni, normalizzate (anche senza forma societaria).
    static func normalizedExceptions(_ exceptions: [String]) -> Set<String> {
        var result = Set<String>()
        for exception in exceptions {
            let normalized = Vault.normalized(exception)
            guard !normalized.isEmpty else { continue }
            result.insert(normalized)
            result.insert(Vault.normalized(withoutLegalForm(exception)))
        }
        result.remove("")
        return result
    }

    static func isException(_ value: String, _ exceptions: Set<String>) -> Bool {
        guard !exceptions.isEmpty else { return false }
        return exceptions.contains(Vault.normalized(value)) || exceptions.contains(Vault.normalized(withoutLegalForm(value)))
    }

    static func withoutExceptions(_ entities: [PIIEntity], in text: PIIText, exceptions: Set<String>) -> [PIIEntity] {
        guard !exceptions.isEmpty else { return entities }
        return entities.filter { !isException(text.slice($0.start, $0.end), exceptions) }
    }

    /// I dati già nel dizionario che il modello non ha visto in questo testo diventano i loro segnaposto: un nome trovato
    /// nel primo paragrafo non resta in chiaro nel quinto. Restano fuori i nomi di una parola sola («Marco»: troppo
    /// comuni) e i valori di meno di 4 caratteri.
    static func maskKnown(_ text: String, vault: Vault, labels: Set<String>, exceptions: Set<String>) -> (text: String, used: [String]) {
        maskKnown(text, entries: vault.entries, labels: labels, exceptions: exceptions)
    }

    /// Come sopra, solo con le voci date (per esempio i dati noti di un cliente).
    static func maskKnown(_ text: String, entries: [VaultEntry], labels: Set<String>, exceptions: Set<String>) -> (text: String, used: [String]) {
        let source = PIIText(text)
        let matches = knownMatches(in: source, entries: entries, labels: labels, exceptions: exceptions)
        guard !matches.isEmpty else { return (text, []) }
        var output = ""
        var position = 0
        for match in matches {
            output += source.slice(position, match.start) + match.placeholder
            position = match.end
        }
        return (output + source.slice(position, source.count), matches.map(\.placeholder))
    }

    /// Dove compaiono i dati già noti (posizioni in code point), fuori dai segnaposto che ci sono già: categoria e
    /// segnaposto della voce trovata (che può avere un'altra grafia: chi anonimizza ne dà uno alla grafia esatta).
    static func knownMatches(in text: PIIText, entries: [VaultEntry], labels: Set<String>,
                             exceptions: Set<String>) -> [(start: Int, end: Int, label: String, placeholder: String)] {
        let identifying = labels.intersection(PIICategory.identifying)
        let known = entries.filter { entry in
            guard identifying.contains(entry.label), entry.value.count >= 4, !isException(entry.value, exceptions) else { return false }
            return entry.label != "FULLNAME" || entry.value.split(separator: " ").count >= 2
        }
        guard !known.isEmpty else { return [] }
        var aliases: [(value: String, entry: VaultEntry)] = known.map { ($0.value, $0) }
        for entry in known where entry.label == "ORG" {
            let core = withoutLegalForm(entry.value)
            if core != entry.value, core.count >= 4 { aliases.append((core, entry)) }
        }
        let byValue = Dictionary(aliases.map { (Vault.normalized($0.value), $0.entry) }, uniquingKeysWith: { first, _ in first })
        let pattern = aliases.map(\.value).sorted { $0.count > $1.count }
            .map { NSRegularExpression.escapedPattern(for: $0).replacingOccurrences(of: " ", with: #"\s+"#) }
            .joined(separator: "|")
        guard let regex = try? NSRegularExpression(pattern: #"(?<![\p{L}\p{N}_])(?:"# + pattern + #")(?![\p{L}\p{N}_])"#,
                                                   options: [.caseInsensitive]) else { return [] }
        // Niente dentro i segnaposto che ci sono già.
        let existing = text.matches(PIIAnalysis.placeholderRegex)
        return text.matches(regex).compactMap { match in
            guard !existing.contains(where: { $0.start < match.end && match.start < $0.end }),
                  let entry = byValue[Vault.normalized(text.slice(match.start, match.end))] else { return nil }
            return (match.start, match.end, entry.label, entry.placeholder)
        }
    }
}
