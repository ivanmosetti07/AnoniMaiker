import AnonymizerKit
import SwiftUI

/// La scheda del cliente: anagrafica e contatti, documenti, note e attività, trattative.
struct CompanyDetailView: View {
    let companyID: UUID
    @Environment(AppModel.self) private var model
    @State private var tab = Tab.overview
    @State private var editingCompany: Company?
    @State private var editingContact: Contact?
    @State private var editingDeal: Deal?
    @State private var editingActivity: Activity?
    @State private var showingDossier = false
    @State private var confirmingDeletion = false

    enum Tab: String, CaseIterable, Identifiable {
        case overview, documents, activities, deals
        var id: String { rawValue }
    }

    var body: some View {
        if let company = model.crm.company(companyID) {
            content(company)
        } else {
            ContentUnavailableView("Cliente non trovato", systemImage: "building.2")
        }
    }

    private func title(of tab: Tab) -> String {
        switch tab {
        case .overview: "Panoramica"
        case .documents: "Documenti (\(model.crm.documents(of: companyID).count))"
        case .activities: "Note e attività (\(model.crm.activities(of: companyID).count))"
        case .deals: "Trattative (\(model.crm.deals(of: companyID).count))"
        }
    }

    private func content(_ company: Company) -> some View {
        VStack(spacing: 0) {
            CompanyHeader(company: company)
            Picker("Sezione", selection: $tab) {
                ForEach(Tab.allCases) { Text(title(of: $0)).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
            Divider()
            Group {
                switch tab {
                case .overview: OverviewTab(company: company, editContact: { editingContact = $0 })
                case .documents: DocumentsTab(company: company)
                case .activities: ActivitiesTab(company: company, edit: { editingActivity = $0 })
                case .deals: DealsTab(company: company, edit: { editingDeal = $0 })
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle(company.name)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button("Scheda anonimizzata", systemImage: "eye.slash") { showingDossier = true }
                    .help("Il cliente in un testo anonimizzato, pronto per l'AI")
                    .disabled(model.engineState == .missing || !model.isVaultReady)
                Menu("Aggiungi", systemImage: "plus") {
                    Button("Contatto…") { editingContact = Contact(companyID: company.id) }
                    Button("Documenti…") { Task { await model.chooseDocuments(for: company.id) } }
                    Button("Nota o attività…") { editingActivity = Activity(companyID: company.id) }
                    Button("Trattativa…") { editingDeal = Deal(companyID: company.id) }
                }
                Button("Modifica", systemImage: "pencil") { editingCompany = company }
                Button("Elimina…", systemImage: "trash") { confirmingDeletion = true }
            }
        }
        .sheet(item: $editingCompany) { CompanyEditor(company: $0) }
        .sheet(item: $editingContact) { ContactEditor(contact: $0) }
        .sheet(item: $editingDeal) { DealEditor(deal: $0) }
        .sheet(item: $editingActivity) { ActivityEditor(activity: $0) }
        .sheet(isPresented: $showingDossier) { DossierSheet(companyID: company.id) }
        .confirmationDialog("Eliminare \(company.name)?", isPresented: $confirmingDeletion, titleVisibility: .visible) {
            Button("Elimina, tieni i dati nel dizionario", role: .destructive) {
                Task { await model.deleteCompany(company.id, removeFromDictionary: false) }
            }
            Button("Elimina anche dal dizionario", role: .destructive) {
                Task { await model.deleteCompany(company.id, removeFromDictionary: true) }
            }
        } message: {
            let counts = model.crm.removalCounts(of: company.id)
            Text("Se ne vanno anche \(counts.contacts) contatti, \(counts.deals) trattative, \(counts.activities) note e attività e \(counts.documents) documenti. "
                 + "Togliendo i suoi dati dal dizionario, i file anonimizzati di questo cliente non si potranno più riconvertire.")
        }
    }
}

/// In cima alla scheda: nome, stato e numeri del cliente.
private struct CompanyHeader: View {
    @Environment(AppModel.self) private var model
    let company: Company

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: "building.2.fill")
                .font(.system(size: 22))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(company.status.color.gradient, in: RoundedRectangle(cornerRadius: 11))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(company.name).font(.title2.weight(.semibold))
                    Badge(text: company.status.title, color: company.status.color)
                }
                Text([company.sector, company.city, company.vatNumber.isEmpty ? "" : "P.IVA \(company.vatNumber)"]
                    .filter { !$0.isEmpty }.joined(separator: " · "))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            stat("\(model.crm.contacts(of: company.id).count)", "contatti")
            stat(Format.amount(openAmount), "in trattativa")
            stat("\(model.vault.entries(of: company.id).count)", "voci nel dizionario")
        }
        .padding(20)
    }

    private var openAmount: Decimal? {
        let amounts = model.crm.deals(of: company.id).filter(\.stage.isOpen).compactMap(\.amount)
        return amounts.isEmpty ? nil : amounts.reduce(0, +)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(value).font(.title3.weight(.semibold)).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.leading, 16)
    }
}

