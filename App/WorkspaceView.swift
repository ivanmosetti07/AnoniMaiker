import AnonymizerKit
import SwiftUI

/// Il banco di lavoro: a sinistra il testo (scritto, incollato o da un file), a destra il risultato.
struct WorkspaceView: View {
    @Environment(AppModel.self) private var model
    @Bindable var space: Workspace

    private var isAnonymize: Bool { space.mode == .anonymize }
    private var runTitle: String { isAnonymize ? "Anonimizza" : "Riconverti" }

    var body: some View {
        VStack(spacing: 0) {
            banner
            // Due metà uguali in un HStack: un HSplitView accanto al pannello della chat entra in un ciclo di layout che
            // chiude l'app.
            HStack(spacing: 0) {
                pane(title: isAnonymize ? "Originale" : "Con i segnaposto", detail: inputDetail) {
                    if space.isFile {
                        filePane(space.inputPreview, highlightPlaceholders: !isAnonymize, compared: nil, highlights: [])
                            .dropDestination(for: URL.self) { urls, _ in
                                if let url = urls.first { model.open(url, into: space) }
                                return !urls.isEmpty
                            }
                    } else {
                        TextPane(text: $space.input, onDropFile: { model.open($0, into: space) })
                            .overlay(alignment: .topLeading) { if space.input.isEmpty { emptyInput } }
                    }
                }
                Divider()
                pane(title: isAnonymize ? "Anonimizzato" : "Riconvertito", detail: outputDetail) {
                    Group {
                        if space.isFile {
                            filePane(space.outputPreview, highlightPlaceholders: isAnonymize, compared: isAnonymize ? nil : space.inputPreview,
                                     highlights: space.highlights)
                        } else {
                            TextPane(text: .constant(space.output), highlights: space.highlights, isEditable: false)
                        }
                    }
                    .opacity(space.isStale ? 0.45 : 1)
                    .overlay { if !space.hasOutput && !space.isRunning { emptyOutput } }
                }
            }
            Divider()
            ReportBar(space: space)
        }
        .navigationTitle(runTitle)
        .navigationSubtitle(space.source?.url.lastPathComponent ?? "")
        .toolbar { toolbar }
    }

    // MARK: Parti

    /// «Excel · cella per cella», «PDF · 3 pagine lette con l'OCR».
    private var inputDetail: String? {
        guard let source = space.source else { return nil }
        let how = switch source.format {
        case .csv, .xlsx: "cella per cella"
        case .docx: "la formattazione resta"
        case .pdf: "ne esce un PDF nuovo"
        default: ""
        }
        return [source.url.lastPathComponent, source.isFile ? source.format.title : "", how].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var outputDetail: String? {
        guard space.isFile, space.hasOutput, let source = space.source else { return nil }
        return space.recognizedPages > 0 ? "\(space.recognizedPages) pagine lette con l'OCR" : source.format.title
    }

    @ViewBuilder
    private func filePane(_ preview: DocumentPreview?, highlightPlaceholders: Bool, compared: DocumentPreview?, highlights: [NSRange]) -> some View {
        if let preview {
            DocumentPreviewView(preview: preview, highlights: highlights, highlightPlaceholders: highlightPlaceholders, comparedWith: compared)
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder private var banner: some View {
        if isAnonymize, model.engineState == .missing {
            Banner(symbol: "exclamationmark.triangle.fill",
                   text: "Il motore di anonimizzazione non è nell'app. Esegui Scripts/prepara-motore.sh e ricompila.", tint: .orange)
        } else if isAnonymize, case .failed(let reason) = model.engineState {
            Banner(symbol: "exclamationmark.triangle.fill", text: reason, tint: .orange)
        }
    }

    private func pane<Content: View>(title: String, detail: String?, @ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text(title).font(.headline)
                if let detail { Text(detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle) }
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            Divider()
            content()
        }
        .frame(minWidth: 200, maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyInput: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(isAnonymize ? "Incolla un testo o trascina qui un file" : "Incolla la risposta dell'AI o trascina qui un file anonimizzato")
            Text("Testo, Markdown, CSV, Excel, Word o PDF; oppure aprilo con ⌘O. Niente lascia il Mac.")
                .font(.callout)
        }
        .foregroundStyle(.tertiary)
        .padding(.horizontal, 19)
        .padding(.vertical, 14)
        .allowsHitTesting(false)
    }

    private var emptyOutput: some View {
        VStack(spacing: 8) {
            Image(systemName: isAnonymize ? "eye.slash" : "arrow.uturn.backward.circle")
                .font(.system(size: 28, weight: .light))
            Text(isAnonymize ? "Qui il testo con i segnaposto" : "Qui il testo con i dati veri")
            Text(isAnonymize ? "[FULLNAME_1], [IBAN_1]… al posto dei dati personali" : "I segnaposto tornano i dati del dizionario")
                .font(.callout)
                .foregroundStyle(.tertiary)
        }
        .foregroundStyle(.secondary)
        .allowsHitTesting(false)
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Button("Apri…", systemImage: "doc.badge.plus") { model.chooseFile(for: space) }
                .keyboardShortcut("o")
                .help("Apri un file: testo, Markdown, CSV, Excel, Word o PDF")
            Button(runTitle, systemImage: isAnonymize ? "eye.slash" : "arrow.uturn.backward") { model.run(space) }
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!model.canRun(space))
                .help("\(runTitle) (⌘↩)")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button("Copia", systemImage: "doc.on.doc") { model.copy(space) }
                .keyboardShortcut("c", modifiers: [.command, .shift])
                .disabled(!space.hasOutput)
                .help("Copia il risultato (⇧⌘C)")
            Button("Salva…", systemImage: "square.and.arrow.down") { model.save(space) }
                .keyboardShortcut("s")
                .disabled(!space.hasOutput)
                .help("Salva il risultato in un file (⌘S)")
            if isAnonymize {
                Button("Salva nei documenti del progetto", systemImage: "tray.and.arrow.down") { Task { await model.saveToProject(space) } }
                    .disabled(space.isFile || !space.hasOutput || space.isStale || space.isRunning || space.projectNote != nil)
                    .help(space.isFile ? "I file anonimizzati entrano da soli nei documenti del progetto"
                          : "Archivia il testo e la sua versione anonimizzata nei documenti del progetto (le persone entrano nel CRM)")
            }
            Button("Pulisci", systemImage: "xmark.circle") { space.clear() }
                .disabled(space.isEmpty)
                .help("Ricomincia da capo")
        }
    }
}

