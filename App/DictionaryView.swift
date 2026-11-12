import AnonymizerKit
import SwiftUI

/// Il dizionario unico: segnaposto, categoria e valore vero (nascosto finché non lo chiedi).
struct DictionaryView: View {
    @Environment(AppModel.self) private var model
    @State private var search = ""
    @State private var showValues = false
    @State private var selection = Set<String>()
    @State private var anchor: String?
    @State private var sortOrder = EntryComparator(field: .placeholder)
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
        VStack(spacing: 0) {
            TopBar(title: "Dizionario", subtitle: model.vault.isEmpty ? nil : "\(model.vault.count) voci") { actions }
            if model.vault.isEmpty {
                EmptyState("Il dizionario è vuoto", symbol: "character.book.closed",
                           message: "Anonimizza un testo: i dati nascosti e i loro segnaposto compariranno qui.")
            } else {
                table
            }
            footer
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
        .task { await model.refreshVault() }
    }

    @ViewBuilder private var actions: some View {
        SearchField(text: $search, prompt: "Cerca segnaposto, valore o categoria", width: 250)
        FlatMenuPicker(selection: Binding(get: { model.dictionaryClient }, set: { model.dictionaryClient = $0 }),
                       options: [(value: UUID?.none, title: "Tutti i clienti")] + model.companyChoices.map { (value: Optional($0.id), title: $0.name) })
            .frame(maxWidth: 180)
            .padding(.leading, 6)
        .help("Mostra solo le voci di un cliente")
        Button { showValues.toggle() } label: {
            Label(showValues ? "Nascondi valori" : "Mostra valori", systemImage: showValues ? "eye" : "eye.slash")
                .padding(.horizontal, 5)
        }
        .buttonStyle(.plainIcon(on: showValues))
        .help(showValues ? "Nascondi i valori veri" : "Mostra i valori veri")
        Button { confirmingRemoval = true } label: { Label("Elimina…", systemImage: "trash").padding(.horizontal, 5) }
            .buttonStyle(.plainIcon)
            .disabled(selection.isEmpty)
    }

    // MARK: Tabella piatta

    private var table: some View {
        let rows = entries
        return ScrollView {
            LazyVStack(spacing: 0, pinnedViews: .sectionHeaders) {
                Section {
                    ForEach(rows, id: \.id) { entry in
                        DictionaryRow(entry: entry, clients: clients(of: entry), showValues: showValues, isSelected: selection.contains(entry.id))
                            .onTapGesture { select(entry.id, in: rows) }
                            .contextMenu { menu(for: entry) }
                    }
                } header: {
                    header
                }
            }
        }
        .background(Tema.bg)
        .background { Color.clear.contentShape(.rect).onTapGesture { selection = [] } }
    }

    private var header: some View {
        HStack(spacing: 0) {
            column(.placeholder, "Segnaposto").frame(width: DictionaryRow.widths[0], alignment: .leading)
            column(.category, "Categoria").frame(width: DictionaryRow.widths[1], alignment: .leading)
            column(.value, "Valore vero").frame(maxWidth: .infinity, alignment: .leading)
            column(nil, "Clienti").frame(width: DictionaryRow.widths[2], alignment: .leading)
            column(.lastUsed, "Ultimo uso").frame(width: DictionaryRow.widths[3], alignment: .leading)
        }
        .background(Tema.bg)
        .overlay(alignment: .bottom) { Rectangle().fill(Tema.border).frame(height: 1) }
    }

    private func column(_ field: EntryComparator.Field?, _ title: String) -> some View {
        Button {
            guard let field else { return }
            sortOrder = sortOrder.field == field ? EntryComparator(field: field, order: sortOrder.order == .forward ? .reverse : .forward)
                : EntryComparator(field: field)
        } label: {
            HStack(spacing: 4) {
                Text(title)
                if let field, sortOrder.field == field {
                    Image(systemName: sortOrder.order == .forward ? "chevron.up" : "chevron.down").font(.system(size: 9, weight: .semibold))
                }
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Tema.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    /// Clic: una riga; ⌘: aggiunge o toglie; ⇧: dall'ultima cliccata a questa.
    private func select(_ id: String, in rows: [VaultEntry]) {
        let flags = NSEvent.modifierFlags
        if flags.contains(.shift), let anchor, let from = rows.firstIndex(where: { $0.id == anchor }),
           let to = rows.firstIndex(where: { $0.id == id }) {
            selection = Set(rows[min(from, to)...max(from, to)].map(\.id))
            return
        }
        if flags.contains(.command) {
            if selection.contains(id) { selection.remove(id) } else { selection.insert(id) }
        } else {
            selection = [id]
        }
        anchor = id
    }

    @ViewBuilder private func menu(for entry: VaultEntry) -> some View {
        // Il clic destro fuori dalla selezione vale per la riga cliccata.
        let ids = selection.contains(entry.id) ? selection : [entry.id]
        if ids.count == 1 {
            Button("Copia segnaposto") { copy(entry.placeholder) }
            Button("Copia valore vero") { copy(entry.value) }
            Divider()
        }
        Button("Elimina…", role: .destructive) {
            selection = ids
            confirmingRemoval = true
        }
    }

    private var footer: some View {
        BottomBar {
            Image(systemName: "lock")
            if case .ready(let protection) = model.vaultState {
                Text("Cifrato sul Mac · chiave custodita da: \(protection.description)").lineLimit(1)
            } else {
                Text("Dizionario non aperto")
            }
            Spacer()
            Button("Mostra nel Finder") { model.showVaultInFinder() }
                .buttonStyle(.accentLink)
        }
        .foregroundStyle(Tema.secondary)
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

/// Una riga del dizionario: linea sotto, passaggio del mouse, selezione arancio tenue.
private struct DictionaryRow: View {
    let entry: VaultEntry
    let clients: String
    let showValues: Bool
    let isSelected: Bool
    @State private var hovering = false

    /// Segnaposto, categoria, clienti, ultimo uso (il valore prende il resto).
    static let widths: [CGFloat] = [170, 140, 170, 160]

    var body: some View {
        HStack(spacing: 0) {
            cell(Text(entry.placeholder).font(.system(size: 13, design: .monospaced))).frame(width: Self.widths[0], alignment: .leading)
            cell(Text(PIICategory.name(entry.label, count: 1).capitalizedFirst)).frame(width: Self.widths[1], alignment: .leading)
            cell(Text(showValues ? entry.value : "••••••••").foregroundStyle(showValues ? Tema.text : Tema.tertiary))
                .frame(maxWidth: .infinity, alignment: .leading)
            cell(Text(clients).foregroundStyle(Tema.secondary)).help(clients).frame(width: Self.widths[2], alignment: .leading)
            cell(Text(Format.dateTime(entry.lastUsed)).foregroundStyle(Tema.secondary)).frame(width: Self.widths[3], alignment: .leading)
        }
        .font(Tema.body)
        .foregroundStyle(Tema.text)
        .background(isSelected ? Tema.accentSoft : hovering ? Tema.hover : .clear)
        .overlay(alignment: .bottom) { Rectangle().fill(Tema.border).frame(height: 1) }
        .contentShape(.rect)
        .onHover { hovering = $0 }
    }

    private func cell(_ text: some View) -> some View {
        text.lineLimit(1).truncationMode(.tail).padding(.horizontal, 10).padding(.vertical, 7)
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
