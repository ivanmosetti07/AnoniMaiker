import AnonymizerKit
import SwiftUI

// MARK: - Le schede di modifica (fogli)
//
// Ogni foglio lavora su una copia: «Salva» la scrive nel CRM cifrato, «Annulla» la butta.

/// Lo scheletro comune: titolo, modulo, Annulla e Salva.
private struct EditorSheet<Content: View>: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let canSave: Bool
    let save: () async -> Void
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            Text(title)
                .font(.headline)
                .lineLimit(1)
                .padding(.top, 16)
                .padding(.horizontal, 20)
            Form { content }
                .formStyle(.grouped)
            Divider()
            HStack {
                Spacer()
                Button("Annulla") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Salva") {
                    Task {
                        await save()
                        dismiss()
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!canSave)
            }
            .padding(14)
        }
        .frame(width: 540)
        .frame(minHeight: 420, idealHeight: 640)
    }
}

/// Un menu per scegliere un'azienda (anche «Nessuna»).
struct CompanyPicker: View {
    @Environment(AppModel.self) private var model
    let title: String
    @Binding var selection: UUID?
    var allowsNone = true

    var body: some View {
        Picker(title, selection: $selection) {
            if allowsNone { Text("Nessuna").tag(UUID?.none) }
            ForEach(model.companyChoices) { company in
                Text(company.name).tag(Optional(company.id))
            }
        }
    }
}

struct CompanyEditor: View {
    @Environment(AppModel.self) private var model
    @State var company: Company

    var body: some View {
        EditorSheet(title: company.name.isEmpty ? "Nuovo cliente" : company.name,
                    canSave: !company.name.trimmingCharacters(in: .whitespaces).isEmpty,
                    save: { await model.save(company) }) {
            Section("Cliente") {
                TextField("Ragione sociale", text: $company.name, prompt: Text("Edilnord S.r.l."))
                Picker("Stato", selection: $company.status) {
                    ForEach(CompanyStatus.allCases) { Text($0.title).tag($0) }
                }
                TextField("Settore", text: $company.sector)
            }
            Section {
                TextField("Partita IVA", text: $company.vatNumber)
                ValidityNote(value: company.vatNumber, isValid: Validators.isValidVATNumber,
                             message: "La cifra di controllo della partita IVA non torna")
                TextField("Codice fiscale", text: $company.taxCode)
                ValidityNote(value: company.taxCode, isValid: Validators.isValidTaxCode,
                             message: "Il codice fiscale non sembra valido")
                TextField("IBAN", text: $company.iban)
                ValidityNote(value: company.iban, isValid: Validators.isValidIBAN, message: "Il codice di controllo dell'IBAN non torna")
            } header: {
                Text("Dati fiscali")
            }
            Section("Recapiti") {
                TextField("Email", text: $company.email)
                TextField("PEC", text: $company.pec)
                TextField("Telefono", text: $company.phone)
                TextField("Sito web", text: $company.website)
            }
            Section("Sede") {
                TextField("Via e numero civico", text: $company.street)
                TextField("CAP", text: $company.zipCode)
                TextField("Città", text: $company.city)
                TextField("Provincia", text: $company.province, prompt: Text("MI"))
            }
            Section("Note") {
                TextEditor(text: $company.notes)
                    .frame(minHeight: 80)
            }
        }
    }
}

struct ContactEditor: View {
    @Environment(AppModel.self) private var model
    @State var contact: Contact

    var body: some View {
        EditorSheet(title: contact.fullName.isEmpty ? "Nuovo contatto" : contact.fullName,
                    canSave: !contact.fullName.isEmpty,
                    save: { await model.save(contact) }) {
            Section("Persona") {
                TextField("Nome", text: $contact.firstName)
                TextField("Cognome", text: $contact.lastName)
                TextField("Ruolo", text: $contact.role, prompt: Text("Direttore acquisti"))
                CompanyPicker(title: "Cliente", selection: $contact.companyID)
            }
            Section("Recapiti") {
                TextField("Email", text: $contact.email)
                ValidityNote(value: contact.email, isValid: Validators.isValidEmail, message: "L'indirizzo email non sembra valido")
                TextField("Telefono", text: $contact.phone)
                TextField("Cellulare", text: $contact.mobile)
            }
            Section("Dati personali") {
                TextField("Codice fiscale", text: $contact.taxCode)
                ValidityNote(value: contact.taxCode, isValid: Validators.isValidTaxCode, message: "Il codice fiscale non sembra valido")
            }
            Section("Note") {
                TextEditor(text: $contact.notes)
                    .frame(minHeight: 70)
            }
        }
    }
}

