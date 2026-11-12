import AnonymizerKit
import SwiftUI

/// Le pagine delle impostazioni.
enum SettingsTab: String, CaseIterable, Identifiable {
    case categories, exceptions, chat, backup, engine, updates

    var id: String { rawValue }

    var title: String {
        switch self {
        case .categories: "Cosa nascondere"
        case .exceptions: "Eccezioni"
        case .chat: "Chat"
        case .backup: "Copia di sicurezza"
        case .engine: "Motore"
        case .updates: "Aggiornamenti"
        }
    }

    var symbol: String {
        switch self {
        case .categories: "eye.slash"
        case .exceptions: "checkmark.shield"
        case .chat: "bubble.left.and.text.bubble.right"
        case .backup: "externaldrive"
        case .engine: "cpu"
        case .updates: "arrow.down.circle"
        }
    }
}

/// Le impostazioni: una finestra sopra la finestra, con le pagine in un elenco a sinistra (come su Windows).
struct SettingsView: View {
    @Environment(AppSheets.self) private var sheets
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Impostazioni").font(Tema.title2).padding(.horizontal, 18).padding(.bottom, 10)
                    ForEach(SettingsTab.allCases) { tab in
                        SidebarRow(title: tab.title, symbol: tab.symbol, isSelected: sheets.settingsTab == tab) { sheets.settingsTab = tab }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 14)
                .frame(width: 210)
                .frame(maxHeight: .infinity)
                .background(Tema.sidebar)
                Rectangle().fill(Tema.border).frame(width: 1)
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) { page }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 20)
                }
                .id(sheets.settingsTab)
                .background(Tema.bg)
            }
            .frame(height: 560)
            SheetActions {
                Button("Chiudi") { dismiss() }
                    .buttonStyle(.primary)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .frame(width: 840)
        .background(Tema.surface)
    }

    @ViewBuilder private var page: some View {
        switch sheets.settingsTab {
        case .categories: CategoriesSettings()
        case .exceptions: ExceptionsSettings()
        case .chat: ChatSettings()
        case .backup: BackupSettings()
        case .engine: EngineSettings()
        case .updates: UpdateSettings()
        }
    }
}

/// Le categorie che diventano segnaposto.
private struct CategoriesSettings: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        group("Dati personali", note: "Dicono chi è una persona o danno accesso ai suoi conti.", labels: PIICategory.personal)
        group("Aziende", note: "I nomi di aziende nei testi, compresi i tuoi clienti: di serie si nascondono.", labels: PIICategory.companies)
        group("Dati di lavoro", note: "Di serie restano in chiaro: servono all'AI per conti, scadenze e confronti.",
              labels: PIICategory.workingData)
        FormSection(footer: "Un nome trovato nel primo paragrafo non resta in chiaro nel quinto. I nomi di una parola sola restano fuori.") {
            FormRow {
                Toggle("Nascondi anche i dati già nel dizionario che il motore non riconosce in un testo",
                       isOn: $model.settings.maskKnownValues)
                    .toggleStyle(.accentCheckbox)
            }
        }
        FormSection {
            FormRow {
                Button("Ripristina le scelte predefinite") {
                    model.settings.hidden = PIICategory.defaultHidden
                    model.settings.maskKnownValues = true
                }
                .buttonStyle(.flat)
                .disabled(model.settings.hidden == PIICategory.defaultHidden && model.settings.maskKnownValues)
            }
        }
    }

    private func group(_ title: String, note: String, labels: [String]) -> some View {
        FormSection(header: title, footer: note) {
            FormRow {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 16, alignment: .leading), GridItem(.flexible(), alignment: .leading)],
                          alignment: .leading, spacing: 8) {
                    ForEach(labels, id: \.self) { label in
                        Toggle(PIICategory.title(label), isOn: binding(label))
                            .toggleStyle(.accentCheckbox)
                    }
                }
            }
        }
    }

    private func binding(_ label: String) -> Binding<Bool> {
        Binding(get: { model.settings.hidden.contains(label) },
                set: { on in
                    if on { model.settings.hidden.insert(label) } else { model.settings.hidden.remove(label) }
                })
    }
}