/// La riga in fondo: avanzamento, cosa è stato nascosto o rimesso, avvisi.
struct ReportBar: View {
    @Environment(AppModel.self) private var model
    let space: Workspace

    var body: some View {
        HStack(spacing: 10) {
            content
            Spacer(minLength: 0)
        }
        .font(.callout)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .frame(minHeight: 36)
        .background(.bar)
    }

    @ViewBuilder private var content: some View {
        if space.isRunning {
            if let progress = space.progress {
                ProgressView(value: progress).frame(width: 160)
                Text(model.engineState == .loading ? "Preparo il motore…" : "Anonimizzo sul Mac…").foregroundStyle(.secondary)
                Button("Annulla") { model.cancel(space) }.controlSize(.small)
            } else {
                ProgressView().controlSize(.small)
            }
        } else if space.isStale {
            Label("Il testo è cambiato: premi \(space.mode == .anonymize ? "Anonimizza" : "Riconverti") (⌘↩) per aggiornare il risultato",
                  systemImage: "arrow.clockwise")
                .foregroundStyle(.secondary)
        } else if let outcome = space.outcome {
            switch outcome {
            case .anonymized(let report):
                if report.isEmpty {
                    Label("Nessun dato da nascondere con le categorie scelte", systemImage: "checkmark.circle")
                        .foregroundStyle(.secondary)
                } else {
                    Label("Nascosti: \(report.summary)", systemImage: "eye.slash.fill")
                    if report.newEntries > 0 {
                        Text("· \(report.newEntries) \(report.newEntries == 1 ? "nuovo" : "nuovi") nel dizionario").foregroundStyle(.secondary)
                    }
                }
                if let note = space.projectNote {
                    Spacer(minLength: 8)
                    Button {
                        model.section = .documents
                    } label: {
                        Label(note, systemImage: "folder.badge.plus")
                    }
                    .buttonStyle(.link)
                    .help("Apri i documenti del progetto")
                }
            case .revealed(let result):
                Label(result.count == 0 ? "Nessun segnaposto da riconvertire" : "Riconvertiti \(result.count) segnaposto",
                      systemImage: result.count == 0 ? "info.circle" : "checkmark.circle.fill")
                    .foregroundStyle(result.count == 0 ? .secondary : .primary)
                if !result.unknown.isEmpty {
                    Label("\(result.unknown.count) sconosciuti, rimasti com'erano: \(result.unknown.prefix(4).joined(separator: ", "))\(result.unknown.count > 4 ? "…" : "")",
                          systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .help("Non sono nel dizionario di questo Mac: forse li ha inventati l'AI o vengono da un altro Mac.")
                }
            }
        } else {
            Label("Tutto avviene su questo Mac: niente viene inviato.", systemImage: "lock.shield")
                .foregroundStyle(.secondary)
        }
    }
}

struct Banner: View {
    let symbol: String
    let text: String
    let tint: Color

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).foregroundStyle(tint)
            Text(text).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(.callout)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(tint.opacity(0.1))
    }
}