// MARK: - Panoramica

private struct OverviewTab: View {
    @Environment(AppModel.self) private var model
    let company: Company
    let editContact: (Contact) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top, spacing: 18) {
                    GroupBox {
                        details.frame(maxWidth: .infinity, alignment: .leading).padding(6)
                    } label: {
                        Label("Anagrafica", systemImage: "building.2")
                    }
                    GroupBox {
                        contacts.frame(maxWidth: .infinity, alignment: .leading).padding(6)
                    } label: {
                        Label("Contatti", systemImage: "person.2")
                    }
                }
                if !company.notes.isEmpty {
                    GroupBox {
                        Text(company.notes).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(6)
                    } label: {
                        Label("Note", systemImage: "note.text")
                    }
                }
                GroupBox {
                    HStack {
                        Text("\(model.vault.entries(of: company.id).count) dati di questo cliente sono nel dizionario: nei testi anonimizzati diventano segnaposto e tornano veri riconvertendo.")
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Mostra nel dizionario") { model.showDictionary(of: company.id) }
                    }
                    .padding(6)
                } label: {
                    Label("Privacy", systemImage: "lock.shield")
                }
            }
            .padding(20)
        }
    }

    @ViewBuilder private var details: some View {
        let rows: [(String, String, Bool?)] = [
            ("Partita IVA", company.vatNumber, company.vatNumber.isEmpty ? nil : Validators.isValidVATNumber(company.vatNumber)),
            ("Codice fiscale", company.taxCode, company.taxCode.isEmpty ? nil : Validators.isValidTaxCode(company.taxCode)),
            ("Sede", company.address, nil),
            ("Email", company.email, nil),
            ("PEC", company.pec, nil),
            ("Telefono", company.phone, nil),
            ("Sito", company.website, nil),
            ("IBAN", company.iban, company.iban.isEmpty ? nil : Validators.isValidIBAN(company.iban)),
        ].filter { !$0.1.isEmpty }
        if rows.isEmpty {
            Text("Nessun dato: aggiungili con Modifica.").foregroundStyle(.secondary)
        } else {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 7) {
                ForEach(rows, id: \.0) { row in DetailRow(title: row.0, value: row.1, valid: row.2) }
            }
        }
    }

    @ViewBuilder private var contacts: some View {
        let contacts = model.crm.contacts(of: company.id)
        VStack(alignment: .leading, spacing: 10) {
            if contacts.isEmpty {
                Text("Nessun contatto.").foregroundStyle(.secondary)
            }
            ForEach(contacts) { contact in
                Button { editContact(contact) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(contact.fullName).fontWeight(.medium)
                            if !contact.role.isEmpty { Text(contact.role).foregroundStyle(.secondary) }
                        }
                        Text([contact.email, contact.mobile.isEmpty ? contact.phone : contact.mobile].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button("Modifica…") { editContact(contact) }
                    Button("Elimina", role: .destructive) { Task { await model.deleteContact(contact.id) } }
                }
            }
            Button("Nuovo contatto", systemImage: "plus") { editContact(Contact(companyID: company.id)) }
                .buttonStyle(.link)
        }
    }
}

// MARK: - Documenti

private struct DocumentsTab: View {
    @Environment(AppModel.self) private var model
    let company: Company
    @State private var isTargeted = false

