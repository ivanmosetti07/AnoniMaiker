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
        Group {
            if let company = model.crm.company(companyID) {
                content(company)
            } else {
                VStack(spacing: 0) {
                    TopBar(title: "", leading: { CRMBackButton() }, actions: { EmptyView() })
                    EmptyState("Cliente non trovato", symbol: "building.2")
                }
            }
        }
        .background(Tema.bg)
        .navigationBarBackButtonHidden(true)
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
            TopBar(title: company.name, leading: { CRMBackButton() }) {
                Button { showingDossier = true } label: { BarIcon(title: "Scheda anonimizzata", symbol: "eye.slash") }
                    .buttonStyle(.plainIcon)
                    .help("Scheda anonimizzata: il cliente in un testo anonimizzato, pronto per l'AI")
                    .disabled(model.engineState == .missing || !model.isVaultReady)
                BarMenu(title: "Aggiungi", symbol: "plus") {
                    Button("Contatto…") { editingContact = Contact(companyID: company.id) }
                    Button("Documenti…") { Task { await model.chooseDocuments(for: company.id) } }
                    Button("Nota o attività…") { editingActivity = Activity(companyID: company.id) }
                    Button("Trattativa…") { editingDeal = Deal(companyID: company.id) }
                }
                Button { editingCompany = company } label: { BarIcon(title: "Modifica", symbol: "pencil") }
                    .buttonStyle(.plainIcon)
                    .help("Modifica")
                Button { confirmingDeletion = true } label: { BarIcon(title: "Elimina…", symbol: "trash") }
                    .buttonStyle(.plainIcon)
                    .help("Elimina…")
            }
            CompanyHeader(company: company)
            AccentSegmented(selection: $tab, options: Tab.allCases.map { (value: $0, title: title(of: $0)) })
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.bottom, 12)
            Rectangle().fill(Tema.border).frame(height: 1)
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
        .sheet(item: $editingCompany) { CompanyEditor(company: $0) }
        .sheet(item: $editingContact) { ContactEditor(contact: $0) }
        .sheet(item: $editingDeal) { DealEditor(deal: $0) }
        .sheet(item: $editingActivity) { ActivityEditor(activity: $0) }
        .sheet(isPresented: $showingDossier) { DossierSheet(companyID: company.id) }
        .confirmationDialog("Togliere \(company.name) dal CRM?", isPresented: $confirmingDeletion, titleVisibility: .visible) {
            Button("Togli l'azienda", role: .destructive) { Task { await model.deleteCompany(company.id) } }
        } message: {
            Text("Persone, trattative, attività e documenti restano nel progetto, senza questa azienda. Il dizionario non cambia.")
        }
        #if DEBUG
        .onChange(of: ProvaComandi.shared.chiudi) {
            editingCompany = nil
            editingContact = nil
            editingDeal = nil
            editingActivity = nil
            showingDossier = false
        }
        .onChange(of: ProvaComandi.shared.scheda) { _, value in
            guard let value else { return }
            tab = Tab(rawValue: value) ?? tab
            ProvaComandi.shared.scheda = nil
        }
        .onChange(of: ProvaComandi.shared.editor) { _, value in
            guard let value else { return }
            ProvaComandi.shared.editor = nil
            switch value {
            case "azienda": editingCompany = company
            case "contatto":
                let contacts = model.crm.contacts(of: company.id)
                editingContact = contacts.first { $0.firstName == "Giulia" } ?? contacts.first ?? Contact(companyID: company.id)
            case "trattativa":
                let deals = model.crm.deals(of: company.id)
                editingDeal = deals.first { $0.stage.isOpen } ?? deals.first ?? Deal(companyID: company.id)
            case "attivita": editingActivity = model.crm.activities(of: company.id).first { $0.kind == .task && !$0.isDone } ?? Activity(companyID: company.id)
            case "dossier": showingDossier = true
            default: break
            }
        }
        #endif
    }
}

