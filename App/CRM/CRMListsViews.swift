import AnonymizerKit
import SwiftUI

// MARK: - Persone, trattative e attività del progetto

struct ContactsView: View {
    @Environment(AppModel.self) private var model
    @State private var search = ""
    @State private var selection: UUID?
    @State private var editing: Contact?

    private var contacts: [Contact] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        return model.crm.contacts
            .filter { contact in
                query.isEmpty || [contact.fullName, contact.email, contact.role, model.crm.company(contact.companyID)?.name ?? ""]
                    .contains { $0.lowercased().contains(query) }
            }
            .sorted { $0.fullName.localizedStandardCompare($1.fullName) == .orderedAscending }
    }

    var body: some View {
        VStack(spacing: 0) {
            TopBar(title: "Persone", subtitle: model.crm.contacts.isEmpty ? "" : "\(model.crm.contacts.count)") {
                SearchField(text: $search, prompt: "Cerca nome, email, ruolo o azienda", width: 280)
                Button { editing = Contact() } label: { BarIcon(title: "Nuova persona", symbol: "plus") }
                    .buttonStyle(.plainIcon)
                    .help("Nuova persona")
                    .disabled(!model.isVaultReady)
            }
            if model.crm.contacts.isEmpty {
                EmptyState(title: "Nessuna persona", symbol: "person.2",
                           message: "Le persone trovate nei documenti del progetto arrivano qui da sole, con email e telefoni. Il CRM le conosce, quindi si nascondono anche dove il motore non le vede.") {
                    Button("Nuova persona") { editing = Contact() }
                        .buttonStyle(.flat)
                }
                .background(Tema.bg)
            } else {
                table
            }
        }
        .sheet(item: $editing) { ContactEditor(contact: $0) }
    }

    private var table: some View {
        // Il nome largo il 22%, le altre colonne si dividono il resto (come la tabella di Windows).
        GeometryReader { proxy in
            let name = proxy.size.width * 0.22
            let other = (proxy.size.width - name) / 4
            VStack(spacing: 0) {
                FlatTableHeader(columns: [("Nome", name), ("Ruolo", other), ("Azienda", other), ("Email", other), ("Telefono", other)])
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(contacts) { contact in
                            FlatTableRow(isSelected: selection == contact.id,
                                         select: { selection = contact.id },
                                         open: { editing = contact }) {
                                FlatCell(width: name) { Text(contact.fullName).font(Tema.headline) }
                                FlatCell(width: other) { Text(contact.role) }
                                FlatCell(width: other) { Text(model.crm.company(contact.companyID)?.name ?? "—") }
                                FlatCell(width: other) { Text(contact.email).textSelection(.enabled) }
                                FlatCell(width: other) { Text(contact.mobile.isEmpty ? contact.phone : contact.mobile).monospacedDigit() }
                            }
                            .contextMenu {
                                Button("Modifica…") { editing = contact }
                                if let companyID = contact.companyID {
                                    Button("Apri l'azienda") { model.openCompany(companyID) }
                                }
                                Divider()
                                Button("Elimina", role: .destructive) { Task { await model.deleteContact(contact.id) } }
                            }
                        }
                    }
                }
            }
        }
        .surfaceBackground()
    }
}

struct DealsView: View {
    @Environment(AppModel.self) private var model
    @State private var filter = Filter.open
    @State private var editing: Deal?

    enum Filter: String, CaseIterable, Identifiable {
        case open, won, lost, all
        var id: String { rawValue }
        var title: String {
            switch self {
            case .open: "Aperte"
            case .won: "Vinte"
            case .lost: "Perse"
            case .all: "Tutte"
            }
        }
    }

    private var deals: [Deal] {
        model.crm.deals.filter { deal in
            switch filter {
            case .open: deal.stage.isOpen
            case .won: deal.stage == .won
            case .lost: deal.stage == .lost
            case .all: true
            }
        }
        .sorted { ($0.expectedClose ?? .distantFuture, $1.updated) < ($1.expectedClose ?? .distantFuture, $0.updated) }
    }

    private var summary: (open: Decimal, weighted: Decimal, won: Decimal) {
        let open = model.crm.deals.filter(\.stage.isOpen)
        return (open.compactMap(\.amount).reduce(0, +), open.compactMap(\.weightedAmount).reduce(0, +),
                model.crm.deals.filter { $0.stage == .won }.compactMap(\.amount).reduce(0, +))
    }

