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
        if let document = model.crm.document(documentID) {
            content(document)
        } else {
            ContentUnavailableView("Documento non trovato", systemImage: "doc.text")
        }
    }

    private struct LoadKey: Equatable {
        let version: UUID?
        let versions: Int
        let vault: Int
    }

    private func content(_ document: CRMDocument) -> some View {
        let version = document.versions.first { $0.id == selection }
        return HSplitView {
            versionList(document)
                .frame(minWidth: 220, idealWidth: 240, maxWidth: 320)
            VStack(spacing: 0) {
                if model.busyDocuments.contains(document.id) {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Anonimizzo sul Mac, con i dati del cliente che il CRM conosce…").foregroundStyle(.secondary)
                        Spacer()
                    }
                    .font(.callout)
                    .padding(10)
                    .background(.bar)
                    Divider()
                }
                if let loadError {
                    Banner(symbol: "exclamationmark.triangle.fill", text: loadError, tint: .orange)
                }
                Group {
                    if let preview {
                        DocumentPreviewView(preview: preview, highlights: highlights, highlightPlaceholders: version?.kind == .anonymized,
                                            comparedWith: compared)
                    } else if loading {
                        ProgressView(document.format == .pdf ? "Leggo il PDF…" : "Apro il documento…")
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        Text("Scegli una versione").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                Divider()
                if let version { actionBar(document, version) }
            }
            .frame(minWidth: 420)
        }
        .navigationTitle(document.title)
        .navigationSubtitle(model.crm.company(document.companyID)?.name ?? "")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button(document.anonymized == nil ? "Anonimizza" : "Anonimizza di nuovo", systemImage: "eye.slash") {
                    Task {
                        await model.anonymizeDocument(document.id)
                        selection = model.crm.document(document.id)?.anonymized?.id ?? selection
                    }
                }
                .disabled(model.busyDocuments.contains(document.id) || model.engineState == .missing || document.original == nil)
                Menu("Risposta dell'AI", systemImage: "arrow.uturn.backward.circle") {
                    Button("Incolla dagli appunti") { Task { await addAnswer(document) { await model.pasteAnswer(for: document.id) } } }
                    Button("Importa da un file…") { Task { await addAnswer(document) { await model.importAnswer(for: document.id) } } }
                }
                .help("Aggiungi la risposta dell'AI scritta con i segnaposto: qui la leggi riconvertita")
                Button("Elimina…", systemImage: "trash") { confirmingDeletion = true }
            }
        }
        .confirmationDialog("Eliminare «\(document.title)» e tutte le sue versioni?", isPresented: $confirmingDeletion, titleVisibility: .visible) {
            Button("Elimina", role: .destructive) { Task { await model.deleteDocument(document.id) } }
        }
        .task(id: LoadKey(version: selection, versions: document.versions.count, vault: model.vault.count)) {
            if selection == nil || version == nil { selection = document.anonymized?.id ?? document.original?.id }
            await load(document)
        }
    }

    /// Dopo una risposta nuova, la mostra.
    private func addAnswer(_ document: CRMDocument, _ add: () async -> Void) async {
        let before = Set(document.answers.map(\.id))
        await add()
        if let added = model.crm.document(document.id)?.answers.first(where: { !before.contains($0.id) }) { selection = added.id }
    }

    private func versionList(_ document: CRMDocument) -> some View {
        List(selection: $selection) {
            Section("Documento") {
                if let original = document.original {
                    versionRow(original, title: "Originale", symbol: "doc.text", detail: original.fileName.isEmpty ? Format.date(original.created) : original.fileName)
                }
            }
            Section("Da dare all'AI") {
                if let anonymized = document.anonymized {
                    versionRow(anonymized, title: "Anonimizzato", symbol: "eye.slash", detail: anonymized.summary)
                } else {
                    Text("Non ancora anonimizzato").foregroundStyle(.secondary).font(.callout)
                }
            }
            Section("Risposte dell'AI") {
                if document.answers.isEmpty {
                    Text("Incolla o importa la risposta: qui torna con i dati veri").foregroundStyle(.secondary).font(.callout)
                }
                ForEach(Array(document.answers.enumerated()), id: \.element.id) { index, answer in
                    versionRow(answer, title: "Risposta \(index + 1)", symbol: "arrow.uturn.backward.circle",
                               detail: Format.dateTime(answer.created) + (answer.summary.isEmpty ? "" : " · \(answer.summary)"))
                        .contextMenu {
                            Button("Elimina risposta", role: .destructive) { Task { await model.removeVersion(answer.id, from: document.id) } }
                        }
                }
            }
        }
        .listStyle(.sidebar)
    }

    private func versionRow(_ version: DocumentVersion, title: String, symbol: String, detail: String) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            }
        } icon: {
            Image(systemName: symbol)
        }
        .tag(version.id)
    }

    @ViewBuilder private func actionBar(_ document: CRMDocument, _ version: DocumentVersion) -> some View {
        HStack(spacing: 10) {
            switch version.kind {
            case .original:
                Label("Originale, con i dati veri: resta su questo Mac", systemImage: "lock.fill").foregroundStyle(.secondary)
                Spacer()
                Button("Esporta…") { Task { await model.export(version, of: document) } }
            case .anonymized:
                Label(version.summary.isEmpty ? "Anonimizzato" : version.summary, systemImage: "eye.slash.fill")
                Spacer()
                Button("Copia") { model.copy(preview?.plainText ?? "") }
                    .help("Copia il testo anonimizzato, da incollare nell'AI")
                Button("Esporta…") { Task { await model.export(version, of: document) } }
            case .aiAnswer:
                if unknown.isEmpty {
                    Label(version.summary.isEmpty ? "Risposta riconvertita" : version.summary, systemImage: "checkmark.circle.fill")
                } else {
                    Label("\(unknown.count) segnaposto sconosciuti: \(unknown.prefix(3).joined(separator: ", "))\(unknown.count > 3 ? "…" : "")",
                          systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
                Spacer()
                Button("Copia riconvertito") { model.copy(preview?.plainText ?? "") }
                Button("Esporta riconvertito…") { Task { await model.export(version, of: document) } }
            }
        }
        .font(.callout)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(.bar)
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
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Scheda anonimizzata").font(.title3.weight(.semibold))
                    Text("Anagrafica, contatti, trattative, note e documenti del cliente, senza dati personali.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Picker("Versione", selection: $showOriginal) {
                    Text("Anonimizzata").tag(false)
                    Text("Originale").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 220)
                .disabled(result == nil)
            }
            .padding(16)
            Divider()
            Group {
                if let result {
                    TextPane(text: .constant(showOriginal ? original : result.text),
                             highlights: showOriginal ? [] : Revealer.placeholderRanges(in: result.text), isEditable: false)
                } else if let error {
                    ContentUnavailableView("Non sono riuscito ad anonimizzare la scheda", systemImage: "exclamationmark.triangle",
                                           description: Text(error))
                } else {
                    ProgressView("Anonimizzo la scheda sul Mac…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            HStack(spacing: 10) {
                if let result {
                    Label(result.report.isEmpty ? "Nessun dato da nascondere" : "Nascosti: \(result.report.summary)", systemImage: "eye.slash.fill")
                        .font(.callout)
                        .lineLimit(1)
                }
                Spacer()
                Button("Copia") { if let result { model.copy(result.text) } }
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
                .disabled(result == nil)
                Button("Chiudi") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(14)
        }
        .frame(width: 780, height: 640)
        .task {
            do {
                (original, result) = try await model.dossier(for: companyID)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
