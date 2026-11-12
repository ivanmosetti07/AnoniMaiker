import { useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import type { Activity, ActivityKind, Company, CompanyStatus, Contact, Deal, DealStage } from "../../core/crm/crmModel";
import { Button, Icon, Sheet, Toggle } from "../ui/components";
import { useObserved } from "../ui/observe";
import { ValidityNote } from "./components";
import {
  ActivityKinds, CompanyStatuses, DealStages, Validators, addingDays, addingMonths, compareNames, dateInputValue, dateTimeInputValue,
  defaultProbability, fullName, kindTitle, parseDateInput, parseDateTimeInput, stageTitle, statusTitle, trimSpaces, trimWhitespace,
} from "./helpers";

// MARK: - Le schede di modifica (fogli)
//
// Ogni foglio lavora su una copia: «Salva» la scrive nel CRM cifrato, «Annulla» la butta.

const model = () => window.anonimaiker.model;

/// Lo scheletro comune: titolo, modulo, Annulla e Salva.
function EditorSheet({ title, canSave, save, onClose, children }: {
  title: string;
  canSave: boolean;
  save: () => Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  const submit = async () => {
    if (!canSave) return;
    await save();
    onClose();
  };
  return (
    <Sheet
      onClose={onClose}
      width={540}
      actions={
        <>
          <Button onClick={onClose} title="Annulla (Esc)">Annulla</Button>
          <Button kind="primary" onClick={() => void submit()} disabled={!canSave} title="Salva (Invio)">Salva</Button>
        </>
      }
    >
      <form
        className="crm-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="crm-editor-title">{title}</div>
        {children}
        {/* Invio in un campo di testo salva, come il pulsante predefinito del Mac. */}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/// Una sezione del modulo (`Section` di un `Form` raggruppato).
function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div>
      {title && <div className="crm-section-title">{title}</div>}
      <div className="crm-section">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="crm-field">
      <span className="l">{label}</span>
      {children}
    </label>
  );
}

function TextField({ label, value, onChange, prompt }: { label: string; value: string; onChange: (value: string) => void; prompt?: string }) {
  return (
    <Field label={label}>
      <input type="text" value={value} placeholder={prompt} onChange={(event) => onChange(event.target.value)} spellCheck={false} />
    </Field>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div className="crm-note">{children}</div>;
}

function TextEditor({ value, onChange, minHeight = 80, placeholder }: { value: string; onChange: (value: string) => void; minHeight?: number; placeholder?: string }) {
  return (
    <div className="crm-field wide">
      <textarea value={value} onChange={(event) => onChange(event.target.value)} style={{ minHeight }} placeholder={placeholder} spellCheck={false} />
    </div>
  );
}

function Picker<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </Field>
  );
}

/// Un menu che sceglie un id (o nessuno).
function IDPicker({ label, value, none, options, onChange }: {
  label: string;
  value: string | null;
  none: string;
  options: { id: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  return (
    <Field label={label}>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}>
        <option value="">{none}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </Field>
  );
}

/// Un menu per scegliere un'azienda (anche «Nessuna»).
export function CompanyPicker({ title, selection, onChange }: { title: string; selection: string | null; onChange: (id: string | null) => void }) {
  const app = useObserved(model());
  return (
    <IDPicker label={title} value={selection} none="Nessuna" options={app.companyChoices.map((company) => ({ id: company.id, label: company.name }))} onChange={onChange} />
  );
}

function DateField({ label, value, onChange }: { label: string; value: Date; onChange: (value: Date) => void }) {
  return (
    <Field label={label}>
      <input
        type="date"
        value={dateInputValue(value)}
        onChange={(event) => {
          const date = parseDateInput(event.target.value, value);
          if (date) onChange(date);
        }}
      />
    </Field>
  );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="crm-field">
      <span className="l">{label}</span>
      <span style={{ justifySelf: "end" }}>
        <Toggle checked={checked} onChange={onChange}>{""}</Toggle>
      </span>
    </div>
  );
}

// MARK: Azienda

export function CompanyEditor({ company: initial, onClose }: { company: Company; onClose: () => void }) {
  const [company, setCompany] = useState(initial);
  const set = <K extends keyof Company>(key: K) => (value: Company[K]) => setCompany((c) => ({ ...c, [key]: value }));
  return (
    <EditorSheet
      title={company.name.length === 0 ? "Nuova azienda" : company.name}
      canSave={trimSpaces(company.name).length > 0}
      save={() => model().saveCompany(company)}
      onClose={onClose}
    >
      <Section title="Azienda">
        <TextField label="Ragione sociale" value={company.name} onChange={set("name")} prompt="Edilnord S.r.l." />
        <Picker<CompanyStatus>
          label="Stato"
          value={company.status}
          options={CompanyStatuses.map((status) => ({ value: status, label: statusTitle(status) }))}
          onChange={set("status")}
        />
        <TextField label="Settore" value={company.sector} onChange={set("sector")} />
      </Section>
      <Section title="Dati fiscali">
        <TextField label="Partita IVA" value={company.vatNumber} onChange={set("vatNumber")} />
        <ValidityRow value={company.vatNumber} isValid={Validators.isValidVATNumber} message="La cifra di controllo della partita IVA non torna" />
        <TextField label="Codice fiscale" value={company.taxCode} onChange={set("taxCode")} />
        <ValidityRow value={company.taxCode} isValid={Validators.isValidTaxCode} message="Il codice fiscale non sembra valido" />
        <TextField label="IBAN" value={company.iban} onChange={set("iban")} />
        <ValidityRow value={company.iban} isValid={Validators.isValidIBAN} message="Il codice di controllo dell'IBAN non torna" />
      </Section>
      <Section title="Recapiti">
        <TextField label="Email" value={company.email} onChange={set("email")} />
        <TextField label="PEC" value={company.pec} onChange={set("pec")} />
        <TextField label="Telefono" value={company.phone} onChange={set("phone")} />
        <TextField label="Sito web" value={company.website} onChange={set("website")} />
      </Section>
      <Section title="Sede">
        <TextField label="Via e numero civico" value={company.street} onChange={set("street")} />
        <TextField label="CAP" value={company.zipCode} onChange={set("zipCode")} />
        <TextField label="Città" value={company.city} onChange={set("city")} />
        <TextField label="Provincia" value={company.province} onChange={set("province")} prompt="MI" />
      </Section>
      <Section title="Note">
        <TextEditor value={company.notes} onChange={set("notes")} minHeight={80} />
      </Section>
    </EditorSheet>
  );
}

function ValidityRow(props: { value: string; isValid: (value: string) => boolean; message: string }) {
  if (props.value.trim().length === 0 || props.isValid(props.value)) return null;
  return <Note><ValidityNote {...props} /></Note>;
}

// MARK: Contatto

export function ContactEditor({ contact: initial, onClose }: { contact: Contact; onClose: () => void }) {
  const [contact, setContact] = useState(initial);
  const set = <K extends keyof Contact>(key: K) => (value: Contact[K]) => setContact((c) => ({ ...c, [key]: value }));
  const name = fullName(contact);
  return (
    <EditorSheet title={name.length === 0 ? "Nuovo contatto" : name} canSave={name.length > 0} save={() => model().saveContact(contact)} onClose={onClose}>
      <Section title="Persona">
        <TextField label="Nome" value={contact.firstName} onChange={set("firstName")} />
        <TextField label="Cognome" value={contact.lastName} onChange={set("lastName")} />
        <TextField label="Ruolo" value={contact.role} onChange={set("role")} prompt="Direttore acquisti" />
        <CompanyPicker title="Azienda" selection={contact.companyID} onChange={set("companyID")} />
      </Section>
      <Section title="Recapiti">
        <TextField label="Email" value={contact.email} onChange={set("email")} />
        <ValidityRow value={contact.email} isValid={Validators.isValidEmail} message="L'indirizzo email non sembra valido" />
        <TextField label="Telefono" value={contact.phone} onChange={set("phone")} />
        <TextField label="Cellulare" value={contact.mobile} onChange={set("mobile")} />
      </Section>
      <Section title="Dati personali">
        <TextField label="Codice fiscale" value={contact.taxCode} onChange={set("taxCode")} />
        <ValidityRow value={contact.taxCode} isValid={Validators.isValidTaxCode} message="Il codice fiscale non sembra valido" />
      </Section>
      <Section title="Note">
        <TextEditor value={contact.notes} onChange={set("notes")} minHeight={70} />
      </Section>
    </EditorSheet>
  );
}

// MARK: Trattativa

const amountNumber = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/// «12.500,00» → 12500; null se vuoto o illeggibile.
function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[€\s]/g, "").replace(/EUR/gi, "").replace(/\./g, "").replace(",", ".");
  if (cleaned.length === 0) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/// L'importo in euro (`TextField` con formato valuta): 0 o vuoto vale «nessun importo».