/// In cima alla scheda: nome, stato e numeri dell'azienda.
private struct CompanyHeader: View {
    @Environment(AppModel.self) private var model
    let company: Company

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: "building.2")
                .font(.system(size: 22))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background {
                    // Dal colore schiarito di un quinto al colore pieno, come il gradiente di Windows.
                    RoundedRectangle(cornerRadius: 11)
                        .fill(LinearGradient(colors: [company.status.color.mix(with: .white, by: 0.2), company.status.color],
                                             startPoint: .top, endPoint: .bottom))
                }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(company.name).font(Tema.title).lineLimit(1)
                    Badge(text: company.status.title, color: company.status.color)
                }
                Text([company.sector, company.city, company.vatNumber.isEmpty ? "" : "P.IVA \(company.vatNumber)"]
                    .filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(Tema.body)
                    .foregroundStyle(Tema.secondary)
                    .lineLimit(1)
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
        CRMFigure(value: value, label: label, alignment: .trailing).padding(.leading, 16)
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
                    TitledCard(title: "Anagrafica", symbol: "building.2") { details }
                    TitledCard(title: "Contatti", symbol: "person.2") { contacts }
                }
                if !company.notes.isEmpty {
                    TitledCard(title: "Note", symbol: "note.text") {
                        Text(company.notes).font(Tema.body).textSelection(.enabled)
                    }
                }
                TitledCard(title: "Privacy", symbol: "lock.shield") {
                    HStack(spacing: 12) {
                        Text("\(model.vault.entries(of: company.id).count) dati di questo cliente sono nel dizionario: nei testi anonimizzati diventano segnaposto e tornano veri riconvertendo.")
                            .font(Tema.body)
                            .foregroundStyle(Tema.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button("Mostra nel dizionario") { model.showDictionary(of: company.id) }
                            .buttonStyle(.flat)
                    }
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
            Text("Nessun dato: aggiungili con Modifica.").font(Tema.body).foregroundStyle(Tema.secondary)
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
                Text("Nessun contatto.").font(Tema.body).foregroundStyle(Tema.secondary)
            }
            ForEach(contacts) { contact in
                Button { editContact(contact) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(contact.fullName).font(Tema.headline).foregroundStyle(Tema.text)
                            if !contact.role.isEmpty { Text(contact.role).font(Tema.body).foregroundStyle(Tema.secondary) }
                        }
                        Text([contact.email, contact.mobile.isEmpty ? contact.phone : contact.mobile].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(Tema.caption)
                            .foregroundStyle(Tema.secondary)
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
            Button { editContact(Contact(companyID: company.id)) } label: {
                Label("Nuovo contatto", systemImage: "plus").font(Tema.body)
            }
            .buttonStyle(.accentLink)
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
        VStack(spacing: 0) {
            if documents.isEmpty {
                EmptyState(title: "Nessun documento", symbol: "doc.text",
                           message: "Trascina qui i file del cliente (testo, Markdown, CSV, Excel, Word, PDF), o aggiungili con il pulsante. Restano cifrati su questo Mac; da qui li anonimizzi e riconverti le risposte dell'AI.") {
                    Button("Aggiungi documenti…") { Task { await model.chooseDocuments(for: company.id) } }
                        .buttonStyle(.flat)
                }
            } else {
                FlatList {
                    ForEach(documents) { document in
                        DocumentRow(document: document)
                            .flatRow()
                            .onTapGesture { model.companiesPath.append(.document(document.id)) }
                            .contextMenu {
                                Button("Anonimizza") { Task { await model.anonymizeDocument(document.id) } }
                                    .disabled(model.engineState == .missing)
                                Divider()
                                Button("Elimina", role: .destructive) { Task { await model.deleteDocument(document.id) } }
                            }
                    }
                }
                BottomBar {
                    Text("Trascina qui altri file: testo, CSV, Excel, Word, PDF").font(Tema.caption).foregroundStyle(Tema.secondary)
                    Spacer()
                    Button { Task { await model.chooseDocuments(for: company.id) } } label: {
                        Label("Aggiungi documenti…", systemImage: "doc.badge.plus")
                    }
                    .buttonStyle(.flat)
                }
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            Task { await model.addDocuments(urls, to: company.id) }
            return true
        } isTargeted: { isTargeted = $0 }
        .overlay { if isTargeted { DropOutline(inset: 8, radius: 12) } }
    }
}

/// Un documento in elenco: icona del formato, titolo semibold, stato.
struct DocumentRow: View {
    @Environment(AppModel.self) private var model
    let document: CRMDocument

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: document.format.symbol)
                .font(.system(size: 20))
                .foregroundStyle(Tema.secondary)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(document.title).font(Tema.headline).foregroundStyle(Tema.text).lineLimit(1)
                Text([document.format.title, document.original?.fileName ?? "", Format.date(document.created)].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(Tema.caption)
                    .foregroundStyle(Tema.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if model.busyDocuments.contains(document.id) {
                ProgressView().controlSize(.small)
            } else if document.anonymized != nil {
                Badge(text: "Anonimizzato", color: Tema.green)
            } else {
                Badge(text: "Da anonimizzare", color: Tema.orange)
            }
            if !document.answers.isEmpty {
                Badge(text: document.answers.count == 1 ? "1 versione AI" : "\(document.answers.count) versioni AI", color: Tema.indigo)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
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
                FieldMenu(selection: $kind, options: ActivityKind.allCases.map { (value: $0, title: $0.title) }, width: 140)
                    .help("Tipo")
                TextField("", text: $text, prompt: Text(kind == .task ? "Cosa c'è da fare?" : "Scrivi una nota, l'esito di una chiamata, una riunione…"))
                    .styledField()
                    .onSubmit(add)
                Button("Aggiungi", action: add)
                    .buttonStyle(.flat)
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(12)
            Rectangle().fill(Tema.border).frame(height: 1)
            if activities.isEmpty {
                EmptyState("Nessuna nota o attività", symbol: "note.text",
                           message: "Scrivi qui sopra: chiamate, riunioni, cose da fare. Entrano anche nella scheda anonimizzata.")
            } else {
                FlatList {
                    ForEach(activities) { activity in
                        ActivityRow(activity: activity)
                            .flatRow()
                            .onTapGesture(count: 2) { edit(activity) }
                            .contextMenu {
                                Button("Modifica…") { edit(activity) }
                                Button("Elimina", role: .destructive) { Task { await model.deleteActivity(activity.id) } }
                            }
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
        VStack(spacing: 0) {
            if deals.isEmpty {
                EmptyState(title: "Nessuna trattativa", symbol: "eurosign.circle",
                           message: "Preventivi e opportunità del cliente, con importo, fase e probabilità.") {
                    Button("Nuova trattativa") { edit(Deal(companyID: company.id)) }
                        .buttonStyle(.flat)
                }
            } else {
                FlatList {
                    ForEach(deals) { deal in
                        DealRow(deal: deal)
                            .flatRow()
                            .onTapGesture(count: 2) { edit(deal) }
                            .contextMenu {
                                Button("Modifica…") { edit(deal) }
                                Button("Elimina", role: .destructive) { Task { await model.deleteDeal(deal.id) } }
                            }
                    }
                }
                BottomBar {
                    Spacer()
                    Button { edit(Deal(companyID: company.id)) } label: { Label("Nuova trattativa", systemImage: "plus") }
                        .buttonStyle(.flat)
                }
            }
        }
    }
}
