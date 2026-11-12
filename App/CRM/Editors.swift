import AnonymizerKit
import SwiftUI

// MARK: - Le schede di modifica (fogli)
//
// Ogni foglio lavora su una copia: «Salva» la scrive nel CRM cifrato, «Annulla» la butta.
// L'aspetto è quello dei fogli di Windows (`crm-editor`): titolo centrato, sezioni con il titolo fuori e un riquadro
// grigio chiaro, righe «etichetta (150) · campo largo».

/// Lo scheletro comune: titolo, modulo, Annulla e Salva.
private struct EditorSheet<Content: View>: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let canSave: Bool
    let save: () async -> Void
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(title)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                    content
                }
                .padding(20)
            }
            SheetActions {
                Button("Annulla") { dismiss() }
                    .buttonStyle(.flat)
                    .keyboardShortcut(.cancelAction)
                    .help("Annulla (Esc)")
                Button("Salva") {
                    Task {
                        await save()
                        dismiss()
                    }
                }
                .buttonStyle(.primary)
                .keyboardShortcut(.defaultAction)
                .disabled(!canSave)
                .help("Salva (Invio)")
            }
        }
        .frame(width: 540)
        .frame(minHeight: 420, idealHeight: 640)
        .background(Tema.surface)
    }
}

/// Una sezione del modulo: titolo grigio fuori, righe in un riquadro su sfondo `bg` separate da una linea.
private struct EditorSection<Content: View>: View {
    var title: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let title {
                Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(Tema.secondary).padding(.leading, 4)
            }
            VStack(spacing: 0) {
                _VariadicView.Tree(EditorRowsLayout()) { content }
            }
            .background(Tema.bg, in: .rect(cornerRadius: Tema.radius))
            .overlay(RoundedRectangle(cornerRadius: Tema.radius).strokeBorder(Tema.border))
        }
    }
}

private struct EditorRowsLayout: _VariadicView_MultiViewRoot {
    func body(children: _VariadicView.Children) -> some View {
        ForEach(children) { child in
            if child.id != children.first?.id { Rectangle().fill(Tema.border).frame(height: 1) }
            child
        }
    }
}

/// Una riga: etichetta larga 150 e il campo nel resto.
private struct EditorField<Control: View>: View {
    let label: String
    @ViewBuilder var control: Control

    var body: some View {
        HStack(spacing: 12) {
            Text(label).font(Tema.body).foregroundStyle(Tema.text).lineLimit(1).frame(width: 150, alignment: .leading)
            control.frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .frame(minHeight: 38)
    }
}

/// Una riga con l'etichetta a sinistra e il controllo in fondo a destra (caselle, più e meno).
private struct EditorTrailingRow<Control: View>: View {
    let label: String
    @ViewBuilder var control: Control

    var body: some View {
        HStack(spacing: 12) {
            Text(label).font(Tema.body).foregroundStyle(Tema.text).lineLimit(1)
            Spacer(minLength: 8)
            control
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .frame(minHeight: 38)
    }
}

private struct EditorTextField: View {
    let label: String
    @Binding var text: String
    var prompt: String?

    var body: some View {
        EditorField(label: label) {
            TextField("", text: $text, prompt: prompt.map { Text($0) }).styledField()
        }
    }
}

/// Il testo lungo (note), largo quanto la sezione.
private struct EditorTextEditor: View {
    @Binding var text: String
    var minHeight: CGFloat = 80
    @FocusState private var focused: Bool

    var body: some View {
        TextEditor(text: $text)
            .font(Tema.body)
            .scrollContentBackground(.hidden)
            .focused($focused)
            .lineSpacing(2)
            .padding(.horizontal, 4)
            .padding(.vertical, 5)
            .frame(minHeight: minHeight)
            .background(Tema.surface, in: .rect(cornerRadius: Tema.radiusSmall))
            .overlay(RoundedRectangle(cornerRadius: Tema.radiusSmall).strokeBorder(focused ? Tema.accent : Tema.border))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
    }
}

/// L'avviso di validità sotto un campo, allineato al campo.
private struct EditorNote: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(Tema.caption)
            .foregroundStyle(Tema.orange)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 174)
            .padding(.trailing, 12)
            .padding(.vertical, 6)
    }
}

/// «−» e «+» uniti, come lo Stepper di Windows.
private struct EditorStepper: View {
    @Binding var value: Int
    let range: ClosedRange<Int>
    let step: Int

    var body: some View {
        HStack(spacing: 0) {
            Button { value = max(range.lowerBound, value - step) } label: { Image(systemName: "minus").frame(width: 14, height: 14) }
                .disabled(value <= range.lowerBound)
                .help("Meno")
            Rectangle().fill(Tema.border).frame(width: 1, height: 20)
            Button { value = min(range.upperBound, value + step) } label: { Image(systemName: "plus").frame(width: 14, height: 14) }
                .disabled(value >= range.upperBound)
                .help("Più")
        }
        .buttonStyle(StepperHalfStyle())
        .background(Tema.surface, in: .rect(cornerRadius: Tema.radiusSmall))
        .overlay(RoundedRectangle(cornerRadius: Tema.radiusSmall).strokeBorder(Tema.border))
        .fixedSize()
    }

