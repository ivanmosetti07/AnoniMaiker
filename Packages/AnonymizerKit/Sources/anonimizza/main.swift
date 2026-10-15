import AnonymizerKit
import Foundation

// Prove dal Terminale, con un dizionario usa e getta (quello dell'app non si tocca):
//   anonimizza "Mario Rossi, CF RSSMRA85H12F205Y"        testo anonimizzato, dizionario, tempi e riconversione
//   anonimizza --file contratto.md                       lo stesso con un file .txt o .md
//   anonimizza --file clienti.xlsx [--uscita a.xlsx]     CSV, Excel, Word, PDF: solo il riepilogo (niente contenuto a video)
//                                                        e la verifica della riconversione; --uscita salva il file anonimizzato
//   anonimizza --file clienti.xlsx --forme               in più la «forma» dei dati trovati per categoria (Aa9…, mai i dati)
//   anonimizza --tutte "…"                               tutte le entità del motore, senza le regole delle categorie
//   anonimizza --chat "…" [--file allegato]              la domanda a GPT via Codex: cosa parte, cosa arriva, cosa si legge
// Il motore si cerca in --motore <cartella>, poi in $ANONIMIZZATORE_MOTORE, poi in ./Engine.

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

struct Arguments {
    var rest = Array(CommandLine.arguments.dropFirst())

    mutating func option(_ name: String) -> String? {
        guard let index = rest.firstIndex(of: name), index + 1 < rest.count else { return nil }
        let value = rest[index + 1]
        rest.removeSubrange(index...(index + 1))
        return value
    }

    mutating func flag(_ name: String) -> Bool {
        guard let index = rest.firstIndex(of: name) else { return false }
        rest.remove(at: index)
        return true
    }
}

var arguments = Arguments()
let engineDirectory = arguments.option("--motore") ?? ProcessInfo.processInfo.environment["ANONIMIZZATORE_MOTORE"]
    ?? FileManager.default.currentDirectoryPath + "/Engine"
let file = arguments.option("--file")
let output = arguments.option("--uscita")
let all = arguments.flag("--tutte")
let chat = arguments.flag("--chat")
let engine = PIIEngine(directory: URL(filePath: engineDirectory))
guard engine.isInstalled else { fail("Motore non trovato in \(engineDirectory): esegui Scripts/prepara-motore.sh o passa --motore <cartella>.") }

let text: String
var binary: (url: URL, format: DocumentFormat)?
if let file {
    let url = URL(filePath: file)
    guard let format = DocumentFormat.of(url) else { fail(DocumentFormat.FormatError.unsupported(url.pathExtension.lowercased()).localizedDescription) }
    if chat {
        text = arguments.rest.first ?? ""
        binary = (url, format)
    } else if format.isText {
        do { text = try TextDocument.read(from: url).text } catch { fail(error.localizedDescription) }
    } else {
        text = ""
        binary = (url, format)
    }
} else if let argument = arguments.rest.first {
    text = argument
} else {
    fail("Uso: anonimizza [--motore <cartella>] [--tutte] \"testo\" | --file <file> [--uscita <file>] | --chat \"domanda\" [--file <allegato>]")
}

