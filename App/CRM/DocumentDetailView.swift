import AnonymizerKit
import SwiftUI

/// Un documento del cliente: l'originale, la versione anonimizzata da dare all'AI, le risposte dell'AI riconvertite.
struct DocumentDetailView: View {
    let documentID: UUID
    @Environment(AppModel.self) private var model
    @State private var selection: UUID?
    @State private var preview: DocumentPreview?
    /// La stessa versione con i segnaposto (per le risposte dell'AI): le celle cambiate si evidenziano.
    @State private var compared: DocumentPreview?
    @State private var highlights: [NSRange] = []
    @State private var unknown: [String] = []
    @State private var loading = false
    @State private var loadError: String?
    @State private var confirmingDeletion = false

    var body: some View {
        Group {
            if let document = model.crm.document(documentID) {
                content(document)
            } else {
                VStack(spacing: 0) {
                    TopBar(title: "", leading: { CRMBackButton() }, actions: { EmptyView() })
                    EmptyState("Documento non trovato", symbol: "doc.text")
                }
            }
        }
        .background(Tema.bg)
        .navigationBarBackButtonHidden(true)
    }

    private struct LoadKey: Equatable {
        let version: UUID?
        let versions: Int
        let vault: Int
    }

    private func content(_ document: CRMDocument) -> some View {
        let version = document.versions.first { $0.id == selection }
        let busy = model.busyDocuments.contains(document.id)
        return VStack(spacing: 0) {
            TopBar(title: document.title, subtitle: model.crm.company(document.companyID)?.name ?? "", leading: { CRMBackButton() }) {
                let title = document.anonymized == nil ? "Anonimizza" : "Anonimizza di nuovo"
                Button {
                    Task {
                        await model.anonymizeDocument(document.id)
                        selection = model.crm.document(document.id)?.anonymized?.id ?? selection
                    }
                } label: { BarIcon(title: title, symbol: "eye.slash") }
                    .buttonStyle(.plainIcon)
                    .help(title)
                    .disabled(busy || model.engineState == .missing || document.original == nil)
                BarMenu(title: "Risposta dell'AI: aggiungi la risposta dell'AI scritta con i segnaposto, qui la leggi riconvertita",
                        symbol: "arrow.uturn.backward") {
                    Button("Incolla dagli appunti") { Task { await addAnswer(document) { await model.pasteAnswer(for: document.id) } } }
                    Button("Importa da un file…") { Task { await addAnswer(document) { await model.importAnswer(for: document.id) } } }
                }
                Button { confirmingDeletion = true } label: { BarIcon(title: "Elimina…", symbol: "trash") }
                    .buttonStyle(.plainIcon)
                    .help("Elimina…")
            }
            // Un HStack e non un HSplitView: accanto al pannello della chat la divisione di AppKit entra in un ciclo di layout
            // che chiude l'app.
            HStack(spacing: 0) {
                versionList(document)
                    .frame(width: 240)
                Rectangle().fill(Tema.border).frame(width: 1)
                VStack(spacing: 0) {
                    if busy {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("Anonimizzo sul Mac, con i dati del cliente che il CRM conosce…").foregroundStyle(Tema.secondary)
                            Spacer()
                        }
                        .font(Tema.callout)
                        .padding(10)
                        .background(Tema.bar)
                        Rectangle().fill(Tema.border).frame(height: 1)
                    }
                    if let loadError {
                        Banner(symbol: "exclamationmark.triangle", text: loadError, tint: Tema.orange)
                    }
                    Group {
                        if let preview {
                            DocumentPreviewView(preview: preview, highlights: highlights, highlightPlaceholders: version?.kind == .anonymized,
                                                comparedWith: compared)
                        } else if loading {
                            VStack(spacing: 8) {
                                ProgressView().controlSize(.small)
                                Text(document.format == .pdf ? "Leggo il PDF…" : "Apro il documento…")
                            }
                            .font(Tema.body)
                            .foregroundStyle(Tema.secondary)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        } else {
                            Text("Scegli una versione").font(Tema.body).foregroundStyle(Tema.secondary)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .surfaceBackground()
                    if let version { actionBar(document, version) }
                }
                .frame(minWidth: 280, maxWidth: .infinity)
            }
        }
        .confirmationDialog("Eliminare «\(document.title)» e tutte le sue versioni?", isPresented: $confirmingDeletion, titleVisibility: .visible) {
            Button("Elimina", role: .destructive) { Task { await model.deleteDocument(document.id) } }
        }
        .task(id: LoadKey(version: selection, versions: document.versions.count, vault: model.vault.count)) {
            if selection == nil || version == nil { selection = document.anonymized?.id ?? document.original?.id }
            await load(document)
        }
        #if DEBUG
        .onChange(of: ProvaComandi.shared.versione) { _, value in
            guard let value else { return }
            selection = (value == "originale" ? document.original : document.anonymized)?.id ?? selection
            ProvaComandi.shared.versione = nil
        }
        #endif
    }

    /// Dopo una risposta nuova, la mostra.
    private func addAnswer(_ document: CRMDocument, _ add: () async -> Void) async {
        let before = Set(document.answers.map(\.id))
        await add()
        if let added = model.crm.document(document.id)?.answers.first(where: { !before.contains($0.id) }) { selection = added.id }
    }

    /// Le versioni in una colonna come la barra laterale.
    private func versionList(_ document: CRMDocument) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                sectionHeader("Documento")
                if let original = document.original {
                    versionRow(original, title: "Originale", symbol: "doc.text", detail: original.fileName.isEmpty ? Format.date(original.created) : original.fileName)
                }
                sectionHeader("Da dare all'AI")
                if let anonymized = document.anonymized {
                    versionRow(anonymized, title: "Anonimizzato", symbol: "eye.slash", detail: anonymized.summary)
                } else {
                    hint("Non ancora anonimizzato")
                }
                sectionHeader("Risposte dell'AI")
                if document.answers.isEmpty {
                    hint("Incolla o importa la risposta: qui torna con i dati veri")
                }
                ForEach(Array(document.answers.enumerated()), id: \.element.id) { index, answer in
                    versionRow(answer, title: "Risposta \(index + 1)", symbol: "arrow.uturn.backward",
                               detail: Format.dateTime(answer.created) + (answer.summary.isEmpty ? "" : " · \(answer.summary)"))
                        .contextMenu {
                            Button("Elimina risposta", role: .destructive) { Task { await model.removeVersion(answer.id, from: document.id) } }
                        }
                }
            }
            .padding(.top, 4)
            .padding(.bottom, 10)
        }
        .background(Tema.sidebar)
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Tema.secondary)
            .padding(.horizontal, 10)
            .padding(.top, 10)
            .padding(.bottom, 2)
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(Tema.callout)
            .foregroundStyle(Tema.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 18)
            .padding(.vertical, 4)
    }

    private func versionRow(_ version: DocumentVersion, title: String, symbol: String, detail: String) -> some View {
        VersionRow(title: title, symbol: symbol, detail: detail, isSelected: selection == version.id) { selection = version.id }
    }

    @ViewBuilder private func actionBar(_ document: CRMDocument, _ version: DocumentVersion) -> some View {
        BottomBar {
            switch version.kind {
            case .original:
                Label("Originale, con i dati veri: resta su questo Mac", systemImage: "lock").foregroundStyle(Tema.secondary).lineLimit(1)
                Spacer()
                Button("Esporta…") { Task { await model.export(version, of: document) } }
                    .buttonStyle(.flat)
            case .anonymized:
                Label(version.summary.isEmpty ? "Anonimizzato" : version.summary, systemImage: "eye.slash").lineLimit(1)
                Spacer()
                Button("Copia") { model.copy(preview?.plainText ?? "") }
                    .buttonStyle(.flat)
                    .help("Copia il testo anonimizzato, da incollare nell'AI")
                Button("Esporta…") { Task { await model.export(version, of: document) } }
                    .buttonStyle(.flat)
            case .aiAnswer:
                if unknown.isEmpty {
                    Label(version.summary.isEmpty ? "Risposta riconvertita" : version.summary, systemImage: "checkmark.circle").lineLimit(1)
                } else {
                    Label("\(unknown.count) segnaposto sconosciuti: \(unknown.prefix(3).joined(separator: ", "))\(unknown.count > 3 ? "…" : "")",
                          systemImage: "exclamationmark.triangle")
                        .foregroundStyle(Tema.orange)
                        .lineLimit(1)
                }
                Spacer()
                Button("Copia riconvertito") { model.copy(preview?.plainText ?? "") }
                    .buttonStyle(.flat)
                Button("Esporta riconvertito…") { Task { await model.export(version, of: document) } }
                    .buttonStyle(.flat)
            }
        }
    }

    private func load(_ document: CRMDocument) async {
        guard let version = document.versions.first(where: { $0.id == selection }) else {
            preview = nil
            highlights = []
            return
        }
        loading = true
        defer { loading = false }
        do {
            let result = try await model.preview(of: version, in: document)
            guard selection == version.id else { return }
            loadError = nil
            preview = result.preview
            compared = result.compared
            highlights = result.highlights
            unknown = result.unknown
        } catch {
            loadError = error.localizedDescription
            preview = nil
            highlights = []
        }
    }
}

