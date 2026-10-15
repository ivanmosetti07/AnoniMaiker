import Foundation

// MARK: - La chat del progetto, come un piccolo «harness»
//
// GPT riceve l'elenco dei documenti del progetto (titoli anonimizzati) e può chiedere di leggerli: scrive «LEGGI D3» e
// l'app gli rimanda il testo anonimizzato del documento, poi GPT continua. Le modifiche le propone scrivendo il
// documento completo fra due righe-marcatore; l'utente le vede riconvertite e decide se applicarle (diventano una
// nuova versione del documento) o scartarle. GPT non tocca mai niente da solo, e vede solo testi anonimizzati.

/// Un documento del progetto come lo vede GPT.
public struct AgentDocument: Sendable, Equatable {
    public let ref: String
    public let id: UUID
    /// Il titolo con i segnaposto.
    public let title: String
    public let format: DocumentFormat

    public init(ref: String, id: UUID, title: String, format: DocumentFormat) {
        self.ref = ref
        self.id = id
        self.title = title
        self.format = format
    }
}

/// Cosa contiene una risposta di GPT: documenti da leggere, proposte, e il messaggio per l'utente.
public struct AgentReply: Sendable, Equatable {
    public var reads: [String] = []
    public var proposals: [(ref: String?, title: String, content: String)] = []
    public var text: String

    public static func == (a: AgentReply, b: AgentReply) -> Bool {
        a.reads == b.reads && a.text == b.text && a.proposals.count == b.proposals.count
            && zip(a.proposals, b.proposals).allSatisfy { $0.ref == $1.ref && $0.title == $1.title && $0.content == $1.content }
    }
}

public enum ProjectAgent {
    /// Quanti giri di lettura al massimo per una domanda.
    public static let maxRounds = 4
    /// Oltre questa lunghezza un documento si manda tagliato.
    public static let maxDocumentLength = 40_000

    /// Le istruzioni sui documenti del progetto, da aggiungere a quelle della chat.
    public static func instructions(project: String, documents: [AgentDocument]) -> String {
        var text = "Lavori nel progetto «\(project)». "
        if documents.isEmpty {
            text += "Il progetto non ha ancora documenti."
        } else {
            text += "I suoi documenti (già anonimizzati) sono:\n"
            text += documents.map { "- \($0.ref): «\($0.title)» (\($0.format.title))" }.joined(separator: "\n")
            text += """


            Per leggere un documento scrivi su una riga da sola «LEGGI D1» (una riga per documento) e nient'altro: ti \
            mando il suo testo e poi continui. Leggi solo i documenti che servono.
            """
        }
        text += """


        Per proporre una modifica a un documento scrivi il documento completo già modificato fra le righe \
        «<<<MODIFICA D1>>>» e «<<<FINE>>>». Per proporre un documento nuovo usa «<<<NUOVO Titolo del documento>>>» e \
        «<<<FINE>>>». L'utente vede la proposta e decide se applicarla: tu non cambi niente da solo. Fuori dai marcatori \
        scrivi il messaggio per l'utente (breve, senza ripetere il documento).
        """
        return text
    }

    private static let readLine = try! NSRegularExpression(pattern: #"(?im)^\s*\**\s*LEGGI\s+(D\d+(?:\s*[,e]\s*D\d+)*)\s*\**\s*$"#)
    private static let block = try! NSRegularExpression(
        pattern: #"(?s)<<<\s*(MODIFICA|NUOVO)\s+([^>\n]*?)\s*>>>\s*\n?(.*?)\n?\s*<<<\s*FINE\s*>>>"#)

    /// Legge una risposta di GPT.
    public static func parse(_ reply: String) -> AgentReply {
        var result = AgentReply(text: reply)
        let ns = reply as NSString
        var remove: [NSRange] = []
        for match in block.matches(in: reply, range: NSRange(location: 0, length: ns.length)) {
            let kind = ns.substring(with: match.range(at: 1)).uppercased()
            let target = ns.substring(with: match.range(at: 2)).trimmingCharacters(in: .whitespaces)
            let content = ns.substring(with: match.range(at: 3))
            if kind == "MODIFICA" {
                result.proposals.append((ref: target.uppercased(), title: "", content: content))
            } else {
                result.proposals.append((ref: nil, title: target.isEmpty ? "Nuovo documento" : target, content: content))
            }
            remove.append(match.range)
        }
        for match in readLine.matches(in: reply, range: NSRange(location: 0, length: ns.length)) {
            let refs = ns.substring(with: match.range(at: 1)).uppercased()
                .components(separatedBy: CharacterSet(charactersIn: ", E")).filter { $0.hasPrefix("D") }
            for ref in refs where !result.reads.contains(ref) { result.reads.append(ref) }
            remove.append(match.range)
        }
        var text = reply
        for range in remove.sorted(by: { $0.location > $1.location }) {
            text = (text as NSString).replacingCharacters(in: range, with: "")
        }
        result.text = text.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return result
    }

    /// Il testo dei documenti chiesti, da aggiungere alla conversazione per il giro successivo.
    public static func documentsBlock(_ documents: [(document: AgentDocument, text: String)]) -> String {
        documents.map { item in
            var text = item.text
            if text.count > maxDocumentLength {
                text = String(text.prefix(maxDocumentLength)) + "\n[… documento tagliato: è più lungo di \(maxDocumentLength) caratteri]"
            }
            return "Documento \(item.document.ref) «\(item.document.title)»:\n<<<\n\(text)\n>>>"
        }.joined(separator: "\n\n")
    }
}