/// Le eccezioni alle regole del motore: «nascondi sempre» (quello che non riconosce da solo) e «mai nascondere» (nomi
/// che devono restare in chiaro, come la tua agenzia).
private struct ExceptionsSettings: View {
    @Environment(AppModel.self) private var model
    @State private var newForced = ""
    @State private var forcedLabel = "ORG"
    @State private var newException = ""

    var body: some View {
        FormSection(header: "Nascondi sempre",
                    footer: "Nomi che il motore non riconosce da solo, per esempio un'attività dal nome vago. Diventano un segnaposto ovunque compaiano, senza badare a maiuscole e spazi, e tornano veri quando riconverti.") {
            ForEach(model.settings.forcedTerms) { term in
                FormRow {
                    Text(term.value).lineLimit(1).textSelection(.enabled)
                    Spacer()
                    labelPicker(label(of: term))
                    removeButton { model.settings.forcedTerms.removeAll { $0.id == term.id } }
                }
            }
            FormRow {
                TextField("Nascondi sempre", text: $newForced, prompt: Text("Per esempio «On Location»"))
                    .styledField()
                    .onSubmit(addForced)
                labelPicker($forcedLabel)
                Button("Aggiungi", action: addForced)
                    .buttonStyle(.flat)
                    .disabled(newForced.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        FormSection(header: "Mai nascondere",
                    footer: "Si confrontano senza badare a maiuscole, spazi e forma societaria: «Studio Alfa» vale anche per «STUDIO ALFA S.r.l.».") {
            ForEach(model.settings.exceptions, id: \.self) { exception in
                FormRow {
                    Text(exception).lineLimit(1).textSelection(.enabled)
                    Spacer()
                    removeButton { model.settings.exceptions.removeAll { $0 == exception } }
                }
            }
            FormRow {
                TextField("Mai nascondere", text: $newException, prompt: Text("Per esempio il nome della tua agenzia"))
                    .styledField()
                    .onSubmit(addException)
                Button("Aggiungi", action: addException)
                    .buttonStyle(.flat)
                    .disabled(newException.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func labelPicker(_ selection: Binding<String>) -> some View {
        FlatMenuPicker(selection: selection, options: ForcedTerm.labels.map { (value: $0, title: ForcedTerm.title($0)) })
    }

    private func removeButton(_ action: @escaping () -> Void) -> some View {
        Button(action: action) { BarIcon(title: "Rimuovi", symbol: "minus.circle") }
            .buttonStyle(.plainIcon)
            .help("Rimuovi")
    }

    private func label(of term: ForcedTerm) -> Binding<String> {
        Binding(get: { term.label },
                set: { label in
                    guard let index = model.settings.forcedTerms.firstIndex(where: { $0.id == term.id }) else { return }
                    model.settings.forcedTerms[index].label = label
                })
    }

    private func addForced() {
        let value = newForced.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        let term = ForcedTerm(value: value, label: forcedLabel)
        // Una parola sola in un elenco: se c'era già, cambia solo la categoria.
        if let index = model.settings.forcedTerms.firstIndex(where: { $0.id == term.id }) {
            model.settings.forcedTerms[index] = term
        } else {
            model.settings.forcedTerms.append(term)
        }
        // Nascondere e lasciare in chiaro la stessa parola non ha senso: vince l'ultima scelta.
        model.settings.exceptions.removeAll { ForcedTerm(value: $0, label: term.label).id == term.id }
        newForced = ""
    }

    private func addException() {
        let value = newException.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !model.settings.exceptions.contains(value) else { return }
        model.settings.exceptions.append(value)
        model.settings.forcedTerms.removeAll { $0.id == ForcedTerm(value: value, label: $0.label).id }
        newException = ""
    }
}

/// Dove gira il motore e dove sta il dizionario.
private struct EngineSettings: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        FormSection(header: "Motore di anonimizzazione") {
            LabeledRow(label: "Stato", value: engineStatus)
            LabeledRow(label: "Dove gira", value: "Solo su questo Mac: nessun testo viene inviato")
        }
        FormSection(header: "Dizionario") {
            LabeledRow(label: "Voci", value: "\(model.vault.count)")
            LabeledRow(label: "Protezione", value: protection)
            FormRow {
                Text("Cartella")
                Spacer()
                Button("Mostra nel Finder") { model.showVaultInFinder() }.buttonStyle(.flat)
            }
        }
    }

    private var engineStatus: String {
        switch model.engineState {
        case .loading: "In preparazione…"
        case .ready: "Pronto"
        case .missing: "Assente: esegui Scripts/prepara-motore.sh e ricompila"
        case .failed(let reason): reason
        }
    }

    private var protection: String {
        switch model.vaultState {
        case .opening: "…"
        case .ready(let protection): "Cifrato (AES-GCM) · chiave custodita da: \(protection.description)"
        case .failed(let reason): reason
        }
    }
}

/// La chat con GPT: Codex, modello e ragionamento.
private struct ChatSettings: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        FormSection(header: "Il tuo account ChatGPT",
                    footer: "Ognuno collega il proprio abbonamento ChatGPT, sul proprio Mac. La chat usa Codex di OpenAI: se manca, l'app lo installa al primo collegamento.") {
            FormRow { ChatGPTConnectView() }
        }
        FormSection(footer: "Si possono scegliere solo i modelli delle famiglie terra, luna e sol dalla versione 6 in poi, fra quelli che il tuo abbonamento vede in Codex. Più ragionamento vuol dire risposte più curate ma più lente.") {
            ChatModelPicker()
        }
        FormSection(header: "Cosa esce dal Mac") {
            infoRow("eye.slash", "Domanda, allegati e conversazione precedente partono solo dopo il motore di anonimizzazione, sempre con i segnaposto.")
            infoRow("checkmark.shield", "Codex parte isolato: senza strumenti, senza ricerca sul web, in sola lettura e in una cartella vuota.")
            infoRow("lock", "Le conversazioni restano cifrate su questo Mac ed entrano nella copia di sicurezza.")
        }
    }

    private func infoRow(_ symbol: String, _ text: String) -> some View {
        FormRow {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: symbol).frame(width: 18)
                Text(text).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// Il modello di GPT e il suo ragionamento: solo terra, luna e sol dalla versione 6.
struct ChatModelPicker: View {
    @Environment(AppModel.self) private var model
    @AppStorage(AppModel.chatEffortKey) private var effort = ""

    var body: some View {
        let models = model.chat.models
        let current = model.chatModel
        let _ = model.chat.modelRevision
        if models.isEmpty {
            LabeledRow(label: "Modello",
                       value: model.chat.codexStatus == nil ? "Leggo i modelli…" : "Nessun modello disponibile: collega il tuo account ChatGPT")
        } else {
            // Una vista sola dentro la sezione: la linea fra le due righe la mette lei.
            VStack(spacing: 0) {
                FormRow {
                    Text("Modello")
                    Spacer()
                    FlatMenuPicker(selection: Binding(get: { current?.slug ?? "" }, set: { model.chooseChatModel($0) }),
                                   options: models.map { (value: $0.slug, title: $0.name) })
                }
                if let current, !current.efforts.isEmpty {
                    Rectangle().fill(Tema.border).frame(height: 1)
                    FormRow {
                        Text("Ragionamento")
                        Spacer()
                        FlatMenuPicker(selection: $effort,
                                       options: [(value: "", title: "Predefinito" + (current.defaultEffort.map { " (\(CodexClient.effortTitle($0).lowercased()))" } ?? ""))]
                                           + current.efforts.map { (value: $0, title: CodexClient.effortTitle($0)) })
                    }
                }
            }
        }
    }
}
