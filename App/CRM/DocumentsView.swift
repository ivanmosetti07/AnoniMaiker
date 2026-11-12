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
        VStack(spacing: 0) {
            TopBar(title: "Documenti", subtitle: model.currentProject?.name ?? "") {
                if !model.crm.documents.isEmpty {
                    SearchField(text: $search, prompt: "Cerca nei titoli", width: 220)
                }
                Button { Task { await model.chooseDocuments(for: nil) } } label: { BarIcon(title: "Aggiungi documenti…", symbol: "doc.badge.plus") }
                    .buttonStyle(.plainIcon)
                    .disabled(!model.isVaultReady)
                    .help("Aggiungi file al progetto: si anonimizzano subito")
            }
            VStack(spacing: 0) {
                if model.crm.documents.isEmpty {
                    EmptyState(title: "Nessun documento nel progetto", symbol: "doc.on.doc",
                               message: "Trascina qui i file (testo, Markdown, CSV, Excel, Word, PDF) o aggiungili con il pulsante: si anonimizzano subito, restano cifrati su questo Mac e le persone che contengono entrano nel CRM del progetto. Anche i file anonimizzati nel banco «Anonimizza» arrivano qui.") {
                        Button("Aggiungi documenti…") { Task { await model.chooseDocuments(for: nil) } }
                            .buttonStyle(.flat)
                            .disabled(!model.isVaultReady)
                    }
                    .background(Tema.bg)
                } else {
                    FlatList {
                        ForEach(documents) { document in
                            DocumentRow(document: document)
                                .flatRow()
                                .onTapGesture { model.documentsPath.append(.document(document.id)) }
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
                    }
                    BottomBar {
                        Text("Trascina qui altri file: si anonimizzano subito").font(Tema.caption).foregroundStyle(Tema.secondary)
                        Spacer()
                        Button { Task { await model.chooseDocuments(for: nil) } } label: {
                            Label("Aggiungi documenti…", systemImage: "doc.badge.plus")
                        }
                        .buttonStyle(.flat)
                    }
                }
            }
            .dropDestination(for: URL.self) { urls, _ in
                Task { await model.addDocuments(urls, to: nil) }
                return true
            } isTargeted: { isTargeted = $0 }
            .overlay { if isTargeted { DropOutline(inset: 8, radius: 12) } }
        }
        .navigationBarBackButtonHidden(true)
    }
}
