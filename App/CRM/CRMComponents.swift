import AnonymizerKit
import SwiftUI

// MARK: - Pezzi comuni delle schede del CRM

enum Format {
    static let locale = Locale(identifier: "it_IT")

    /// «15 ott 2026».
    static func date(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).year().locale(locale))
    }

    /// «15 ott 2026, 14:05».
    static func dateTime(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).year().hour().minute().locale(locale))
    }

    static func amount(_ value: Decimal?) -> String {
        value.map(ClientDossier.amount) ?? "—"
    }
}

// I colori di stati e fasi: gli stessi esadecimali della versione Windows (`crm/helpers.ts`).
extension CompanyStatus {
    var color: Color {
        switch self {
        case .prospect: Tema.blue
        case .client: Tema.green
        case .former: Tema.gray
        case .supplier: Tema.orange
        case .partner: Tema.purple
        }
    }
}

extension DealStage {
    var color: Color {
        switch self {
        case .new: Tema.gray
        case .qualified: Tema.blue
        case .proposal: Tema.indigo
        case .negotiation: Tema.orange
        case .won: Tema.green
        case .lost: Tema.red
        }
    }
}

/// Un'etichetta colorata («Cliente», «Preventivo inviato»).
struct Badge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .padding(.horizontal, 7)
            .padding(.vertical, 1.5)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
            .lineLimit(1)
            .fixedSize()
    }
}

/// Un controllo di validità accanto a un codice (partita IVA, codice fiscale, IBAN).
struct ValidityNote: View {
    let value: String
    let isValid: (String) -> Bool
    let message: String

    /// Vero quando c'è un valore e non torna.
    static func shows(_ value: String, _ isValid: (String) -> Bool) -> Bool {
        !value.trimmingCharacters(in: .whitespaces).isEmpty && !isValid(value)
    }

    var body: some View {
        if Self.shows(value, isValid) {
            Label(message, systemImage: "exclamationmark.triangle")
                .font(Tema.caption)
                .foregroundStyle(Tema.orange)
        }
    }
}

/// Una riga «etichetta: valore» delle schede, selezionabile.
struct DetailRow: View {
    let title: String
    let value: String
    var valid: Bool?

    var body: some View {
        GridRow(alignment: .firstTextBaseline) {
            Text(title)
                .foregroundStyle(Tema.secondary)
                .gridColumnAlignment(.trailing)
            HStack(spacing: 4) {
                Text(value).textSelection(.enabled)
                if let valid {
                    Image(systemName: valid ? "checkmark.seal" : "exclamationmark.triangle")
                        .font(.system(size: 12))
                        .foregroundStyle(valid ? Tema.green : Tema.orange)
                        .help(valid ? "Il codice di controllo torna" : "Il codice di controllo non torna: controlla il valore")
                }
            }
            .gridColumnAlignment(.leading)
        }
        .font(Tema.body)
    }
}

/// Un'attività in elenco: icona, testo, data, contatto; le cose da fare con la spunta.
struct ActivityRow: View {
    @Environment(AppModel.self) private var model
    let activity: Activity
    var showCompany = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if activity.kind == .task {
                Button {
                    Task { await model.toggleDone(activity) }
                } label: {
                    Image(systemName: activity.isDone ? "checkmark.circle" : "circle")
                        .font(.system(size: 15))
                        .foregroundStyle(activity.isDone ? Tema.green : Tema.secondary)
                        .frame(width: 16)
                }
                .buttonStyle(.plain)
                .help(activity.isDone ? "Segna da fare" : "Segna come fatta")
            } else {
                Image(systemName: activity.kind.symbol)
                    .font(.system(size: 14))
                    .foregroundStyle(Tema.secondary)
                    .frame(width: 16)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(activity.text)
                    .font(Tema.body)
                    .strikethrough(activity.isDone)
                    .foregroundStyle(activity.isDone ? Tema.secondary : Tema.text)
                    .lineLimit(4)
                HStack(spacing: 6) {
                    Text(activity.kind.title)
                    Text("·")
                    Text(Format.date(activity.date))
                    if let contact = model.crm.contact(activity.contactID) {
                        Text("·")
                        Text(contact.fullName)
                    }
                    if showCompany, let company = model.crm.company(activity.companyID) {
                        Text("·")
                        Text(company.name)
                    }
                    if activity.kind == .task, let due = activity.due {
                        Text("·")
                        Text("entro il \(Format.date(due))")
                            .foregroundStyle(activity.isOverdue() ? Tema.red : Tema.secondary)
                            .fontWeight(activity.isOverdue() ? .semibold : .regular)
                    }
                }
                .font(Tema.caption)
                .foregroundStyle(Tema.secondary)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}

/// Una trattativa in elenco.
struct DealRow: View {
    @Environment(AppModel.self) private var model
    let deal: Deal
    var showCompany = false

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(deal.title.isEmpty ? "Trattativa" : deal.title).font(Tema.headline).lineLimit(1)
                HStack(spacing: 6) {
                    if showCompany, let company = model.crm.company(deal.companyID) { Text(company.name) }
                    if let contact = model.crm.contact(deal.contactID) { Text(contact.fullName) }
                    if let close = deal.expectedClose { Text("chiusura prevista \(Format.date(close))") }
                }
                .font(Tema.caption)
                .foregroundStyle(Tema.secondary)
            }
            Spacer()
            Badge(text: deal.stage.title, color: deal.stage.color)
            VStack(alignment: .trailing, spacing: 2) {
                Text(Format.amount(deal.amount)).font(Tema.body).monospacedDigit()
                if deal.stage.isOpen { Text("\(deal.probability)%").font(Tema.caption).foregroundStyle(Tema.secondary) }
            }
            .frame(minWidth: 100, alignment: .trailing)
        }
        .contentShape(Rectangle())
    }
}

