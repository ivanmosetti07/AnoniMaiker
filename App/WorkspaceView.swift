import AnonymizerKit
import SwiftUI

/// Il banco di lavoro: a sinistra il testo (scritto, incollato o da un file), a destra il risultato.
struct WorkspaceView: View {
    @Environment(AppModel.self) private var model
    @Bindable var space: Workspace
    @State private var dropping = false

    private var isAnonymize: Bool { space.mode == .anonymize }
    private var runTitle: String { isAnonymize ? "Anonimizza" : "Riconverti" }

    var body: some View {
        VStack(spacing: 0) {
            TopBar(title: runTitle, subtitle: space.source?.url.lastPathComponent) { actions }
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
                            } isTargeted: { dropping = $0 }
                    } else {
                        TextPane(text: $space.input, onDropFile: { model.open($0, into: space) }, onDragging: { dropping = $0 })
                            .overlay(alignment: .topLeading) { if space.input.isEmpty { emptyInput } }
                    }
                }
                .overlay { if dropping { DropOutline(inset: 6, radius: 4).padding(.top, 37) } }
                Rectangle().fill(Tema.border).frame(width: 1)
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
            ReportBar(space: space)
        }
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
            ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder private var banner: some View {
        if isAnonymize, model.engineState == .missing {
            Banner(symbol: "exclamationmark.triangle",
                   text: "Il motore di anonimizzazione non è nell'app. Esegui Scripts/prepara-motore.sh e ricompila.", tint: Tema.orange)
        } else if isAnonymize, case .failed(let reason) = model.engineState {
            Banner(symbol: "exclamationmark.triangle", text: reason, tint: Tema.orange)
        }
    }

    private func pane<Content: View>(title: String, detail: String?, @ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title).font(Tema.headline).foregroundStyle(Tema.text).fixedSize()
                if let detail {
                    Text(detail).font(Tema.body).foregroundStyle(Tema.secondary).lineLimit(1).truncationMode(.middle).help(detail)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(minHeight: 36)
            Rectangle().fill(Tema.border).frame(height: 1)
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Tema.surface)
        }
        .frame(minWidth: 200, maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyInput: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(isAnonymize ? "Incolla un testo o trascina qui un file" : "Incolla la risposta dell'AI o trascina qui un file anonimizzato")
                .font(Tema.body)
            Text("Testo, Markdown, CSV, Excel, Word o PDF; oppure aprilo con ⌘O. Niente lascia il Mac.")
                .font(Tema.callout)
        }
        .foregroundStyle(Tema.tertiary)
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .allowsHitTesting(false)
    }

    private var emptyOutput: some View {
        VStack(spacing: 8) {
            Image(systemName: isAnonymize ? "eye.slash" : "arrow.uturn.backward")
                .font(.system(size: 28, weight: .light))
            Text(isAnonymize ? "Qui il testo con i segnaposto" : "Qui il testo con i dati veri")
                .font(Tema.body)
            Text(isAnonymize ? "[FULLNAME_1], [IBAN_1]… al posto dei dati personali" : "I segnaposto tornano i dati del dizionario")
                .font(Tema.callout)
                .foregroundStyle(Tema.tertiary)
        }
        .foregroundStyle(Tema.secondary)
        .multilineTextAlignment(.center)
        .padding(20)
        .allowsHitTesting(false)
    }

    @ViewBuilder private var actions: some View {
        Button { model.chooseFile(for: space) } label: { Label("Apri…", systemImage: "doc.badge.plus") }
            .buttonStyle(.flat)
            .keyboardShortcut("o")
            .help("Apri un file: testo, Markdown, CSV, Excel, Word o PDF (⌘O)")
        Button { model.run(space) } label: { Label(runTitle, systemImage: isAnonymize ? "eye.slash" : "arrow.uturn.backward") }
            .buttonStyle(.primary)
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(!model.canRun(space))
            .help("\(runTitle) (⌘↩)")
            .padding(.leading, 4)
        BarSeparator()
        Button { model.copy(space) } label: { BarIcon(title: "Copia", symbol: "doc.on.doc") }
            .buttonStyle(.plainIcon)
            .keyboardShortcut("c", modifiers: [.command, .shift])
            .disabled(!space.hasOutput)
            .help("Copia il risultato (⇧⌘C)")
        Button { model.save(space) } label: { BarIcon(title: "Salva…", symbol: "square.and.arrow.down") }
            .buttonStyle(.plainIcon)
            .keyboardShortcut("s")
            .disabled(!space.hasOutput)
            .help("Salva il risultato in un file (⌘S)")
        if isAnonymize {
            Button { Task { await model.saveToProject(space) } } label: { BarIcon(title: "Salva nei documenti del progetto", symbol: "tray.and.arrow.down") }
                .buttonStyle(.plainIcon)
                .disabled(space.isFile || !space.hasOutput || space.isStale || space.isRunning || space.projectNote != nil)
                .help(space.isFile ? "Salva nei documenti del progetto · I file anonimizzati entrano da soli nei documenti del progetto"
                      : "Salva nei documenti del progetto · Archivia il testo e la sua versione anonimizzata nei documenti del progetto (le persone entrano nel CRM)")
        }
        Button { space.clear() } label: { BarIcon(title: "Pulisci", symbol: "xmark.circle") }
            .buttonStyle(.plainIcon)
            .disabled(space.isEmpty)
            .help("Pulisci · Ricomincia da capo")
    }
}