struct DealEditor: View {
    @Environment(AppModel.self) private var model
    @State var deal: Deal

    private var amount: Binding<Decimal> {
        Binding(get: { deal.amount ?? 0 }, set: { deal.amount = $0 == 0 ? nil : $0 })
    }

    private var hasClose: Binding<Bool> {
        Binding(get: { deal.expectedClose != nil },
                set: { deal.expectedClose = $0 ? (deal.expectedClose ?? Calendar.current.date(byAdding: .month, value: 1, to: .now)) : nil })
    }

    private var close: Binding<Date> {
        Binding(get: { deal.expectedClose ?? .now }, set: { deal.expectedClose = $0 })
    }

    private var company: Binding<UUID?> {
        Binding(get: { deal.companyID }, set: { if let id = $0 { deal.companyID = id; deal.contactID = nil } })
    }

    var body: some View {
        EditorSheet(title: deal.title.isEmpty ? "Nuova trattativa" : deal.title,
                    canSave: !deal.title.trimmingCharacters(in: .whitespaces).isEmpty && model.crm.company(deal.companyID) != nil,
                    save: { await model.save(deal) }) {
            Section("Trattativa") {
                TextField("Titolo", text: $deal.title, prompt: Text("Nuovo sito web"))
                CompanyPicker(title: "Cliente", selection: company, allowsNone: false)
                Picker("Referente", selection: $deal.contactID) {
                    Text("Nessuno").tag(UUID?.none)
                    ForEach(model.crm.contacts(of: deal.companyID)) { contact in
                        Text(contact.fullName).tag(Optional(contact.id))
                    }
                }
            }
            Section("Andamento") {
                Picker("Fase", selection: $deal.stage) {
                    ForEach(DealStage.allCases) { Text($0.title).tag($0) }
                }
                .onChange(of: deal.stage) { _, stage in deal.probability = stage.defaultProbability }
                TextField("Importo", value: amount, format: .currency(code: "EUR").locale(Format.locale))
                Stepper("Probabilità: \(deal.probability)%", value: $deal.probability, in: 0...100, step: 5)
                Toggle("Data di chiusura prevista", isOn: hasClose)
                if deal.expectedClose != nil {
                    DatePicker("Chiusura prevista", selection: close, displayedComponents: .date)
                }
            }
            Section("Note") {
                TextEditor(text: $deal.notes)
                    .frame(minHeight: 70)
            }
        }
    }
}

struct ActivityEditor: View {
    @Environment(AppModel.self) private var model
    @State var activity: Activity

    private var hasDue: Binding<Bool> {
        Binding(get: { activity.due != nil },
                set: { activity.due = $0 ? (activity.due ?? Calendar.current.date(byAdding: .day, value: 1, to: .now)) : nil })
    }

    private var due: Binding<Date> {
        Binding(get: { activity.due ?? .now }, set: { activity.due = $0 })
    }

    var body: some View {
        EditorSheet(title: activity.kind.title, canSave: !activity.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    save: { await model.save(activity) }) {
            Section {
                Picker("Tipo", selection: $activity.kind) {
                    ForEach(ActivityKind.allCases) { Label($0.title, systemImage: $0.symbol).tag($0) }
                }
                TextEditor(text: $activity.text)
                    .frame(minHeight: 110)
                DatePicker("Data", selection: $activity.date)
                if activity.kind == .task {
                    Toggle("Scadenza", isOn: hasDue)
                    if activity.due != nil {
                        DatePicker("Entro il", selection: due, displayedComponents: .date)
                    }
                    Toggle("Fatta", isOn: $activity.isDone)
                }
            }
            Section("Collegamenti") {
                CompanyPicker(title: "Cliente", selection: $activity.companyID)
                if let companyID = activity.companyID {
                    Picker("Contatto", selection: $activity.contactID) {
                        Text("Nessuno").tag(UUID?.none)
                        ForEach(model.crm.contacts(of: companyID)) { Text($0.fullName).tag(Optional($0.id)) }
                    }
                    Picker("Trattativa", selection: $activity.dealID) {
                        Text("Nessuna").tag(UUID?.none)
                        ForEach(model.crm.deals(of: companyID)) { Text($0.title).tag(Optional($0.id)) }
                    }
                }
            }
        }
    }
}