    var body: some View {
        let documents = model.crm.documents(of: company.id)
        Group {
            if documents.isEmpty {
                ContentUnavailableView {
                    Label("Nessun documento", systemImage: "doc.text")
                } description: {
                    Text("Trascina qui i file del cliente (testo, Markdown, CSV, Excel, Word, PDF), o aggiungili con il pulsante. Restano cifrati su questo Mac; da qui li anonimizzi e riconverti le risposte dell'AI.")
                } actions: {
                    Button("Aggiungi documenti…") { Task { await model.chooseDocuments(for: company.id) } }
                }
            } else {
                List(documents) { document in
                    NavigationLink(value: CRMRoute.document(document.id)) {
                        DocumentRow(document: document)
                    }
                    .contextMenu {
                        Button("Anonimizza") { Task { await model.anonymizeDocument(document.id) } }
                            .disabled(model.engineState == .missing)
                        Divider()
                        Button("Elimina", role: .destructive) { Task { await model.deleteDocument(document.id) } }
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    HStack {
                        Text("Trascina qui altri file: testo, CSV, Excel, Word, PDF").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Aggiungi documenti…", systemImage: "doc.badge.plus") { Task { await model.chooseDocuments(for: company.id) } }
                    }
                    .padding(10)
                    .background(.bar)
                }
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            Task { await model.addDocuments(urls, to: company.id) }
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

struct DocumentRow: View {
    @Environment(AppModel.self) private var model
    let document: CRMDocument

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: document.format.symbol)
                .font(.title2)
                .foregroundStyle(.secondary)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(document.title).fontWeight(.medium)
                Text([document.format.title, document.original?.fileName ?? "", Format.date(document.created)].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if model.busyDocuments.contains(document.id) {
                ProgressView().controlSize(.small)
            } else if document.anonymized != nil {
                Badge(text: "Anonimizzato", color: .green)
            } else {
                Badge(text: "Da anonimizzare", color: .orange)
            }
            if !document.answers.isEmpty {
                Badge(text: document.answers.count == 1 ? "1 risposta" : "\(document.answers.count) risposte", color: .indigo)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Note e attività

private struct ActivitiesTab: View {
    @Environment(AppModel.self) private var model
    let company: Company
    let edit: (Activity) -> Void
    @State private var kind = ActivityKind.note
    @State private var text = ""

    var body: some View {
        let activities = model.crm.activities(of: company.id)
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Picker("Tipo", selection: $kind) {
                    ForEach(ActivityKind.allCases) { Label($0.title, systemImage: $0.symbol).tag($0) }
                }
                .labelsHidden()
                .frame(width: 140)
                TextField(kind == .task ? "Cosa c'è da fare?" : "Scrivi una nota, l'esito di una chiamata, una riunione…", text: $text)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(add)
                Button("Aggiungi", action: add)
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(12)
            Divider()
            if activities.isEmpty {
                ContentUnavailableView("Nessuna nota o attività", systemImage: "note.text",
                                       description: Text("Scrivi qui sopra: chiamate, riunioni, cose da fare. Entrano anche nella scheda anonimizzata."))
            } else {
                List(activities) { activity in
                    ActivityRow(activity: activity)
                        .onTapGesture(count: 2) { edit(activity) }
                        .contextMenu {
                            Button("Modifica…") { edit(activity) }
                            Button("Elimina", role: .destructive) { Task { await model.deleteActivity(activity.id) } }
                        }
                }
            }
        }
    }

    private func add() {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        var activity = Activity(kind: kind, text: value, companyID: company.id)
        if kind == .task { activity.due = Calendar.current.date(byAdding: .day, value: 1, to: .now) }
        text = ""
        Task { await model.save(activity) }
    }
}

// MARK: - Trattative

private struct DealsTab: View {
    @Environment(AppModel.self) private var model
    let company: Company
    let edit: (Deal) -> Void

    var body: some View {
        let deals = model.crm.deals(of: company.id)
        Group {
            if deals.isEmpty {
                ContentUnavailableView {
                    Label("Nessuna trattativa", systemImage: "eurosign.circle")
                } description: {
                    Text("Preventivi e opportunità del cliente, con importo, fase e probabilità.")
                } actions: {
                    Button("Nuova trattativa") { edit(Deal(companyID: company.id)) }
                }
            } else {
                List(deals) { deal in
                    DealRow(deal: deal)
                        .onTapGesture(count: 2) { edit(deal) }
                        .contextMenu {
                            Button("Modifica…") { edit(deal) }
                            Button("Elimina", role: .destructive) { Task { await model.deleteDeal(deal.id) } }
                        }
                }
                .safeAreaInset(edge: .bottom) {
                    HStack {
                        Spacer()
                        Button("Nuova trattativa", systemImage: "plus") { edit(Deal(companyID: company.id)) }
                    }
                    .padding(10)
                    .background(.bar)
                }
            }
        }
    }
}
