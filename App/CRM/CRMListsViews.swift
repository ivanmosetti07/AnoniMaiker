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
        Group {
            if model.crm.contacts.isEmpty {
                ContentUnavailableView {
                    Label("Nessuna persona", systemImage: "person.2")
                } description: {
                    Text("Le persone trovate nei documenti del progetto arrivano qui da sole, con email e telefoni. Il CRM le conosce, quindi si nascondono anche dove il motore non le vede.")
                } actions: {
                    Button("Nuova persona") { editing = Contact() }
                }
            } else {
                Table(contacts, selection: $selection) {
                    TableColumn("Nome") { contact in Text(contact.fullName).fontWeight(.medium) }
                        .width(min: 140, ideal: 180)
                    TableColumn("Ruolo") { contact in Text(contact.role) }
                    TableColumn("Azienda") { contact in Text(model.crm.company(contact.companyID)?.name ?? "—") }
                    TableColumn("Email") { contact in Text(contact.email).textSelection(.enabled) }
                    TableColumn("Telefono") { contact in Text(contact.mobile.isEmpty ? contact.phone : contact.mobile).monospacedDigit() }
                }
                .contextMenu(forSelectionType: UUID.self) { ids in
                    if let id = ids.first, let contact = model.crm.contact(id) {
                        Button("Modifica…") { editing = contact }
                        if let companyID = contact.companyID {
                            Button("Apri l'azienda") { model.openCompany(companyID) }
                        }
                        Divider()
                        Button("Elimina", role: .destructive) { Task { await model.deleteContact(id) } }
                    }
                } primaryAction: { ids in
                    if let id = ids.first { editing = model.crm.contact(id) }
                }
            }
        }
        .navigationTitle("Persone")
        .navigationSubtitle(model.crm.contacts.isEmpty ? "" : "\(model.crm.contacts.count)")
        .searchable(text: $search, prompt: "Cerca nome, email, ruolo o azienda")
        .toolbar {
            Button("Nuova persona", systemImage: "plus") { editing = Contact() }
                .disabled(!model.isVaultReady)
        }
        .sheet(item: $editing) { ContactEditor(contact: $0) }
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
            HStack(spacing: 28) {
                figure(Format.amount(summary.open), "in trattative aperte")
                figure(Format.amount(summary.weighted), "pesato con la probabilità")
                figure(Format.amount(summary.won), "vinto")
                Spacer()
                Picker("Mostra", selection: $filter) {
                    ForEach(Filter.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 300)
            }
            .padding(16)
            Divider()
            if deals.isEmpty {
                ContentUnavailableView {
                    Label(filter == .open ? "Nessuna trattativa aperta" : "Nessuna trattativa", systemImage: "eurosign.circle")
                } description: {
                    Text(model.crm.companies.isEmpty ? "Le opportunità e i preventivi del progetto, con importo, fase e probabilità." : "Preventivi e opportunità dei tuoi clienti.")
                }
                .frame(maxHeight: .infinity)
            } else {
                List(deals) { deal in
                    DealRow(deal: deal, showCompany: true)
                        .onTapGesture(count: 2) { editing = deal }
                        .contextMenu {
                            Button("Modifica…") { editing = deal }
                            Button("Apri l'azienda") { model.openCompany(deal.companyID) }
                            Divider()
                            Button("Elimina", role: .destructive) { Task { await model.deleteDeal(deal.id) } }
                        }
                }
            }
        }
        .navigationTitle("Trattative")
        .toolbar {
            Button("Nuova trattativa", systemImage: "plus") {
                editing = Deal()
            }
            .disabled(!model.isVaultReady)
            .help(model.crm.companies.isEmpty ? "Nuova trattativa" : "Nuova trattativa")
        }
        .sheet(item: $editing) { DealEditor(deal: $0) }
    }

    private func figure(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title3.weight(.semibold)).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
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
        Group {
            if activities.isEmpty {
                ContentUnavailableView(showAll ? "Nessuna nota o attività" : "Niente da fare",
                                       systemImage: showAll ? "note.text" : "checkmark.circle",
                                       description: Text(showAll ? "Note, chiamate, riunioni e cose da fare dei tuoi clienti."
                                                         : "Le cose da fare di tutti i clienti compaiono qui, dalla scadenza più vicina."))
            } else {
                List(activities) { activity in
                    ActivityRow(activity: activity, showCompany: true)
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
        .navigationTitle("Attività")
        .navigationSubtitle(showAll ? "Tutte" : "Da fare")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Picker("Mostra", selection: $showAll) {
                    Text("Da fare").tag(false)
                    Text("Tutte").tag(true)
                }
                .pickerStyle(.segmented)
                Button("Nuova attività", systemImage: "plus") { editing = Activity(kind: .task) }
                    .disabled(!model.isVaultReady)
            }
        }
        .sheet(item: $editing) { ActivityEditor(activity: $0) }
    }
}