function AmountField({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : amountNumber.format(value));
  return (
    <Field label="Importo">
      <span className="row" style={{ gap: 6 }}>
        <input
          type="text"
          value={text}
          placeholder="0,00"
          style={{ flex: 1, textAlign: "right" }}
          className="digits"
          onChange={(event) => {
            setText(event.target.value);
            const amount = parseAmount(event.target.value);
            onChange(amount === 0 ? null : amount);
          }}
          onBlur={() => {
            const amount = parseAmount(text);
            setText(amount === null || amount === 0 ? "" : amountNumber.format(amount));
          }}
        />
        <span className="secondary">€</span>
      </span>
    </Field>
  );
}

function Stepper({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; step: number }) {
  return (
    <div className="crm-field">
      <span className="l" style={{ gridColumn: "1 / span 1", whiteSpace: "nowrap" }}>{label}</span>
      <span className="row" style={{ justifySelf: "end", gap: 0 }}>
        <button type="button" className="btn small" style={{ borderRadius: "5px 0 0 5px" }} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} title="Meno">
          <Icon icon={Minus} size={12} />
        </button>
        <button type="button" className="btn small" style={{ borderRadius: "0 5px 5px 0", marginLeft: -1 }} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))} title="Più">
          <Icon icon={Plus} size={12} />
        </button>
      </span>
    </div>
  );
}

