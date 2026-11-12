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

    /// Le colonne, larghe come su Windows (la prima prende lo spazio che avanza).
    private static let columns: [(title: String, width: CGFloat?)] = [
        ("Azienda", nil), ("Stato", 120), ("Città", 130), ("Contatti", 80), ("Trattative aperte", 140), ("Documenti", 90),
    ]

    var body: some View {
        VStack(spacing: 0) {
            TopBar(title: "Aziende", subtitle: model.crm.companies.isEmpty ? "" : "\(model.crm.companies.count)") {
                SearchField(text: $search, prompt: "Cerca nome, città, settore o partita IVA", width: 280)
                FieldMenu(selection: $status, options: [(value: CompanyStatus?.none, title: "Tutte")]
                    + CompanyStatus.allCases.map { (value: Optional($0), title: $0.title) })
                    .fixedSize()
                    .help("Filtra per stato")
                    .padding(.leading, 6)
                Button { editing = Company() } label: { BarIcon(title: "Nuova azienda", symbol: "plus") }
                    .buttonStyle(.plainIcon)
                    .help("Nuova azienda")
                    .disabled(!model.isVaultReady)
            }
            if model.crm.companies.isEmpty {
                EmptyState(title: "Nessuna azienda", symbol: "building.2",
                           message: "Le aziende trovate nei documenti del progetto arrivano qui da sole. Puoi aggiungerne a mano: i dati restano su questo Mac, cifrati.") {
                    Button("Nuova azienda") { editing = Company() }
                        .buttonStyle(.primary)
                }
                .background(Tema.bg)
            } else {
                table
            }
        }
        .navigationBarBackButtonHidden(true)
        .sheet(item: $editing) { company in CompanyEditor(company: company) }
    }

    private var table: some View {
        let widths = Self.columns.map(\.width)
        return VStack(spacing: 0) {
            FlatTableHeader(columns: Self.columns)
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(companies) { company in
                        FlatTableRow(isSelected: selection == company.id,
                                     select: { selection = company.id },
                                     open: { model.companiesPath.append(.company(company.id)) }) {
                            FlatCell(width: widths[0]) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(company.name).font(Tema.headline)
                                    if !company.sector.isEmpty { Text(company.sector).font(Tema.caption).foregroundStyle(Tema.secondary) }
                                }
                            }
                            FlatCell(width: widths[1]) { Badge(text: company.status.title, color: company.status.color) }
                            FlatCell(width: widths[2]) { Text(company.city) }
                            FlatCell(width: widths[3]) { Text("\(model.crm.contacts(of: company.id).count)").monospacedDigit() }
                            FlatCell(width: widths[4]) { Text(Format.amount(openAmount(company))).monospacedDigit() }
                            FlatCell(width: widths[5]) { Text("\(model.crm.documents(of: company.id).count)").monospacedDigit() }
                        }
                        .contextMenu {
                            Button("Apri la scheda") { model.companiesPath.append(.company(company.id)) }
                            Button("Modifica…") { editing = company }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .surfaceBackground()
    }
}
