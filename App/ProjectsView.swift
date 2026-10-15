import AnonymizerKit
import SwiftUI

/// Creare o rinominare un progetto.
enum ProjectNaming: Identifiable {
    case create
    case rename(Project)

    var id: String {
        switch self {
        case .create: "nuovo"
        case .rename(let project): project.id.uuidString
        }
    }
}

/// L'elenco dei progetti: si apre uno o se ne crea uno nuovo.
struct ProjectsView: View {
    @Environment(AppModel.self) private var model
    @State private var naming: ProjectNaming?
    @State private var deleting: Project?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Progetti").font(.largeTitle).fontWeight(.semibold)
                        Text("Ogni progetto contiene i suoi documenti, il suo CRM e il suo dizionario: anonimizzi, riconverti e chiedi a GPT sempre dentro un progetto.")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Nuovo progetto", systemImage: "plus") { naming = .create }
                        .buttonStyle(.borderedProminent)
                        .keyboardShortcut("n", modifiers: [.command, .shift])
                        .disabled(!model.isVaultReady)
                }
                if model.projects.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "folder.badge.plus").font(.system(size: 40, weight: .light)).foregroundStyle(.secondary)
                        Text("Nessun progetto").font(.title3)
                        Text("Crea il primo: per esempio il nome di un cliente, di un evento o di una pratica.")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 60)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 14)], spacing: 14) {
                        ForEach(model.projects) { project in
                            card(project)
                        }
                    }
                }
            }
            .padding(28)
        }
        .navigationTitle("Progetti")
        .sheet(item: $naming) { ProjectNameSheet(naming: $0) }
        // Dalla guida: «Crea il primo progetto».
        .task(id: model.requestsNewProject) {
            guard model.requestsNewProject else { return }
            model.requestsNewProject = false
            try? await Task.sleep(for: .milliseconds(400))
            naming = .create
        }
        .confirmationDialog("Eliminare il progetto?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            presenting: deleting) { project in
            Button("Elimina «\(project.name)»", role: .destructive) { Task { await model.deleteProject(project.id) } }
        } message: { project in
            Text("Si cancellano da questo Mac i suoi documenti, il CRM, il dizionario e le conversazioni. I file anonimizzati di questo progetto non si potranno più riconvertire.")
        }
    }

    private func card(_ project: Project) -> some View {
        Button {
            model.selectProject(project.id)
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: "folder.fill")
                    .font(.title)
                    .foregroundStyle(Color.accentColor)
                Text(project.name)
                    .font(.headline)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text("Aggiornato \(Format.date(project.updated))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
            .padding(16)
            .background(.secondary.opacity(0.08), in: .rect(cornerRadius: 12))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Apri") { model.selectProject(project.id) }
            Button("Rinomina…") { naming = .rename(project) }
            Divider()
            Button("Elimina…", role: .destructive) { deleting = project }
        }
    }
}

/// Il nome di un progetto nuovo, o il nuovo nome di uno che c'è.
struct ProjectNameSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let naming: ProjectNaming
    @State private var name = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(isNew ? "Nuovo progetto" : "Rinomina il progetto").font(.title3).fontWeight(.semibold)
            TextField("Nome del progetto", text: $name, prompt: Text("Per esempio: Evento Roma 2027"))
                .textFieldStyle(.roundedBorder)
                .focused($focused)
                .onSubmit(confirm)
            Text("Il nome resta sul Mac. A GPT arriva anonimizzato, come i titoli dei documenti.")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Annulla") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(isNew ? "Crea" : "Rinomina", action: confirm)
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(22)
        .frame(width: 420)
        .onAppear {
            if case .rename(let project) = naming { name = project.name }
            focused = true
        }
    }

    private var isNew: Bool { if case .create = naming { true } else { false } }

    private func confirm() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        switch naming {
        case .create: Task { await model.createProject(named: trimmed) }
        case .rename(let project): Task { await model.renameProject(project.id, to: trimmed) }
        }
        dismiss()
    }
}