export function DealEditor({ deal: initial, onClose }: { deal: Deal; onClose: () => void }) {
  const app = useObserved(model());
  const [deal, setDeal] = useState(initial);
  const set = <K extends keyof Deal>(key: K) => (value: Deal[K]) => setDeal((d) => ({ ...d, [key]: value }));
  const contacts = deal.companyID !== null
    ? app.crm.contactsOf(deal.companyID)
    : [...app.crm.contacts].sort((a, b) => compareNames(fullName(a), fullName(b)));
  return (
    <EditorSheet
      title={deal.title.length === 0 ? "Nuova trattativa" : deal.title}
      canSave={trimSpaces(deal.title).length > 0}
      save={() => model().saveDeal(deal)}
      onClose={onClose}
    >
      <Section title="Trattativa">
        <TextField label="Titolo" value={deal.title} onChange={set("title")} prompt="Nuovo sito web" />
        <CompanyPicker title="Azienda" selection={deal.companyID} onChange={(id) => setDeal((d) => ({ ...d, companyID: id, contactID: null }))} />
        <IDPicker
          label="Referente"
          value={deal.contactID}
          none="Nessuno"
          options={contacts.map((contact) => ({ id: contact.id, label: fullName(contact) }))}
          onChange={set("contactID")}
        />
      </Section>
      <Section title="Andamento">
        <Picker<DealStage>
          label="Fase"
          value={deal.stage}
          options={DealStages.map((stage) => ({ value: stage, label: stageTitle(stage) }))}
          onChange={(stage) => setDeal((d) => ({ ...d, stage, probability: defaultProbability(stage) }))}
        />
        <AmountField value={deal.amount} onChange={set("amount")} />
        <Stepper label={`Probabilità: ${deal.probability}%`} value={deal.probability} onChange={set("probability")} min={0} max={100} step={5} />
        <ToggleField
          label="Data di chiusura prevista"
          checked={deal.expectedClose !== null}
          onChange={(on) => setDeal((d) => ({ ...d, expectedClose: on ? (d.expectedClose ?? addingMonths(1)) : null }))}
        />
        {deal.expectedClose !== null && <DateField label="Chiusura prevista" value={deal.expectedClose} onChange={set("expectedClose")} />}
      </Section>
      <Section title="Note">
        <TextEditor value={deal.notes} onChange={set("notes")} minHeight={70} />
      </Section>
    </EditorSheet>
  );
}

// MARK: Attività

export function ActivityEditor({ activity: initial, onClose }: { activity: Activity; onClose: () => void }) {
  const app = useObserved(model());
  const [activity, setActivity] = useState(initial);
  const set = <K extends keyof Activity>(key: K) => (value: Activity[K]) => setActivity((a) => ({ ...a, [key]: value }));
  return (
    <EditorSheet
      title={kindTitle(activity.kind)}
      canSave={trimWhitespace(activity.text).length > 0}
      save={() => model().saveActivity(activity)}
      onClose={onClose}
    >
      <Section>
        <Picker<ActivityKind>
          label="Tipo"
          value={activity.kind}
          options={ActivityKinds.map((kind) => ({ value: kind, label: kindTitle(kind) }))}
          onChange={set("kind")}
        />
        <TextEditor value={activity.text} onChange={set("text")} minHeight={110} />
        <Field label="Data">
          <input
            type="datetime-local"
            value={dateTimeInputValue(activity.date)}
            onChange={(event) => {
              const date = parseDateTimeInput(event.target.value);
              if (date) set("date")(date);
            }}
          />
        </Field>
        {activity.kind === "task" && (
          <>
            <ToggleField label="Scadenza" checked={activity.due !== null} onChange={(on) => setActivity((a) => ({ ...a, due: on ? (a.due ?? addingDays(1)) : null }))} />
            {activity.due !== null && <DateField label="Entro il" value={activity.due} onChange={set("due")} />}
            <ToggleField label="Fatta" checked={activity.isDone} onChange={set("isDone")} />
          </>
        )}
      </Section>
      <Section title="Collegamenti">
        <CompanyPicker title="Azienda" selection={activity.companyID} onChange={set("companyID")} />
        {activity.companyID !== null && (
          <>
            <IDPicker
              label="Contatto"
              value={activity.contactID}
              none="Nessuno"
              options={app.crm.contactsOf(activity.companyID).map((contact) => ({ id: contact.id, label: fullName(contact) }))}
              onChange={set("contactID")}
            />
            <IDPicker
              label="Trattativa"
              value={activity.dealID}
              none="Nessuna"
              options={app.crm.dealsOf(activity.companyID).map((deal) => ({ id: deal.id, label: deal.title }))}
              onChange={set("dealID")}
            />
          </>
        )}
      </Section>
    </EditorSheet>
  );
}
