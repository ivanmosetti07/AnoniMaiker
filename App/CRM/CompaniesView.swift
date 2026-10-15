import AnonymizerKit
import SwiftUI

/// L'elenco delle aziende: un clic seleziona, doppio clic apre la scheda.
struct CompaniesView: View {
    @Environment(AppModel.self) private var model
    @State private var search = ""
    @State private var status: CompanyStatus?
    @State private var selection: UUID?
    @State private var editing: Company?

    private var companies: [Company] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        return model.crm.sortedCompanies.filter { company in
            (status == nil || company.status == status)
                && (query.isEmpty || [company.name, company.city, company.sector, company.vatNumber].contains { $0.lowercased().contains(query) })
        }
    }

    private func openAmount(_ company: Company) -> Decimal? {
        let amounts = model.crm.deals(of: company.id).filter(\.stage.isOpen).compactMap(\.amount)
        return amounts.isEmpty ? nil : amounts.reduce(0, +)
    }

    var body: some View {
        Group {
            if model.crm.companies.isEmpty {
                ContentUnavailableView {
                    Label("Nessuna azienda", systemImage: "building.2")
                } description: {
                    Text("Aggiungi il primo cliente: i suoi dati restano su questo Mac, cifrati, e dalla sua scheda ne anonimizzi i documenti.")
                } actions: {
                    Button("Nuova azienda") { editing = Company() }
                        .buttonStyle(.borderedProminent)
                }
            } else {
                Table(companies, selection: $selection) {
                    TableColumn("Azienda") { company in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(company.name).fontWeight(.medium)
                            if !company.sector.isEmpty { Text(company.sector).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                    .width(min: 200, ideal: 260)
                    TableColumn("Stato") { company in Badge(text: company.status.title, color: company.status.color) }
                        .width(min: 90, ideal: 110)
                    TableColumn("Città") { company in Text(company.city) }
                        .width(min: 80, ideal: 120)
                    TableColumn("Contatti") { company in Text("\(model.crm.contacts(of: company.id).count)").monospacedDigit() }
                        .width(min: 60, ideal: 70)
                    TableColumn("Trattative aperte") { company in Text(Format.amount(openAmount(company))).monospacedDigit() }
                        .width(min: 110, ideal: 130)
                    TableColumn("Documenti") { company in Text("\(model.crm.documents(of: company.id).count)").monospacedDigit() }
                        .width(min: 70, ideal: 80)
                }
                .contextMenu(forSelectionType: UUID.self) { ids in
                    if let id = ids.first, let company = model.crm.company(id) {
                        Button("Apri la scheda") { model.companiesPath.append(.company(id)) }
                        Button("Modifica…") { editing = company }
                    }
                } primaryAction: { ids in
                    if let id = ids.first { model.companiesPath.append(.company(id)) }
                }
            }
        }
        .navigationTitle("Aziende")
        .navigationSubtitle(model.crm.companies.isEmpty ? "" : "\(model.crm.companies.count)")
        .searchable(text: $search, prompt: "Cerca nome, città, settore o partita IVA")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Picker("Stato", selection: $status) {
                    Text("Tutte").tag(CompanyStatus?.none)
                    ForEach(CompanyStatus.allCases) { Text($0.title).tag(Optional($0)) }
                }
                .pickerStyle(.menu)
                .help("Filtra per stato")
                Button("Nuova azienda", systemImage: "plus") { editing = Company() }
                    .disabled(!model.isVaultReady)
            }
        }
        .sheet(item: $editing) { company in CompanyEditor(company: company) }
        // Dalla guida: «Aggiungi il primo cliente».
        .task(id: model.requestsNewCompany) {
            guard model.requestsNewCompany else { return }
            model.requestsNewCompany = false
            try? await Task.sleep(for: .milliseconds(400))
            editing = Company()
        }
    }
}
