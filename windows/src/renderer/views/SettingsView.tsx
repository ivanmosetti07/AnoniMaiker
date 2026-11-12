import { useState, type ReactNode } from "react";
import { CircleArrowDown, CircleMinus, Cpu, EyeOff, HardDrive, LockKeyhole, MessagesSquare, ShieldCheck, type LucideIcon } from "lucide-react";
import type { AnonymizationSettings } from "../../core/anonimizzazione/anonymizer";
import { ChatGPTConnectView } from "../chat";
import { Button, Icon, Sheet, Toggle } from "../ui/components";
import { useObserved } from "../ui/observe";
import { ForcedTermInfo, PIICategory, describeProtection, effortTitle } from "../helpers";
import { BackupSettings } from "./BackupViews";
import { UpdateSettings } from "./UpdateViews";
import { FormRow, FormSection, LabeledContent } from "./parts";

// MARK: - Impostazioni (SettingsView.swift)
//
// Sul Mac è una finestra a schede; qui una finestra grande sopra l'app, con le stesse schede in un elenco a sinistra.

const { model } = window.anonimaiker;

type Tab = "categories" | "exceptions" | "chat" | "backup" | "engine" | "updates";

const tabs: { id: Tab; title: string; icon: LucideIcon }[] = [
  { id: "categories", title: "Cosa nascondere", icon: EyeOff },
  { id: "exceptions", title: "Eccezioni", icon: ShieldCheck },
  { id: "chat", title: "Chat", icon: MessagesSquare },
  { id: "backup", title: "Copia di sicurezza", icon: HardDrive },
  { id: "engine", title: "Motore", icon: Cpu },
  { id: "updates", title: "Aggiornamenti", icon: CircleArrowDown },
];