do {
    let started = Date.now
    try await engine.prepare()
    print(String(format: "Motore caricato in %.1f s\n", Date.now.timeIntervalSince(started)))
    if chat {
        // La chat: la domanda (e l'allegato) anonimizzati, la risposta di GPT e la sua riconversione.
        let directory = FileManager.default.temporaryDirectory.appending(path: "anonimizza-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let anonymizer = Anonymizer(engine: engine, store: VaultStore(directory: directory, protection: .file))
        var inputs: [ChatInput] = []
        if let binary {
            inputs.append(.file(name: binary.url.lastPathComponent, data: try Data(contentsOf: binary.url), format: binary.format,
                                fileExtension: binary.url.pathExtension))
        }
        let question = try await anonymizer.chatMessage(text, inputs: inputs)
        print("— Parte verso GPT —\n\(ChatShield.rendered(question))\n")
        let started = Date.now
        let reply = try await CodexClient().send(ChatShield.transcript(history: [], next: question))
        print("— Arriva da GPT (" + String(format: "%.1f s", Date.now.timeIntervalSince(started)) + ") —\n\(reply)\n")
        let answer = ChatShield.reveal(reply, vault: try await anonymizer.store.snapshot())
        print("— Si legge nell'app —\n\(answer.text)")
        if !answer.unknown.isEmpty { print("\nSegnaposto sconosciuti: \(answer.unknown.joined(separator: ", "))") }
    } else if let binary {
        let directory = FileManager.default.temporaryDirectory.appending(path: "anonimizza-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let anonymizer = Anonymizer(engine: engine, store: VaultStore(directory: directory, protection: .file))
        let data = try Data(contentsOf: binary.url)
        let ext = binary.url.pathExtension
        let analysisStart = Date.now
        let outcome = try await anonymizer.anonymizeFile(data, format: binary.format, fileExtension: ext)
        print("\(binary.format.title): \(data.count / 1024) KB · " + String(format: "%.1f s", Date.now.timeIntervalSince(analysisStart)))
        print("Nascosti: \(outcome.report.map { $0.isEmpty ? "niente" : $0.summary } ?? "niente")")
        if outcome.recognizedPages > 0 { print("Pagine lette con l'OCR: \(outcome.recognizedPages)") }
        // --forme: la forma dei dati trovati per categoria (lettere → a/A, cifre → 9), senza mostrarli.
        if arguments.rest.contains("--forme") {
            let vault = try await anonymizer.store.snapshot()
            for (label, entries) in Dictionary(grouping: vault.entries, by: \.label).sorted(by: { $0.key < $1.key }) {
                let shapes = Dictionary(grouping: entries.map { String($0.value.prefix(40).map { $0.isUppercase ? "A" : $0.isLetter ? "a" : $0.isNumber ? "9" : $0 }) },
                                        by: { $0 }).map { ($0.key, $0.value.count) }.sorted { $0.1 > $1.1 }.prefix(5)
                print("\(label): " + shapes.map { "«\($0.0)» ×\($0.1)" }.joined(separator: "  "))
            }
        }
        if let output {
            try outcome.data.write(to: URL(filePath: output))
            print("File anonimizzato: \(output)")
        }
        // Riconvertito, deve tornare il contenuto di partenza (spazi a parte, per il PDF che si rigenera).
        let back = try await FileReveal.reveal(outcome.data, format: binary.format, fileExtension: ext, vault: anonymizer.store.snapshot())
        let original = try await FileReveal.preview(data, format: binary.format, fileExtension: ext)
        func normalized(_ preview: DocumentPreview) -> String {
            preview.plainText.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        }
        print(normalized(back.preview) == normalized(original) ? "Riconversione: contenuto identico all'originale ✓"
              : "Riconversione: contenuto diverso dall'originale ✗")
        // Le differenze, senza mostrare i dati: solo la «forma» (lettere → a/A, cifre → 9).
        if case .sheets(let before) = original, case .sheets(let after) = back.preview, normalized(back.preview) != normalized(original) {
            func shape(_ text: String) -> String {
                String(text.prefix(60).map { $0.isUppercase ? "A" : $0.isLetter ? "a" : $0.isNumber ? "9" : $0 })
            }
            var kinds: [String: Int] = [:]
            var examples: [String] = []
            for (sheet, (a, b)) in zip(before, after).enumerated() {
                for (r, (rowA, rowB)) in zip(a.rows, b.rows).enumerated() {
                    for (c, (x, y)) in zip(rowA, rowB).enumerated() where x != y {
                        let kind = x.lowercased() == y.lowercased() ? "maiuscole" :
                            x.split(whereSeparator: \.isWhitespace) == y.split(whereSeparator: \.isWhitespace) ? "spazi" : "altro"
                        kinds[kind, default: 0] += 1
                        if kind == "altro", examples.count < 12 {
                            examples.append("foglio \(sheet + 1) riga \(r + 1) col \(c + 1): «\(shape(x))» → «\(shape(y))»")
                        }
                    }
                }
            }
            print("Celle diverse: \(kinds.sorted { $0.key < $1.key }.map { "\($0.value) per \($0.key)" }.joined(separator: ", "))")
            examples.forEach { print("  \($0)") }
        }
    } else if all {
        let analysisStart = Date.now
        let (output, vault) = try await Anonymizer.trial(text, engine: engine)
        print(output, "\n")
        for entry in vault.entries { print("\(entry.placeholder) = \(entry.value)") }
        print(String(format: "\n%.2f s", Date.now.timeIntervalSince(analysisStart)))
    } else {
        let directory = FileManager.default.temporaryDirectory.appending(path: "anonimizza-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let anonymizer = Anonymizer(engine: engine, store: VaultStore(directory: directory, protection: .file))
        let analysisStart = Date.now
        let result = try await anonymizer.anonymize(text)
        let elapsed = Date.now.timeIntervalSince(analysisStart)
        print(result.text, "\n")
        for entry in try await anonymizer.store.snapshot().entries { print("\(entry.placeholder) = \(entry.value)") }
        print("\nNascosti: \(result.report.isEmpty ? "niente" : result.report.summary)")
        print(String(format: "%.2f s per %d caratteri", elapsed, text.count))
        let back = try await anonymizer.reveal(result.text)
        print(back.text == text ? "Riconversione: identica all'originale ✓" : "Riconversione: diversa dall'originale\n\(back.text)")
    }
} catch {
    fail(error.localizedDescription)
}
