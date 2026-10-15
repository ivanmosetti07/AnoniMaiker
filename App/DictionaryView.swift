import AnonymizerKit
import SwiftUI

/// Il dizionario unico: segnaposto, categoria e valore vero (nascosto finché non lo chiedi).
struct DictionaryView: View {
    @Environment(AppModel.self) private var model
    @State private var search = ""
    @State private var showValues = false
    @State private var selection = Set<String>()
    @State private var sortOrder = [EntryComparator(field: .placeholder)]
    @State private var confirmingRemoval = false

    private var entries: [VaultEntry] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        let all = model.dictionaryClient.map { model.vault.entries(of: $0) } ?? model.vault.entries
        let filtered = query.isEmpty ? all : all.filter {
            $0.placeholder.lowercased().contains(query) || $0.value.lowercased().contains(query)
                || PIICategory.name($0.label, count: 1).contains(query)
        }
        return filtered.sorted(using: sortOrder)
    }

    /// «Edilnord S.r.l., Bianchi Bike».
    private func clients(of entry: VaultEntry) -> String {
        let names = entry.clients.compactMap { model.crm.company($0)?.name }.sorted()
        return names.isEmpty ? "—" : names.joined(separator: ", ")
    }

    var body: some View {
        Group {
            if model.vault.isEmpty {
                ContentUnavailableView {
                    Label("Il dizionario è vuoto", systemImage: "character.book.closed")
                } description: {
                    Text("Anonimizza un testo: i dati nascosti e i loro segnaposto compariranno qui.")
                }
            } else {
                Table(entries, selection: $selection, sortOrder: $sortOrder) {
                    TableColumn("Segnaposto", sortUsing: EntryComparator(field: .placeholder)) { entry in
                        Text(entry.placeholder).monospaced()
                    }
                    .width(min: 140, ideal: 170)
                    TableColumn("Categoria", sortUsing: EntryComparator(field: .category)) { entry in
                        Text(PIICategory.name(entry.label, count: 1).capitalizedFirst)
                    }
                    .width(min: 100, ideal: 130)
                    TableColumn("Valore vero", sortUsing: EntryComparator(field: .value)) { entry in
                        Text(showValues ? entry.value : "••••••••").textSelection(.enabled)
                            .foregroundStyle(showValues ? .primary : .tertiary)
                    }
                    TableColumn("Clienti") { entry in
                        Text(clients(of: entry)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .width(min: 100, ideal: 160)
                    TableColumn("Ultimo uso", sortUsing: EntryComparator(field: .lastUsed)) { entry in
                        Text(entry.lastUsed, format: .dateTime.day().month().year().hour().minute()).foregroundStyle(.secondary)
                    }
                    .width(min: 120, ideal: 150)
                }
                .contextMenu(forSelectionType: String.self) { ids in
                    if let id = ids.first, ids.count == 1, let entry = model.vault.entry(id) {
                        Button("Copia segnaposto") { copy(entry.placeholder) }
                        Button("Copia valore vero") { copy(entry.value) }
                        Divider()
                    }
                    Button("Elimina…", role: .destructive) {
                        selection = ids
                        confirmingRemoval = true
                    }
                    .disabled(ids.isEmpty)
                }
            }
        }
        .navigationTitle("Dizionario")
        .navigationSubtitle(model.vault.isEmpty ? "" : "\(model.vault.count) voci")
        .searchable(text: $search, prompt: "Cerca segnaposto, valore o categoria")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Picker("Cliente", selection: Binding(get: { model.dictionaryClient }, set: { model.dictionaryClient = $0 })) {
                    Text("Tutti i clienti").tag(UUID?.none)
                    ForEach(model.companyChoices) { company in
                        Text(company.name).tag(Optional(company.id))
                    }
                }
                .pickerStyle(.menu)
                .help("Mostra solo le voci di un cliente")
                Toggle(isOn: $showValues) {
                    Label(showValues ? "Nascondi valori" : "Mostra valori", systemImage: showValues ? "eye" : "eye.slash")
                }
                .help(showValues ? "Nascondi i valori veri" : "Mostra i valori veri")
                Button("Elimina…", systemImage: "trash") { confirmingRemoval = true }
                    .disabled(selection.isEmpty)
            }
        }
        .confirmationDialog("Eliminare \(selection.count == 1 ? "questa voce" : "\(selection.count) voci") dal dizionario?",
                            isPresented: $confirmingRemoval, titleVisibility: .visible) {
            Button("Elimina", role: .destructive) {
                let removed = selection
                selection = []
                Task { await model.remove(removed) }
            }
        } message: {
            Text("I file che usano questi segnaposto non potranno più riavere i dati veri. I numeri non verranno riusati.")
        }
        .safeAreaInset(edge: .bottom) { footer }
        .task { await model.refreshVault() }
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.fill").foregroundStyle(.secondary)
            if case .ready(let protection) = model.vaultState {
                Text("Cifrato sul Mac · chiave custodita da: \(protection.description)")
            } else {
                Text("Dizionario non aperto")
            }
            Spacer()
            Button("Mostra nel Finder") { model.showVaultInFinder() }
                .buttonStyle(.link)
        }
        .font(.callout)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(.bar)
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

/// Ordinamento delle colonne del dizionario.
struct EntryComparator: SortComparator, Hashable, Sendable {
    enum Field: Hashable, Sendable { case placeholder, category, value, lastUsed }

    var field: Field
    var order: SortOrder = .forward

    func compare(_ lhs: VaultEntry, _ rhs: VaultEntry) -> ComparisonResult {
        let result: ComparisonResult = switch field {
        // Ordine naturale: categoria, poi numero («[FULLNAME_2]» prima di «[FULLNAME_10]»).
        case .placeholder: lhs.label != rhs.label ? lhs.label.compare(rhs.label) : Self.compare(lhs.number, rhs.number)
        case .category: PIICategory.name(lhs.label, count: 1).localizedStandardCompare(PIICategory.name(rhs.label, count: 1))
        case .value: lhs.value.localizedStandardCompare(rhs.value)
        case .lastUsed: Self.compare(lhs.lastUsed, rhs.lastUsed)
        }
        guard order == .reverse else { return result }
        return switch result {
        case .orderedAscending: .orderedDescending
        case .orderedDescending: .orderedAscending
        case .orderedSame: .orderedSame
        }
    }

    private static func compare<T: Comparable>(_ a: T, _ b: T) -> ComparisonResult {
        a < b ? .orderedAscending : a > b ? .orderedDescending : .orderedSame
    }
}

extension String {
    /// «codice fiscale» → «Codice fiscale».
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