// MARK: - Mattoni delle viste del CRM

/// Il pulsante «Indietro» a sinistra nella barra di un dettaglio: toglie l'ultima pagina della pila di navigazione.
struct CRMBackButton: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Button {
            if model.section == .documents {
                if !model.documentsPath.isEmpty { model.documentsPath.removeLast() }
            } else if !model.companiesPath.isEmpty {
                model.companiesPath.removeLast()
            }
        } label: {
            BarIcon(title: "Indietro", symbol: "chevron.left")
        }
        .buttonStyle(.plainIcon)
        .keyboardShortcut("[", modifiers: .command)
        .help("Indietro (⌘[)")
    }
}

/// Un menu di una barra: solo icona con una piccola freccia in giù (come «＋ ⌄» su Windows).
struct BarMenu<Content: View>: View {
    let title: String
    let symbol: String
    @ViewBuilder var content: Content

    var body: some View {
        Menu {
            content
        } label: {
            HStack(spacing: 3) {
                BarIcon(title: title, symbol: symbol)
                Image(systemName: "chevron.down").font(.system(size: 8, weight: .semibold))
            }
            .foregroundStyle(Tema.text)
            .padding(5)
            .contentShape(.rect)
        }
        .menuStyle(.button)
        .buttonStyle(.plainIcon)
        .menuIndicator(.hidden)
        .fixedSize()
        .help(title)
    }
}

/// Un menu a tendina con il bordo dei campi (al posto del Picker di sistema): «Tutte ⌄».
struct FieldMenu<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(value: Value, title: String)]
    /// Largo quanto lo spazio (nei moduli) o quanto il testo.
    var fill = false
    var width: CGFloat?

    var body: some View {
        Menu {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                Button {
                    selection = option.value
                } label: {
                    if option.value == selection { Label(option.title, systemImage: "checkmark") } else { Text(option.title) }
                }
            }
        } label: {
            HStack(spacing: 8) {
                Text(options.first { $0.value == selection }?.title ?? "")
                    .font(Tema.body)
                    .foregroundStyle(Tema.text)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Tema.secondary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .frame(maxWidth: fill ? .infinity : nil)
            .frame(width: width)
            .background(Tema.surface, in: .rect(cornerRadius: Tema.radiusSmall))
            .overlay(RoundedRectangle(cornerRadius: Tema.radiusSmall).strokeBorder(Tema.border))
            .contentShape(.rect)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
    }
}

/// Una casella da spuntare arancione (al posto dell'interruttore di sistema), come la checkbox di Windows.
struct AccentCheckbox: View {
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 3.5)
                    .fill(isOn ? Tema.accent : Tema.surface)
                RoundedRectangle(cornerRadius: 3.5)
                    .strokeBorder(isOn ? Tema.accentStrong : Tema.tertiary, lineWidth: 1)
                if isOn {
                    Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                }
            }
            .frame(width: 16, height: 16)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/// L'intestazione di una tabella piatta: testo 12 semibold grigio, linea sotto.
struct FlatTableHeader: View {
    let columns: [(title: String, width: CGFloat?)]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(columns.enumerated()), id: \.offset) { _, column in
                Text(column.title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Tema.secondary)
                    .lineLimit(1)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .frame(width: column.width, alignment: .leading)
                    .frame(maxWidth: column.width == nil ? .infinity : nil, alignment: .leading)
            }
        }
        .background(Tema.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(Tema.border).frame(height: 1) }
    }
}

/// Una riga di tabella piatta: un clic la sceglie, il doppio clic la apre; linea sotto, selezione arancio tenue.
struct FlatTableRow<Content: View>: View {
    let isSelected: Bool
    var select: () -> Void
    var open: () -> Void
    @ViewBuilder var content: Content
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 0) { content }
            .font(Tema.body)
            .foregroundStyle(Tema.text)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? Tema.accentSoft : hovering ? Tema.hover : .clear)
            .overlay(alignment: .bottom) { Rectangle().fill(Tema.border).frame(height: 1) }
            .contentShape(.rect)
            .onHover { hovering = $0 }
            .onTapGesture(count: 2, perform: open)
            .simultaneousGesture(TapGesture().onEnded(select))
    }
}

/// Una cella di tabella piatta: margini 7×10, larga `width` o tutto lo spazio che avanza.
struct FlatCell<Content: View>: View {
    var width: CGFloat?
    @ViewBuilder var content: Content

    var body: some View {
        content
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .frame(width: width, alignment: .leading)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

/// Un elenco piatto su superficie bianca (al posto di List): righe con linea sotto.
struct FlatList<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) { content }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .surfaceBackground()
    }
}

/// Una cifra con l'etichetta sotto (riepilogo delle trattative, numeri della scheda).
struct CRMFigure: View {
    let value: String
    let label: String
    var alignment: HorizontalAlignment = .leading

    var body: some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(value).font(Tema.title2).monospacedDigit()
            Text(label).font(Tema.caption).foregroundStyle(Tema.secondary)
        }
    }
}