export function SettingsView({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("categories");
  return (
    <Sheet onClose={onClose} width={840} actions={<Button kind="primary" onClick={onClose}>Chiudi</Button>}>
      <div className="settings">
        <div className="settings-nav">
          <div className="title2">Impostazioni</div>
          {tabs.map((item) => (
            <div key={item.id} className={`side-row ${tab === item.id ? "selected" : ""}`} onClick={() => setTab(item.id)}>
              <Icon icon={item.icon} />
              <span className="truncate">{item.title}</span>
            </div>
          ))}
        </div>
        <div className="settings-page" key={tab}>
          {tab === "categories" && <CategoriesSettings />}
          {tab === "exceptions" && <ExceptionsSettings />}
          {tab === "chat" && <ChatSettings />}
          {tab === "backup" && <BackupSettings />}
          {tab === "engine" && <EngineSettings />}
          {tab === "updates" && <UpdateSettings />}
        </div>
      </div>
    </Sheet>
  );
}

type SettingsJSON = ReturnType<AnonymizationSettings["toJSON"]>;

/// Cambia una copia delle impostazioni (in JSON) e la salva: le impostazioni non si modificano mai sul posto.
function changeSettings(body: (json: SettingsJSON) => void) {
  const json = structuredClone(model.settings.toJSON());
  body(json);
  // La classe delle impostazioni dal valore che c'è (il renderer non importa valori da `src/core`).
  const Settings = model.settings.constructor as typeof AnonymizationSettings;
  model.settings = Settings.fromJSON(json);
}

/// Le categorie che diventano segnaposto.
function CategoriesSettings() {
  useObserved(model);
  const settings = model.settings;
  const defaults = PIICategory.defaultHidden;
  const isDefault = settings.hidden.size === defaults.size && [...defaults].every((label) => settings.hidden.has(label)) && settings.maskKnownValues;

  const group = (title: string, note: string, labels: readonly string[]) => (
    <FormSection header={title} footer={note}>
      <FormRow>
        <div className="check-grid">
          {labels.map((label) => (
            <Toggle
              key={label}
              checked={settings.hidden.has(label)}
              onChange={(on) => changeSettings((json) => {
                json.hidden = on ? [...new Set([...json.hidden, label])] : json.hidden.filter((item) => item !== label);
              })}
            >
              {PIICategory.title(label)}
            </Toggle>
          ))}
        </div>
      </FormRow>
    </FormSection>
  );

  return (
    <>
      {group("Dati personali", "Dicono chi è una persona o danno accesso ai suoi conti.", PIICategory.personal)}
      {group("Aziende", "I nomi di aziende nei testi, compresi i tuoi clienti: di serie si nascondono.", PIICategory.companies)}
      {group("Dati di lavoro", "Di serie restano in chiaro: servono all'AI per conti, scadenze e confronti.", PIICategory.workingData)}
      <FormSection footer="Un nome trovato nel primo paragrafo non resta in chiaro nel quinto. I nomi di una parola sola restano fuori.">
        <FormRow>
          <Toggle checked={settings.maskKnownValues} onChange={(on) => changeSettings((json) => (json.maskKnownValues = on))}>
            Nascondi anche i dati già nel dizionario che il motore non riconosce in un testo
          </Toggle>
        </FormRow>
      </FormSection>
      <FormSection>
        <FormRow>
          <Button
            disabled={isDefault}
            onClick={() => changeSettings((json) => {
              json.hidden = [...PIICategory.defaultHidden];
              json.maskKnownValues = true;
            })}
          >
            Ripristina le scelte predefinite
          </Button>
        </FormRow>
      </FormSection>
    </>
  );
}

function LabelPicker({ value, onChange }: { value: string; onChange: (label: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label="Categoria">
      {ForcedTermInfo.labels.map((label) => <option key={label} value={label}>{ForcedTermInfo.title(label)}</option>)}
    </select>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button icon={CircleMinus} kind="plain" iconOnly onClick={onClick}>Rimuovi</Button>
  );
}

/// Le eccezioni alle regole del motore: «nascondi sempre» (quello che non riconosce da solo) e «mai nascondere» (nomi
/// che devono restare in chiaro, come la tua agenzia).
function ExceptionsSettings() {
  useObserved(model);
  const settings = model.settings;
  const [newForced, setNewForced] = useState("");
  const [forcedLabel, setForcedLabel] = useState("ORG");
  const [newException, setNewException] = useState("");

  const addForced = () => {
    const value = newForced.trim();
    if (value.length === 0) return;
    const id = ForcedTermInfo.id(value);
    changeSettings((json) => {
      // Una parola sola in un elenco: se c'era già, cambia solo la categoria.
      const index = json.forcedTerms.findIndex((term) => ForcedTermInfo.id(term.value) === id);
      if (index >= 0) json.forcedTerms[index] = { value, label: forcedLabel };
      else json.forcedTerms.push({ value, label: forcedLabel });
      // Nascondere e lasciare in chiaro la stessa parola non ha senso: vince l'ultima scelta.
      json.exceptions = json.exceptions.filter((exception) => ForcedTermInfo.id(exception) !== id);
    });
    setNewForced("");
  };

  const addException = () => {
    const value = newException.trim();
    if (value.length === 0 || settings.exceptions.includes(value)) return;
    const id = ForcedTermInfo.id(value);
    changeSettings((json) => {
      json.exceptions.push(value);
      json.forcedTerms = json.forcedTerms.filter((term) => ForcedTermInfo.id(term.value) !== id);
    });
    setNewException("");
  };

  return (
    <>
      <FormSection
        header="Nascondi sempre"
        footer="Nomi che il motore non riconosce da solo, per esempio un'attività dal nome vago. Diventano un segnaposto ovunque compaiano, senza badare a maiuscole e spazi, e tornano veri quando riconverti."
      >
        {settings.forcedTerms.map((term) => (
          <FormRow key={term.id}>
            <span className="truncate selectable">{term.value}</span>
            <span className="spacer" />
            <LabelPicker
              value={term.label}
              onChange={(label) => changeSettings((json) => {
                const index = json.forcedTerms.findIndex((item) => ForcedTermInfo.id(item.value) === term.id);
                if (index >= 0) json.forcedTerms[index].label = label;
              })}
            />
            <RemoveButton onClick={() => changeSettings((json) => {
              json.forcedTerms = json.forcedTerms.filter((item) => ForcedTermInfo.id(item.value) !== term.id);
            })} />
          </FormRow>
        ))}
        <FormRow>
          <form className="row" style={{ flex: 1 }} onSubmit={(event) => { event.preventDefault(); addForced(); }}>
            <input type="text" value={newForced} onChange={(event) => setNewForced(event.target.value)} placeholder="Per esempio «On Location»" style={{ flex: 1 }} />
            <LabelPicker value={forcedLabel} onChange={setForcedLabel} />
            <Button type="submit" disabled={newForced.trim().length === 0}>Aggiungi</Button>
          </form>
        </FormRow>
      </FormSection>

      <FormSection
        header="Mai nascondere"
        footer="Si confrontano senza badare a maiuscole, spazi e forma societaria: «Studio Alfa» vale anche per «STUDIO ALFA S.r.l.»."
      >
        {settings.exceptions.map((exception) => (
          <FormRow key={exception}>
            <span className="truncate selectable">{exception}</span>
            <span className="spacer" />
            <RemoveButton onClick={() => changeSettings((json) => (json.exceptions = json.exceptions.filter((item) => item !== exception)))} />
          </FormRow>
        ))}
        <FormRow>
          <form className="row" style={{ flex: 1 }} onSubmit={(event) => { event.preventDefault(); addException(); }}>
            <input type="text" value={newException} onChange={(event) => setNewException(event.target.value)} placeholder="Per esempio il nome della tua agenzia" style={{ flex: 1 }} />
            <Button type="submit" disabled={newException.trim().length === 0}>Aggiungi</Button>
          </form>
        </FormRow>
      </FormSection>
    </>
  );
}

/// Dove gira il motore e dove sta il dizionario.
function EngineSettings() {
  useObserved(model);
  const engine = model.engineState;
  const vault = model.vaultState;
  const engineStatus = engine.kind === "loading" ? "In preparazione…" : engine.kind === "ready" ? "Pronto"
    : engine.kind === "missing" ? "Assente: esegui npm run motore e ricompila" : engine.message;
  const protection = vault.kind === "opening" ? "…"
    : vault.kind === "ready" ? `Cifrato (AES-GCM) · chiave custodita da: ${describeProtection(vault.protection)}` : vault.message;
  return (
    <>
      <FormSection header="Motore di anonimizzazione">
        <LabeledContent label="Stato">{engineStatus}</LabeledContent>
        <LabeledContent label="Dove gira">Solo su questo PC: nessun testo viene inviato</LabeledContent>
      </FormSection>
      <FormSection header="Dizionario">
        <LabeledContent label="Voci">{model.vault.count}</LabeledContent>
        <LabeledContent label="Protezione">{protection}</LabeledContent>
        <LabeledContent label="Cartella">
          <Button onClick={() => model.showVaultInFinder()}>Mostra in Esplora file</Button>
        </LabeledContent>
      </FormSection>
    </>
  );
}

/// La chat con GPT: Codex, modello e ragionamento.
function ChatSettings() {
  return (
    <>
      <FormSection
        header="Il tuo account ChatGPT"
        footer="Ognuno collega il proprio abbonamento ChatGPT, sul proprio PC. La chat usa Codex di OpenAI: se manca, l'app lo installa al primo collegamento."
      >
        <FormRow style={{ display: "block" }}>
          <ChatGPTConnectView />
        </FormRow>
      </FormSection>
      <FormSection
        footer="Si possono scegliere solo i modelli delle famiglie terra, luna e sol dalla versione 6 in poi, fra quelli che il tuo abbonamento vede in Codex. Più ragionamento vuol dire risposte più curate ma più lente."
      >
        <ChatModelPicker />
      </FormSection>
      <FormSection header="Cosa esce dal PC">
        <InfoRow icon={EyeOff}>Domanda, allegati e conversazione precedente partono solo dopo il motore di anonimizzazione, sempre con i segnaposto.</InfoRow>
        <InfoRow icon={ShieldCheck}>Codex parte isolato: senza strumenti, senza ricerca sul web, in sola lettura e in una cartella vuota.</InfoRow>
        <InfoRow icon={LockKeyhole}>Le conversazioni restano cifrate su questo PC ed entrano nella copia di sicurezza.</InfoRow>
      </FormSection>
    </>
  );
}

function InfoRow({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <FormRow style={{ alignItems: "flex-start" }}>
      <Icon icon={icon} style={{ marginTop: 2, flexShrink: 0 }} />
      <span style={{ lineHeight: 1.45 }}>{children}</span>
    </FormRow>
  );
}

/// Il modello di GPT e il suo ragionamento: solo terra, luna e sol dalla versione 6.
export function ChatModelPicker() {
  useObserved(model);
  const chat = useObserved(model.chat);
  const models = chat.models;
  const current = model.chatModel;
  const effort = model.chatEffort ?? "";
  if (models.length === 0) {
    return (
      <LabeledContent label="Modello">
        {chat.codexStatus === null ? "Leggo i modelli…" : "Nessun modello disponibile: collega il tuo account ChatGPT"}
      </LabeledContent>
    );
  }
  return (
    <>
      <FormRow>
        <span>Modello</span>
        <span className="spacer" />
        <select value={current?.slug ?? ""} onChange={(event) => model.chooseChatModel(event.target.value)}>
          {models.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
        </select>
      </FormRow>
      {current && current.efforts.length > 0 && (
        <FormRow>
          <span>Ragionamento</span>
          <span className="spacer" />
          <select value={current.efforts.includes(effort) ? effort : ""} onChange={(event) => model.chooseChatEffort(event.target.value || null)}>
            <option value="">Predefinito{current.defaultEffort ? ` (${effortTitle(current.defaultEffort).toLowerCase()})` : ""}</option>
            {current.efforts.map((level) => <option key={level} value={level}>{effortTitle(level)}</option>)}
          </select>
        </FormRow>
      )}
    </>
  );
}
