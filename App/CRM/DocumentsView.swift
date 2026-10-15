import AnonymizerKit
import SwiftUI

/// I documenti del progetto: ogni file con le sue versioni (originale, anonimizzato, risposte e modifiche dell'AI).
/// Un file trascinato qui si anonimizza da solo, e le persone trovate entrano nel CRM del progetto.
struct DocumentsView: View {
    @Environment(AppModel.self) private var model
    @State private var search = ""
    @State private var isTargeted = false

    private var documents: [CRMDocument] {
        let all = model.crm.documents.sorted { $0.updated > $1.updated }
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return all }
        return all.filter { $0.title.localizedCaseInsensitiveContains(query) || ($0.original?.fileName ?? "").localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        Group {
            if model.crm.documents.isEmpty {
                ContentUnavailableView {
                    Label("Nessun documento nel progetto", systemImage: "doc.on.doc")
                } description: {
                    Text("Trascina qui i file (testo, Markdown, CSV, Excel, Word, PDF) o aggiungili con il pulsante: si anonimizzano subito, restano cifrati su questo Mac e le persone che contengono entrano nel CRM del progetto. Anche i file anonimizzati nel banco «Anonimizza» arrivano qui.")
                } actions: {
                    Button("Aggiungi documenti…") { Task { await model.chooseDocuments(for: nil) } }
                        .disabled(!model.isVaultReady)
                }
            } else {
                List(documents) { document in
                    NavigationLink(value: CRMRoute.document(document.id)) {
                        DocumentRow(document: document)
                    }
                    .contextMenu {
                        Button("Anonimizza di nuovo") { Task { await model.anonymizeDocument(document.id) } }
                            .disabled(model.engineState == .missing)
                        Button("Chiedi alla chat") {
                            model.showsChat = true
                            Task { await model.attach(document) }
                        }
                        Divider()
                        Button("Elimina", role: .destructive) { Task { await model.deleteDocument(document.id) } }
                    }
                }
                .searchable(text: $search, prompt: "Cerca nei titoli")
                .safeAreaInset(edge: .bottom) {
                    HStack {
                        Text("Trascina qui altri file: si anonimizzano subito").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Aggiungi documenti…", systemImage: "doc.badge.plus") { Task { await model.chooseDocuments(for: nil) } }
                    }
                    .padding(10)
                    .background(.bar)
                }
            }
        }
        .navigationTitle("Documenti")
        .navigationSubtitle(model.currentProject?.name ?? "")
        .toolbar {
            Button("Aggiungi documenti…", systemImage: "doc.badge.plus") { Task { await model.chooseDocuments(for: nil) } }
                .disabled(!model.isVaultReady)
                .help("Aggiungi file al progetto: si anonimizzano subito")
        }
        .dropDestination(for: URL.self) { urls, _ in
            Task { await model.addDocuments(urls, to: nil) }
            return true
        } isTargeted: { isTargeted = $0 }
        .overlay {
            if isTargeted {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [7]))
                    .padding(8)
                    .allowsHitTesting(false)
            }
        }
    }
}