/// La riga in fondo: avanzamento, cosa è stato nascosto o rimesso, avvisi.
struct ReportBar: View {
    @Environment(AppModel.self) private var model
    let space: Workspace

    var body: some View {
        BottomBar {
            content
            Spacer(minLength: 0)
        }
        .foregroundStyle(Tema.text)
    }

    @ViewBuilder private var content: some View {
        if space.isRunning {
            if let progress = space.progress {
                ThinProgressBar(value: progress)
                Text(model.engineState == .loading ? "Preparo il motore…" : "Anonimizzo sul Mac…").foregroundStyle(Tema.secondary)
                Button("Annulla") { model.cancel(space) }.buttonStyle(.flatSmall)
            } else {
                ProgressView().controlSize(.small)
            }
        } else if space.isStale {
            Label("Il testo è cambiato: premi \(space.mode == .anonymize ? "Anonimizza" : "Riconverti") (⌘↩) per aggiornare il risultato",
                  systemImage: "arrow.clockwise")
                .foregroundStyle(Tema.secondary)
        } else if let outcome = space.outcome {
            switch outcome {
            case .anonymized(let report):
                if report.isEmpty {
                    Label("Nessun dato da nascondere con le categorie scelte", systemImage: "checkmark.circle")
                        .foregroundStyle(Tema.secondary)
                } else {
                    Label("Nascosti: \(report.summary)", systemImage: "eye.slash")
                    if report.newEntries > 0 {
                        Text("· \(report.newEntries) \(report.newEntries == 1 ? "nuovo" : "nuovi") nel dizionario").foregroundStyle(Tema.secondary)
                            .fixedSize()
                    }
                }
                if let note = space.projectNote {
                    Spacer(minLength: 8)
                    Button {
                        model.section = .documents
                    } label: {
                        Label(note, systemImage: "folder.badge.plus")
                    }
                    .buttonStyle(.accentLink)
                    .help("Apri i documenti del progetto")
                }
            case .revealed(let result):
                Label(result.count == 0 ? "Nessun segnaposto da riconvertire" : "Riconvertiti \(result.count) segnaposto",
                      systemImage: result.count == 0 ? "info.circle" : "checkmark.circle")
                    .foregroundStyle(result.count == 0 ? Tema.secondary : Tema.text)
                if !result.unknown.isEmpty {
                    Label("\(result.unknown.count) sconosciuti, rimasti com'erano: \(result.unknown.prefix(4).joined(separator: ", "))\(result.unknown.count > 4 ? "…" : "")",
                          systemImage: "exclamationmark.triangle")
                        .foregroundStyle(Tema.orange)
                        .help("Non sono nel dizionario di questo Mac: forse li ha inventati l'AI o vengono da un altro Mac.")
                }
            }
        } else {
            Label("Tutto avviene su questo Mac: niente viene inviato.", systemImage: "checkmark.shield")
                .foregroundStyle(Tema.secondary)
        }
    }
}

/// Una striscia colorata sotto la barra (motore assente, errori).
struct Banner: View {
    let symbol: String
    let text: String
    let tint: Color

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).foregroundStyle(tint)
            Text(text).foregroundStyle(Tema.text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(Tema.callout)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(tint.opacity(0.1))
    }
}