    var body: some View {
        VStack(spacing: 0) {
            TopBar(title: "Trattative") {
                Button { editing = Deal() } label: { BarIcon(title: "Nuova trattativa", symbol: "plus") }
                    .buttonStyle(.plainIcon)
                    .help("Nuova trattativa")
                    .disabled(!model.isVaultReady)
            }
            HStack(spacing: 28) {
                CRMFigure(value: Format.amount(summary.open), label: "in trattative aperte")
                CRMFigure(value: Format.amount(summary.weighted), label: "pesato con la probabilità")
                CRMFigure(value: Format.amount(summary.won), label: "vinto")
                Spacer()
                AccentSegmented(selection: $filter, options: Filter.allCases.map { (value: $0, title: $0.title) })
            }
            .padding(16)
            .background(Tema.bg)
            Rectangle().fill(Tema.border).frame(height: 1)
            if deals.isEmpty {
                EmptyState(filter == .open ? "Nessuna trattativa aperta" : "Nessuna trattativa", symbol: "eurosign.circle",
                           message: model.crm.companies.isEmpty ? "Le opportunità e i preventivi del progetto, con importo, fase e probabilità." : "Preventivi e opportunità dei tuoi clienti.")
                    .background(Tema.bg)
            } else {
                FlatList {
                    ForEach(deals) { deal in
                        DealRow(deal: deal, showCompany: true)
                            .flatRow()
                            .onTapGesture(count: 2) { editing = deal }
                            .contextMenu {
                                Button("Modifica…") { editing = deal }
                                Button("Apri l'azienda") { model.openCompany(deal.companyID) }
                                    .disabled(deal.companyID == nil)
                                Divider()
                                Button("Elimina", role: .destructive) { Task { await model.deleteDeal(deal.id) } }
                            }
                    }
                }
            }
        }
        .sheet(item: $editing) { DealEditor(deal: $0) }
        #if DEBUG
        .onChange(of: ProvaComandi.shared.filtro) { _, value in
            guard value != nil else { return }
            filter = .all
            ProvaComandi.shared.filtro = nil
        }
        #endif
    }
}

struct ActivitiesView: View {
    @Environment(AppModel.self) private var model
    @State private var showAll = false
    @State private var editing: Activity?

    private var activities: [Activity] {
        showAll ? model.crm.activities.sorted { $0.date > $1.date } : model.crm.openTasks
    }

    var body: some View {
        VStack(spacing: 0) {
            TopBar(title: "Attività", subtitle: showAll ? "Tutte" : "Da fare") {
                AccentSegmented(selection: $showAll, options: [(value: false, title: "Da fare"), (value: true, title: "Tutte")])
                Button { editing = Activity(kind: .task) } label: { BarIcon(title: "Nuova attività", symbol: "plus") }
                    .buttonStyle(.plainIcon)
                    .help("Nuova attività")
                    .disabled(!model.isVaultReady)
                    .padding(.leading, 6)
            }
            if activities.isEmpty {
                EmptyState(showAll ? "Nessuna nota o attività" : "Niente da fare", symbol: showAll ? "note.text" : "checkmark.circle",
                           message: showAll ? "Note, chiamate, riunioni e cose da fare dei tuoi clienti."
                               : "Le cose da fare di tutti i clienti compaiono qui, dalla scadenza più vicina.")
                    .background(Tema.bg)
            } else {
                FlatList {
                    ForEach(activities) { activity in
                        ActivityRow(activity: activity, showCompany: true)
                            .flatRow()
                            .onTapGesture(count: 2) { editing = activity }
                            .contextMenu {
                                Button("Modifica…") { editing = activity }
                                if let companyID = activity.companyID {
                                    Button("Apri l'azienda") { model.openCompany(companyID) }
                                }
                                Divider()
                                Button("Elimina", role: .destructive) { Task { await model.deleteActivity(activity.id) } }
                            }
                    }
                }
            }
        }
        .sheet(item: $editing) { ActivityEditor(activity: $0) }
        #if DEBUG
        .onChange(of: ProvaComandi.shared.filtro) { _, value in
            guard value != nil else { return }
            showAll = true
            ProvaComandi.shared.filtro = nil
        }
        #endif
    }
}