/// Una versione nella colonna del documento: come una riga della barra laterale, con il dettaglio su due righe.
private struct VersionRow: View {
    let title: String
    let symbol: String
    let detail: String
    let isSelected: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 14))
                    .foregroundStyle(isSelected ? Tema.accentStrong : Tema.text)
                    .frame(width: 18)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Tema.body).foregroundStyle(Tema.text)
                    if !detail.isEmpty {
                        Text(detail).font(Tema.caption).foregroundStyle(Tema.secondary).lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(isSelected ? Tema.accentSoft : hovering ? Tema.hover : .clear, in: .rect(cornerRadius: Tema.radiusSmall))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .padding(.horizontal, 8)
        .padding(.vertical, 1)
    }
}

/// La scheda del cliente anonimizzata, pronta da copiare nell'AI.
struct DossierSheet: View {
    let companyID: UUID
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var original = ""
    @State private var result: AnonymizationResult?
    @State private var showOriginal = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Scheda anonimizzata").font(Tema.title2)
                    Text("Anagrafica, contatti, trattative, note e documenti del cliente, senza dati personali.")
                        .font(Tema.callout).foregroundStyle(Tema.secondary)
                }
                Spacer()
                AccentSegmented(selection: $showOriginal, options: [(value: false, title: "Anonimizzata"), (value: true, title: "Originale")])
                    .disabled(result == nil)
                    .opacity(result == nil ? 0.45 : 1)
            }
            .padding(16)
            Rectangle().fill(Tema.border).frame(height: 1)
            Group {
                if let result {
                    TextPane(text: .constant(showOriginal ? original : result.text),
                             highlights: showOriginal ? [] : Revealer.placeholderRanges(in: result.text), isEditable: false)
                } else if let error {
                    EmptyState("Non sono riuscito ad anonimizzare la scheda", symbol: "exclamationmark.triangle", message: error)
                } else {
                    VStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Anonimizzo la scheda sul Mac…")
                    }
                    .font(Tema.body)
                    .foregroundStyle(Tema.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            SheetActions {
                if let result {
                    Label(result.report.isEmpty ? "Nessun dato da nascondere" : "Nascosti: \(result.report.summary)", systemImage: "eye.slash")
                        .font(Tema.callout)
                        .lineLimit(1)
                }
            } trailing: {
                Button("Copia") { if let result { model.copy(result.text) } }
                    .buttonStyle(.flat)
                    .disabled(result == nil || showOriginal)
                    .help("Copia la scheda anonimizzata, da incollare nell'AI")
                Button("Salva…") {
                    guard let result else { return }
                    do {
                        try FilePanels.save(Data(result.text.utf8), suggestedName: "Scheda cliente (anonimizzata).md", in: nil)
                    } catch {
                        model.alert = error.localizedDescription
                    }
                }
                .buttonStyle(.flat)
                .disabled(result == nil)
                Button("Chiudi") { dismiss() }
                    .buttonStyle(.flat)
                    .keyboardShortcut(.cancelAction)
                    .help("Chiudi (Esc)")
            }
        }
        .frame(width: 780, height: 640)
        .background(Tema.surface)
        #if DEBUG
        .onChange(of: ProvaComandi.shared.dossier) { _, value in
            guard let value else { return }
            showOriginal = value == "originale"
            ProvaComandi.shared.dossier = nil
        }
        #endif
        .task {
            do {
                (original, result) = try await model.dossier(for: companyID)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
