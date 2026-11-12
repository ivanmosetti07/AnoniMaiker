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
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Progetti").font(Tema.largeTitle).foregroundStyle(Tema.text)
                        Text("Ogni progetto contiene i suoi documenti, il suo CRM e il suo dizionario: anonimizzi, riconverti e chiedi a GPT sempre dentro un progetto.")
                            .font(Tema.body)
                            .foregroundStyle(Tema.secondary)
                            .lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Button { naming = .create } label: { Label("Nuovo progetto", systemImage: "plus") }
                        .buttonStyle(.primaryLarge)
                        .keyboardShortcut("n", modifiers: [.command, .shift])
                        .disabled(!model.isVaultReady)
                        .help("Nuovo progetto (⇧⌘N)")
                }
                if model.projects.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "folder.badge.plus").font(.system(size: 40, weight: .light)).foregroundStyle(Tema.secondary)
                        Text("Nessun progetto").font(.system(size: 16)).foregroundStyle(Tema.text)
                        Text("Crea il primo: per esempio il nome di un cliente, di un evento o di una pratica.")
                            .font(Tema.body)
                            .foregroundStyle(Tema.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 60)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 14)], spacing: 14) {
                        ForEach(model.projects) { project in
                            ProjectCard(project: project, onRename: { naming = .rename(project) }, onDelete: { deleting = project })
                        }
                    }
                }
            }
            .padding(28)
        }
        .scrollContentBackground(.hidden)
        .background(Tema.bg)
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
}

/// La card di un progetto: grigio tenue, più scuro e con il bordo al passaggio del mouse.
private struct ProjectCard: View {
    @Environment(AppModel.self) private var model
    let project: Project
    let onRename: () -> Void
    let onDelete: () -> Void
    @State private var hovering = false

    var body: some View {
        Button {
            model.selectProject(project.id)
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: "folder.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(Tema.accent)
                Text(project.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Tema.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text("Aggiornato \(Format.date(project.updated))")
                    .font(Tema.caption)
                    .foregroundStyle(Tema.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 78, alignment: .topLeading)
            .padding(16)
            .background(Color.gray.opacity(hovering ? 0.13 : 0.08), in: .rect(cornerRadius: Tema.radiusCard))
            .overlay(RoundedRectangle(cornerRadius: Tema.radiusCard).strokeBorder(hovering ? Tema.border : .clear))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(project.name)
        .contextMenu {
            Button("Apri") { model.selectProject(project.id) }
            Button("Rinomina…", action: onRename)
            Divider()
            Button("Elimina…", role: .destructive, action: onDelete)
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
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                Text(isNew ? "Nuovo progetto" : "Rinomina il progetto").font(Tema.title2)
                TextField("Nome del progetto", text: $name, prompt: Text("Per esempio: Evento Roma 2027"))
                    .styledField()
                    .focused($focused)
                    .onSubmit(confirm)
                Text("Il nome resta sul Mac. A GPT arriva anonimizzato, come i titoli dei documenti.")
                    .font(Tema.caption)
                    .foregroundStyle(Tema.secondary)
            }
            .padding(20)
            SheetActions {
                Button("Annulla") { dismiss() }
                    .buttonStyle(.flat)
                    .keyboardShortcut(.cancelAction)
                Button(isNew ? "Crea" : "Rinomina", action: confirm)
                    .buttonStyle(.primary)
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .frame(width: 420)
        .background(Tema.surface)
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
