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

extension CompanyStatus {
    var color: Color {
        switch self {
        case .prospect: .blue
        case .client: .green
        case .former: .gray
        case .supplier: .orange
        case .partner: .purple
        }
    }
}

extension DealStage {
    var color: Color {
        switch self {
        case .new: .gray
        case .qualified: .blue
        case .proposal: .indigo
        case .negotiation: .orange
        case .won: .green
        case .lost: .red
        }
    }
}

/// Un'etichetta colorata («Cliente», «Preventivo inviato»).
struct Badge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
            .lineLimit(1)
    }
}

/// Un controllo di validità accanto a un codice (partita IVA, codice fiscale, IBAN).
struct ValidityNote: View {
    let value: String
    let isValid: (String) -> Bool
    let message: String

    var body: some View {
        if !value.trimmingCharacters(in: .whitespaces).isEmpty, !isValid(value) {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.orange)
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
                .foregroundStyle(.secondary)
                .gridColumnAlignment(.trailing)
            HStack(spacing: 4) {
                Text(value).textSelection(.enabled)
                if let valid {
                    Image(systemName: valid ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(valid ? .green : .orange)
                        .help(valid ? "Il codice di controllo torna" : "Il codice di controllo non torna: controlla il valore")
                }
            }
            .gridColumnAlignment(.leading)
        }
    }
}

/// Un'attività in elenco: icona, testo, data, contatto; le cose da fare con la spunta.
struct ActivityRow: View {
    @Environment(AppModel.self) private var model
    let activity: Activity
    var showCompany = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            if activity.kind == .task {
                Button {
                    Task { await model.toggleDone(activity) }
                } label: {
                    Image(systemName: activity.isDone ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(activity.isDone ? Color.green : Color.secondary)
                        .font(.body)
                }
                .buttonStyle(.plain)
                .help(activity.isDone ? "Segna da fare" : "Segna come fatta")
            } else {
                Image(systemName: activity.kind.symbol)
                    .foregroundStyle(.secondary)
                    .frame(width: 16)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(activity.text)
                    .strikethrough(activity.isDone)
                    .foregroundStyle(activity.isDone ? .secondary : .primary)
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
                            .foregroundStyle(activity.isOverdue() ? Color.red : Color.secondary)
                            .fontWeight(activity.isOverdue() ? .semibold : .regular)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 3)
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
                Text(deal.title.isEmpty ? "Trattativa" : deal.title).fontWeight(.medium)
                HStack(spacing: 6) {
                    if showCompany, let company = model.crm.company(deal.companyID) { Text(company.name) }
                    if let contact = model.crm.contact(deal.contactID) { Text(contact.fullName) }
                    if let close = deal.expectedClose { Text("chiusura prevista \(Format.date(close))") }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            Badge(text: deal.stage.title, color: deal.stage.color)
            VStack(alignment: .trailing, spacing: 2) {
                Text(Format.amount(deal.amount)).monospacedDigit()
                if deal.stage.isOpen { Text("\(deal.probability)%").font(.caption).foregroundStyle(.secondary) }
            }
            .frame(minWidth: 100, alignment: .trailing)
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }
}

/// Il banner quando i dati cifrati non si aprono (per esempio su un Mac nuovo).
struct DataBanner: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if case .failed(let reason) = model.vaultState {
            HStack(spacing: 10) {
                Image(systemName: "lock.trianglebadge.exclamationmark").foregroundStyle(.red)
                Text(reason).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Button("Ripristina una copia…") { model.startRestore() }
            }
            .font(.callout)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.red.opacity(0.1))
        }
    }
}