    private struct StepperHalfStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Tema.text)
                .padding(.horizontal, 9)
                .padding(.vertical, 3)
                .background(configuration.isPressed ? Tema.selected : .clear)
                .contentShape(.rect)
        }
    }
}

/// Una data in un campo largo con il bordo e l'icona del calendario: al clic si apre il calendario (come su Windows).
private struct EditorDate: View {
    @Binding var date: Date
    var components: DatePickerComponents = .date
    @State private var picking = false

    private var text: String {
        components.contains(.hourAndMinute)
            ? date.formatted(.dateTime.day(.twoDigits).month(.twoDigits).year().hour().minute().locale(Format.locale))
            : date.formatted(.dateTime.day(.twoDigits).month(.twoDigits).year().locale(Format.locale))
    }

    var body: some View {
        Button { picking = true } label: {
            HStack {
                Text(text).font(Tema.body).foregroundStyle(Tema.text).monospacedDigit()
                Spacer(minLength: 8)
                Image(systemName: "calendar").font(.system(size: 13)).foregroundStyle(Tema.text)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .frame(maxWidth: .infinity)
            .background(Tema.surface, in: .rect(cornerRadius: Tema.radiusSmall))
            .overlay(RoundedRectangle(cornerRadius: Tema.radiusSmall).strokeBorder(picking ? Tema.accent : Tema.border))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .popover(isPresented: $picking, arrowEdge: .bottom) {
            VStack(spacing: 8) {
                DatePicker("", selection: $date, displayedComponents: .date)
                    .labelsHidden()
                    .datePickerStyle(.graphical)
                if components.contains(.hourAndMinute) {
                    DatePicker("Ora", selection: $date, displayedComponents: .hourAndMinute)
                        .datePickerStyle(.field)
                }
            }
            .tint(Tema.accent)
            .environment(\.locale, Format.locale)
            .padding(12)
        }
    }
}

/// Un menu per scegliere un'azienda (anche «Nessuna»).
struct CompanyPicker: View {
    @Environment(AppModel.self) private var model
    let title: String
    @Binding var selection: UUID?
    var allowsNone = true

    var body: some View {
        EditorField(label: title) {
            FieldMenu(selection: $selection,
                      options: (allowsNone ? [(value: UUID?.none, title: "Nessuna")] : [])
                          + model.companyChoices.map { (value: Optional($0.id), title: $0.name) },
                      fill: true)
        }
    }
}

struct CompanyEditor: View {
    @Environment(AppModel.self) private var model
    @State var company: Company

    var body: some View {
        EditorSheet(title: company.name.isEmpty ? "Nuova azienda" : company.name,
                    canSave: !company.name.trimmingCharacters(in: .whitespaces).isEmpty,
                    save: { await model.save(company) }) {
            EditorSection(title: "Azienda") {
                EditorTextField(label: "Ragione sociale", text: $company.name, prompt: "Edilnord S.r.l.")
                EditorField(label: "Stato") {
                    FieldMenu(selection: $company.status, options: CompanyStatus.allCases.map { (value: $0, title: $0.title) }, fill: true)
                }
                EditorTextField(label: "Settore", text: $company.sector)
            }
            EditorSection(title: "Dati fiscali") {
                EditorTextField(label: "Partita IVA", text: $company.vatNumber)
                if ValidityNote.shows(company.vatNumber, Validators.isValidVATNumber) {
                    EditorNote(message: "La cifra di controllo della partita IVA non torna")
                }
                EditorTextField(label: "Codice fiscale", text: $company.taxCode)
                if ValidityNote.shows(company.taxCode, Validators.isValidTaxCode) {
                    EditorNote(message: "Il codice fiscale non sembra valido")
                }
                EditorTextField(label: "IBAN", text: $company.iban)
                if ValidityNote.shows(company.iban, Validators.isValidIBAN) {
                    EditorNote(message: "Il codice di controllo dell'IBAN non torna")
                }
            }
            EditorSection(title: "Recapiti") {
                EditorTextField(label: "Email", text: $company.email)
                EditorTextField(label: "PEC", text: $company.pec)
                EditorTextField(label: "Telefono", text: $company.phone)
                EditorTextField(label: "Sito web", text: $company.website)
            }
            EditorSection(title: "Sede") {
                EditorTextField(label: "Via e numero civico", text: $company.street)
                EditorTextField(label: "CAP", text: $company.zipCode)
                EditorTextField(label: "Città", text: $company.city)
                EditorTextField(label: "Provincia", text: $company.province, prompt: "MI")
            }
            EditorSection(title: "Note") {
                EditorTextEditor(text: $company.notes, minHeight: 80)
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
            EditorSection(title: "Persona") {
                EditorTextField(label: "Nome", text: $contact.firstName)
                EditorTextField(label: "Cognome", text: $contact.lastName)
                EditorTextField(label: "Ruolo", text: $contact.role, prompt: "Direttore acquisti")
                CompanyPicker(title: "Azienda", selection: $contact.companyID)
            }
            EditorSection(title: "Recapiti") {
                EditorTextField(label: "Email", text: $contact.email)
                if ValidityNote.shows(contact.email, Validators.isValidEmail) {
                    EditorNote(message: "L'indirizzo email non sembra valido")
                }
                EditorTextField(label: "Telefono", text: $contact.phone)
                EditorTextField(label: "Cellulare", text: $contact.mobile)
            }
            EditorSection(title: "Dati personali") {
                EditorTextField(label: "Codice fiscale", text: $contact.taxCode)
                if ValidityNote.shows(contact.taxCode, Validators.isValidTaxCode) {
                    EditorNote(message: "Il codice fiscale non sembra valido")
                }
            }
            EditorSection(title: "Note") {
                EditorTextEditor(text: $contact.notes, minHeight: 70)
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
        Binding(get: { deal.companyID }, set: { deal.companyID = $0; deal.contactID = nil })
    }

    private var contacts: [Contact] {
        deal.companyID.map { model.crm.contacts(of: $0) } ?? model.crm.contacts.sorted { $0.fullName < $1.fullName }
    }

    var body: some View {
        EditorSheet(title: deal.title.isEmpty ? "Nuova trattativa" : deal.title,
                    canSave: !deal.title.trimmingCharacters(in: .whitespaces).isEmpty,
                    save: { await model.save(deal) }) {
            EditorSection(title: "Trattativa") {
                EditorTextField(label: "Titolo", text: $deal.title, prompt: "Nuovo sito web")
                CompanyPicker(title: "Azienda", selection: company)
                EditorField(label: "Referente") {
                    FieldMenu(selection: $deal.contactID,
                              options: [(value: UUID?.none, title: "Nessuno")] + contacts.map { (value: Optional($0.id), title: $0.fullName) },
                              fill: true)
                }
            }
            EditorSection(title: "Andamento") {
                EditorField(label: "Fase") {
                    FieldMenu(selection: $deal.stage, options: DealStage.allCases.map { (value: $0, title: $0.title) }, fill: true)
                }
                EditorField(label: "Importo") {
                    HStack(spacing: 6) {
                        TextField("", value: amount, format: .number.precision(.fractionLength(2)).locale(Format.locale), prompt: Text("0,00"))
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                            .styledField()
                        Text("€").font(Tema.body).foregroundStyle(Tema.secondary)
                    }
                }
                EditorTrailingRow(label: "Probabilità: \(deal.probability)%") {
                    EditorStepper(value: $deal.probability, range: 0...100, step: 5)
                }
                EditorTrailingRow(label: "Data di chiusura prevista") {
                    AccentCheckbox(isOn: hasClose)
                }
                if deal.expectedClose != nil {
                    EditorField(label: "Chiusura prevista") { EditorDate(date: close) }
                }
            }
            .onChange(of: deal.stage) { _, stage in deal.probability = stage.defaultProbability }
            EditorSection(title: "Note") {
                EditorTextEditor(text: $deal.notes, minHeight: 70)
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
            EditorSection {
                EditorField(label: "Tipo") {
                    FieldMenu(selection: $activity.kind, options: ActivityKind.allCases.map { (value: $0, title: $0.title) }, fill: true)
                }
                EditorTextEditor(text: $activity.text, minHeight: 110)
                EditorField(label: "Data") { EditorDate(date: $activity.date, components: [.date, .hourAndMinute]) }
                if activity.kind == .task {
                    EditorTrailingRow(label: "Scadenza") { AccentCheckbox(isOn: hasDue) }
                    if activity.due != nil {
                        EditorField(label: "Entro il") { EditorDate(date: due) }
                    }
                    EditorTrailingRow(label: "Fatta") { AccentCheckbox(isOn: $activity.isDone) }
                }
            }
            EditorSection(title: "Collegamenti") {
                CompanyPicker(title: "Azienda", selection: $activity.companyID)
                if let companyID = activity.companyID {
                    EditorField(label: "Contatto") {
                        FieldMenu(selection: $activity.contactID,
                                  options: [(value: UUID?.none, title: "Nessuno")]
                                      + model.crm.contacts(of: companyID).map { (value: Optional($0.id), title: $0.fullName) },
                                  fill: true)
                    }
                    EditorField(label: "Trattativa") {
                        FieldMenu(selection: $activity.dealID,
                                  options: [(value: UUID?.none, title: "Nessuna")]
                                      + model.crm.deals(of: companyID).map { (value: Optional($0.id), title: $0.title) },
                                  fill: true)
                    }
                }
            }
        }
    }
}
