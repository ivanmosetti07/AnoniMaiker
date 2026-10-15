import Foundation

// MARK: - Lo scudo della chat
//
// Prima di partire, domanda e allegati passano dal motore di anonimizzazione con il dizionario unico dell'app; al
// ritorno la risposta si riconverte con lo stesso dizionario. Nella chat la corrispondenza è «larga»: «MARIO ROSSI»
// scritto di fretta riceve lo stesso segnaposto di «Mario Rossi», così GPT capisce che è la stessa persona.
// Senza motore la chat non parte: niente esce dal Mac senza essere anonimizzato.

/// Quello che l'utente allega a una domanda.
public enum ChatInput: Sendable {
    /// Un testo già pronto: la scheda di un cliente, un testo incollato.
    case text(name: String, text: String)
    /// Un file di un formato gestito (anche un documento del CRM).
    case file(name: String, data: Data, format: DocumentFormat, fileExtension: String)

    public var name: String {
        switch self {
        case .text(let name, _), .file(let name, _, _, _): name
        }
    }
}

public enum ChatShield {
    /// Come trattare i segnaposto: sono dati veri nascosti, da usare così come arrivano.
    public static let modelRule = """
    Privacy: alcuni dati personali ti arrivano come segnaposto tra parentesi quadre, per esempio [FULLNAME_1], [EMAIL_1], \
    [IBAN_1], [CF_1], [ORG_1]. Sono dati veri che l'app ha nascosto per privacy e che rimette al loro posto nella tua risposta: \
    usali esattamente come li ricevi, come se fossero i valori veri (anche nei testi da scrivere, nelle tabelle e nelle \
    email). Non chiedere i dati reali, non trattarli come campi da compilare, non spiegare che sono segnaposto e non \
    cambiarne la forma.
    """

    public static let system = """
    Sei l'assistente di un professionista che lavora con i documenti e i clienti del suo CRM. Rispondi in italiano, in \
    modo chiaro e concreto; usa il Markdown quando aiuta (elenchi, tabelle). Gli allegati sono tra le righe «<<<» e «>>>».

    """ + modelRule

    /// Il testo completo che parte: istruzioni, conversazione precedente e nuova richiesta, tutto anonimizzato. Nella chat
    /// di un progetto ci sono anche le istruzioni sui suoi documenti (`project`) e i passaggi già fatti in questa
    /// risposta (`steps`: le risposte intermedie e i documenti letti).
    public static func transcript(history: [ChatMessage], next: ChatMessage, project: String? = nil, steps: [String] = []) -> String {
        var parts = [system]
        if let project { parts.append(project) }
        if !history.isEmpty {
            let previous = history.map { message in
                (message.role == .user ? "Utente: " : "Assistente: ") + rendered(message)
            }
            parts.append("Conversazione precedente:\n" + previous.joined(separator: "\n\n"))
        }
        parts.append("Richiesta:\n" + rendered(next))
        parts += steps
        parts.append(project == nil ? "Rispondi solo con il testo della risposta, senza usare strumenti né modificare file."
                     : "Rispondi seguendo le istruzioni sui documenti del progetto. Non usare strumenti e non modificare file.")
        return parts.joined(separator: "\n\n")
    }

    /// Un messaggio come parte: il testo anonimizzato e i suoi allegati.
    public static func rendered(_ message: ChatMessage) -> String {
        var text = message.sent
        for attachment in message.attachments {
            text += "\n\nAllegato «\(attachment.sentName)»:\n<<<\n\(attachment.sentText)\n>>>"
        }
        return text
    }

    /// La risposta di GPT con i dati veri.
    public static func reveal(_ reply: String, vault: Vault) -> ChatMessage {
        // «[ORG_1].» a fine frase, con «Edilnord S.r.l.», diventerebbe «S.r.l..»: il punto in più si toglie.
        var text = reply
        for entry in vault.entries where entry.value.hasSuffix(".") && text.contains(entry.placeholder + ".") {
            text = text.replacingOccurrences(of: entry.placeholder + ".", with: entry.placeholder)
        }
        let result = Revealer.reveal(text, vault: vault)
        let summary = result.count == 0 ? "" : "\(result.count) " + (result.count == 1 ? "dato rimesso" : "dati rimessi")
        return ChatMessage(role: .assistant, text: result.text, sent: reply, summary: summary, unknown: result.unknown)
    }

    /// Mentre la risposta arriva a pezzi: un segnaposto ancora a metà in fondo non si mostra.
    public static func revealPartial(_ partial: String, vault: Vault) -> String {
        var text = partial
        if let range = text.range(of: #"\[\s*[A-Z_]*\d*\s*$"#, options: .regularExpression) { text.removeSubrange(range) }
        return Revealer.reveal(text, vault: vault).text
    }
}

extension Anonymizer {
    /// Prepara una domanda per GPT: testo e allegati anonimizzati, legati al cliente se c'è.
    public func chatMessage(_ text: String, inputs: [ChatInput] = [], settings: AnonymizationSettings = .init(), client: UUID? = nil,
                            known: [KnownValue] = []) async throws -> ChatMessage {
        var used: [String] = []
        var newEntries = 0
        func anonymized(_ text: String) async throws -> String {
            let result = try await anonymize(text, settings: settings, client: client, known: known, matching: .loose)
            used += result.report.placeholders
            newEntries += result.report.newEntries
            return result.text
        }

        let sent = try await anonymized(text)
        var attachments: [ChatAttachment] = []
        for input in inputs {
            try Task.checkCancellation()
            // Anche il nome di un file può contenere un dato («Contratto Mario Rossi.docx»); l'estensione resta fuori.
            let ext = (input.name as NSString).pathExtension
            let base = ext.isEmpty || ext.contains(" ") ? input.name : (input.name as NSString).deletingPathExtension
            let sentName = try await anonymized(base) + (base == input.name ? "" : "." + ext)
            let content: String
            let report: AnonymizationReport
            switch input {
            case .text(_, let text):
                let result = try await anonymize(text, settings: settings, client: client, known: known, matching: .loose)
                (content, report) = (result.text, result.report)
            case .file(_, let data, let format, let fileExtension):
                if format.isText {
                    let document = try TextDocument.decode(data, kind: format.textKind)
                    let result = try await anonymize(document.text, settings: settings, client: client, known: known, matching: .loose)
                    (content, report) = (result.text, result.report)
                } else {
                    let outcome = try await anonymizeFile(data, format: format, fileExtension: fileExtension, settings: settings,
                                                          client: client, known: known, matching: .loose)
                    (content, report) = (outcome.preview.plainText, outcome.report ?? AnonymizationReport(used: [], newEntries: 0))
                }
            }
            used += report.placeholders
            newEntries += report.newEntries
            attachments.append(ChatAttachment(name: input.name, sentName: sentName, sentText: content, summary: report.summary))
        }
        let report = AnonymizationReport(used: used, newEntries: newEntries)
        return ChatMessage(role: .user, text: text, sent: sent, attachments: attachments, summary: report.summary)
    }
}
