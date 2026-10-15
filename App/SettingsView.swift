import AnonymizerKit
import SwiftUI

struct SettingsView: View {
    var body: some View {
        TabView {
            Tab("Cosa nascondere", systemImage: "eye.slash") { CategoriesSettings() }
            Tab("Eccezioni", systemImage: "checkmark.shield") { ExceptionsSettings() }
            Tab("Chat", systemImage: "bubble.left.and.text.bubble.right") { ChatSettings() }
            Tab("Copia di sicurezza", systemImage: "externaldrive.badge.checkmark") { BackupSettings() }
            Tab("Motore", systemImage: "cpu") { EngineSettings() }
            Tab("Aggiornamenti", systemImage: "arrow.down.circle") { UpdateSettings() }
        }
        .frame(width: 600, height: 520)
    }
}

/// Le categorie che diventano segnaposto.
private struct CategoriesSettings: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Form {
            group("Dati personali", note: "Dicono chi è una persona o danno accesso ai suoi conti.", labels: PIICategory.personal)
            group("Aziende", note: "I nomi di aziende nei testi, compresi i tuoi clienti: di serie si nascondono.", labels: PIICategory.companies)
            group("Dati di lavoro", note: "Di serie restano in chiaro: servono all'AI per conti, scadenze e confronti.",
                  labels: PIICategory.workingData)
            Section {
                Toggle("Nascondi anche i dati già nel dizionario che il motore non riconosce in un testo",
                       isOn: $model.settings.maskKnownValues)
            } footer: {
                Text("Un nome trovato nel primo paragrafo non resta in chiaro nel quinto. I nomi di una parola sola restano fuori.")
                    .foregroundStyle(.secondary)
            }
            Section {
                Button("Ripristina le scelte predefinite") {
                    model.settings.hidden = PIICategory.defaultHidden
                    model.settings.maskKnownValues = true
                }
                .disabled(model.settings.hidden == PIICategory.defaultHidden && model.settings.maskKnownValues)
            }
        }
        .formStyle(.grouped)
    }

    private func group(_ title: String, note: String, labels: [String]) -> some View {
        Section {
            LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)],
                      alignment: .leading, spacing: 8) {
                ForEach(labels, id: \.self) { label in
                    Toggle(PIICategory.title(label), isOn: binding(label))
                        .toggleStyle(.checkbox)
                }
            }
        } header: {
            Text(title)
        } footer: {
            Text(note).foregroundStyle(.secondary)
        }
    }

    private func binding(_ label: String) -> Binding<Bool> {
        Binding(get: { model.settings.hidden.contains(label) },
                set: { on in
                    if on { model.settings.hidden.insert(label) } else { model.settings.hidden.remove(label) }
                })
    }
}

/// «Mai nascondere»: nomi che devono restare in chiaro (la tua agenzia, i tuoi prodotti).
private struct ExceptionsSettings: View {
    @Environment(AppModel.self) private var model
    @State private var newException = ""

    var body: some View {
        Form {
            Section {
                ForEach(model.settings.exceptions, id: \.self) { exception in
                    HStack {
                        Text(exception)
                        Spacer()
                        Button("Rimuovi", systemImage: "minus.circle.fill") {
                            model.settings.exceptions.removeAll { $0 == exception }
                        }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .foregroundStyle(.secondary)
                    }
                }
                HStack {
                    TextField("Per esempio il nome della tua agenzia", text: $newException)
                        .onSubmit(add)
                    Button("Aggiungi", action: add)
                        .disabled(newException.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } header: {
                Text("Mai nascondere")
            } footer: {
                Text("Si confrontano senza badare a maiuscole, spazi e forma societaria: «Studio Alfa» vale anche per «STUDIO ALFA S.r.l.».")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private func add() {
        let value = newException.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !model.settings.exceptions.contains(value) else { return }
        model.settings.exceptions.append(value)
        newException = ""
    }
}

/// Dove gira il motore e dove sta il dizionario.
private struct EngineSettings: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Form {
            Section("Motore di anonimizzazione") {
                LabeledContent("Stato", value: engineStatus)
                LabeledContent("Dove gira", value: "Solo su questo Mac: nessun testo viene inviato")
            }
            Section("Dizionario") {
                LabeledContent("Voci", value: "\(model.vault.count)")
                LabeledContent("Protezione", value: protection)
                LabeledContent("Cartella") {
                    Button("Mostra nel Finder") { model.showVaultInFinder() }
                }
            }
        }
        .formStyle(.grouped)
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
        Form {
            Section {
                ChatGPTConnectView()
            } header: {
                Text("Il tuo account ChatGPT")
            } footer: {
                Text("Ognuno collega il proprio abbonamento ChatGPT, sul proprio Mac. La chat usa Codex di OpenAI: se manca, l'app lo installa al primo collegamento.")
                    .foregroundStyle(.secondary)
            }
            Section {
                ChatModelPicker()
            } footer: {
                Text("Si possono scegliere solo i modelli delle famiglie terra, luna e sol dalla versione 6 in poi, fra quelli che il tuo abbonamento vede in Codex. Più ragionamento vuol dire risposte più curate ma più lente.")
                    .foregroundStyle(.secondary)
            }
            Section {
                Label("Domanda, allegati e conversazione precedente partono solo dopo il motore di anonimizzazione, sempre con i segnaposto.",
                      systemImage: "eye.slash")
                Label("Codex parte isolato: senza strumenti, senza ricerca sul web, in sola lettura e in una cartella vuota.",
                      systemImage: "lock.shield")
                Label("Le conversazioni restano cifrate su questo Mac ed entrano nella copia di sicurezza.", systemImage: "lock.fill")
            } header: {
                Text("Cosa esce dal Mac")
            }
        }
        .formStyle(.grouped)
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
            LabeledContent("Modello") {
                Text(model.chat.codexStatus == nil ? "Leggo i modelli…" : "Nessun modello disponibile: collega il tuo account ChatGPT")
                    .foregroundStyle(.secondary)
            }
        } else {
            Picker("Modello", selection: Binding(get: { current?.slug ?? "" }, set: { model.chooseChatModel($0) })) {
                ForEach(models) { item in
                    Text(item.name).tag(item.slug)
                }
            }
            if let current, !current.efforts.isEmpty {
                Picker("Ragionamento", selection: $effort) {
                    Text("Predefinito" + (current.defaultEffort.map { " (\(CodexClient.effortTitle($0).lowercased()))" } ?? "")).tag("")
                    ForEach(current.efforts, id: \.self) { level in
                        Text(CodexClient.effortTitle(level)).tag(level)
                    }
                }
            }
        }
    }
}
