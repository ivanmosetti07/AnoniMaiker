import { useState } from "react";
import {
  Building2, ChevronDown, CircleDollarSign, EyeOff, FilePlus, FileText, NotebookPen, Pencil, Plus, ShieldCheck, Trash2, Users,
} from "lucide-react";
import type { Activity, ActivityKind, Company, Contact, Deal } from "../../core/crm/crmModel";
import { CRMRoute } from "../../shared/navigation";
import { Format } from "../../shared/format";
import { Alert, Button, EmptyState, Icon, MenuButton, Segmented, Toolbar } from "../ui/components";
import { useObserved } from "../ui/observe";
import {
  ActivityRow, BackButton, Badge, DealRow, DetailRow, DocumentRow, DropOverlay, GroupBox, useContextMenu, useFileDrop, useNavigation,
} from "./components";
import { DossierSheet } from "./documentDetail";
import { ActivityEditor, CompanyEditor, ContactEditor, DealEditor } from "./editors";
import {
  ActivityKinds, Validators, addingDays, companyAddress, fullName, isOpen, kindTitle, newActivity, newContact, newDeal, statusColor,
  statusTitle, sum, trimSpaces, trimWhitespace, vaultEntriesCount,
} from "./helpers";

const model = () => window.anonimaiker.model;

type Tab = "overview" | "documents" | "activities" | "deals";

/// La scheda del cliente: anagrafica e contatti, documenti, note e attività, trattative.
export function CompanyDetailView({ companyID }: { companyID: string }) {
  const app = useObserved(model());
  const company = app.crm.company(companyID);
  if (!company) {
    return (
      <div className="content">
        <Toolbar title="" leading={<BackButton />} />
        <EmptyState icon={Building2} title="Cliente non trovato" />
      </div>
    );
  }
  return <CompanyContent company={company} />;
}

function CompanyContent({ company }: { company: Company }) {
  const app = useObserved(model());
  const crm = app.crm;
  const [tab, setTab] = useState<Tab>("overview");
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [showingDossier, setShowingDossier] = useState(false);
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);

  const title = (value: Tab): string => {
    switch (value) {
      case "overview": return "Panoramica";
      case "documents": return `Documenti (${crm.documentsOf(company.id).length})`;
      case "activities": return `Note e attività (${crm.activitiesOf(company.id).length})`;
      case "deals": return `Trattative (${crm.dealsOf(company.id).length})`;
    }
  };
  const tabs: Tab[] = ["overview", "documents", "activities", "deals"];

  return (
    <div className="content">
      <Toolbar title={company.name} leading={<BackButton />}>
        <Button
          icon={EyeOff}
          kind="plain"
          iconOnly
          onClick={() => setShowingDossier(true)}
          title="Scheda anonimizzata: il cliente in un testo anonimizzato, pronto per l'AI"
          disabled={app.engineState.kind === "missing" || !app.isVaultReady}
        >
          Scheda anonimizzata
        </Button>
        <MenuButton
          align="right"
          label={
            <button className="btn plain" title="Aggiungi">
              <Icon icon={Plus} /> <Icon icon={ChevronDown} size={11} />
            </button>
          }
          items={[
            { label: "Contatto…", onClick: () => setEditingContact(newContact(company.id)) },
            { label: "Documenti…", onClick: () => void app.chooseDocuments(company.id) },
            { label: "Nota o attività…", onClick: () => setEditingActivity(newActivity("note", "", company.id)) },
            { label: "Trattativa…", onClick: () => setEditingDeal(newDeal(company.id)) },
          ]}
        />
        <Button icon={Pencil} kind="plain" iconOnly onClick={() => setEditingCompany(company)}>Modifica</Button>
        <Button icon={Trash2} kind="plain" iconOnly onClick={() => setConfirmingDeletion(true)}>Elimina…</Button>
      </Toolbar>
      <CompanyHeader company={company} />
      <div style={{ padding: "0 20px 12px" }}>
        <Segmented value={tab} options={tabs.map((value) => ({ value, label: title(value) }))} onChange={setTab} />
      </div>
      <div className="divider" />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {tab === "overview" && <OverviewTab company={company} editContact={setEditingContact} />}
        {tab === "documents" && <DocumentsTab company={company} />}
        {tab === "activities" && <ActivitiesTab company={company} edit={setEditingActivity} />}
        {tab === "deals" && <DealsTab company={company} edit={setEditingDeal} />}
      </div>
      {editingCompany && <CompanyEditor company={editingCompany} onClose={() => setEditingCompany(null)} />}
      {editingContact && <ContactEditor contact={editingContact} onClose={() => setEditingContact(null)} />}
      {editingDeal && <DealEditor deal={editingDeal} onClose={() => setEditingDeal(null)} />}
      {editingActivity && <ActivityEditor activity={editingActivity} onClose={() => setEditingActivity(null)} />}
      {showingDossier && <DossierSheet companyID={company.id} onClose={() => setShowingDossier(false)} />}
      {confirmingDeletion && (
        <Alert
          title={`Togliere ${company.name} dal CRM?`}
          message="Persone, trattative, attività e documenti restano nel progetto, senza questa azienda. Il dizionario non cambia."
          onClose={() => setConfirmingDeletion(false)}
          actions={
            <>
              <Button onClick={() => setConfirmingDeletion(false)}>Annulla</Button>
              <Button
                kind="destructive"
                onClick={() => {
                  setConfirmingDeletion(false);
                  void app.deleteCompany(company.id);
                }}
              >
                Togli l'azienda
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

/// In cima alla scheda: nome, stato e numeri dell'azienda.
function CompanyHeader({ company }: { company: Company }) {
  const app = useObserved(model());
  const crm = app.crm;
  const openAmount = sum(crm.dealsOf(company.id).filter((deal) => isOpen(deal.stage)).map((deal) => deal.amount));
  const color = statusColor(company.status);
  return (
    <div className="crm-header">
      <div className="crm-avatar" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${color} 80%, white), ${color})` }}>
        <Icon icon={Building2} size={22} />
      </div>
      <div className="col" style={{ gap: 4, minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="title truncate">{company.name}</span>
          <Badge text={statusTitle(company.status)} color={color} />
        </div>
        <span className="secondary truncate">
          {[company.sector, company.city, company.vatNumber.length === 0 ? "" : `P.IVA ${company.vatNumber}`].filter((part) => part.length > 0).join(" · ")}
        </span>
      </div>
      <div className="spacer" />
      <Stat value={String(crm.contactsOf(company.id).length)} label="contatti" />
      <Stat value={Format.amount(openAmount)} label="in trattativa" />
      <Stat value={String(vaultEntriesCount(app.vault, company.id))} label="voci nel dizionario" />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="crm-stat">
      <span className="v">{value}</span>
      <span className="caption secondary">{label}</span>
    </div>
  );
}

// MARK: - Panoramica

function OverviewTab({ company, editContact }: { company: Company; editContact: (contact: Contact) => void }) {
  const app = useObserved(model());
  const [openMenu, menu] = useContextMenu();
  const contacts = app.crm.contactsOf(company.id);
  const rows: [string, string, boolean | null][] = ([
    ["Partita IVA", company.vatNumber, company.vatNumber.length === 0 ? null : Validators.isValidVATNumber(company.vatNumber)],
    ["Codice fiscale", company.taxCode, company.taxCode.length === 0 ? null : Validators.isValidTaxCode(company.taxCode)],
    ["Sede", companyAddress(company), null],
    ["Email", company.email, null],
    ["PEC", company.pec, null],
    ["Telefono", company.phone, null],
    ["Sito", company.website, null],
    ["IBAN", company.iban, company.iban.length === 0 ? null : Validators.isValidIBAN(company.iban)],
  ] as [string, string, boolean | null][]).filter((row) => row[1].length > 0);

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div className="col" style={{ gap: 18, padding: 20 }}>
        <div className="row" style={{ gap: 18, alignItems: "flex-start" }}>
          <GroupBox icon={Building2} title="Anagrafica">
            {rows.length === 0 ? (
              <span className="secondary">Nessun dato: aggiungili con Modifica.</span>
            ) : (
              <div className="crm-detail-grid">
                {rows.map((row) => <DetailRow key={row[0]} title={row[0]} value={row[1]} valid={row[2]} />)}
              </div>
            )}
          </GroupBox>
          <GroupBox icon={Users} title="Contatti">
            <div className="col" style={{ gap: 10, alignItems: "stretch" }}>
              {contacts.length === 0 && <span className="secondary">Nessun contatto.</span>}
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="col"
                  style={{ gap: 2, cursor: "default" }}
                  onClick={() => editContact(contact)}
                  onContextMenu={(event) =>
                    openMenu(event, [
                      { label: "Modifica…", onClick: () => editContact(contact) },
                      { label: "Elimina", destructive: true, onClick: () => void app.deleteContact(contact.id) },
                    ])
                  }
                >
                  <span className="row" style={{ gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>{fullName(contact)}</span>
                    {contact.role.length > 0 && <span className="secondary">{contact.role}</span>}
                  </span>
                  <span className="caption secondary">
                    {[contact.email, contact.mobile.length === 0 ? contact.phone : contact.mobile].filter((part) => part.length > 0).join(" · ")}
                  </span>
                </div>
              ))}
              <span>
                <Button icon={Plus} kind="link" onClick={() => editContact(newContact(company.id))}>Nuovo contatto</Button>
              </span>
            </div>
          </GroupBox>
        </div>
        {company.notes.length > 0 && (
          <GroupBox icon={NotebookPen} title="Note">
            <div className="selectable" style={{ whiteSpace: "pre-wrap" }}>{company.notes}</div>
          </GroupBox>
        )}
        <GroupBox icon={ShieldCheck} title="Privacy">
          <div className="row" style={{ gap: 12 }}>
            <span className="secondary" style={{ flex: 1 }}>
              {vaultEntriesCount(app.vault, company.id)} dati di questo cliente sono nel dizionario: nei testi anonimizzati diventano segnaposto e tornano veri riconvertendo.
            </span>
            <Button onClick={() => app.showDictionary(company.id)}>Mostra nel dizionario</Button>
          </div>
        </GroupBox>
      </div>
      {menu}
    </div>
  );
}

// MARK: - Documenti

function DocumentsTab({ company }: { company: Company }) {
  const app = useObserved(model());
  const navigation = useNavigation();
  const [openMenu, menu] = useContextMenu();
  const documents = app.crm.documentsOf(company.id);
  const drop = useFileDrop((paths) => void app.addDocuments(paths, company.id));

  return (
    <div className="crm-dropzone" {...drop.handlers}>
      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nessun documento"
          message="Trascina qui i file del cliente (testo, Markdown, CSV, Excel, Word, PDF), o aggiungili con il pulsante. Restano cifrati su questo PC; da qui li anonimizzi e riconverti le risposte dell'AI."
        >
          <Button onClick={() => void app.chooseDocuments(company.id)}>Aggiungi documenti…</Button>
        </EmptyState>
      ) : (
        <>
          <div className="crm-list">
            {documents.map((document) => (
              <div
                key={document.id}
                className="list-row"
                onClick={() => navigation?.push(CRMRoute.document(document.id))}
                onContextMenu={(event) =>
                  openMenu(event, [
                    { label: "Anonimizza", onClick: () => void app.anonymizeDocument(document.id), disabled: app.engineState.kind === "missing" },
                    { separator: true },
                    { label: "Elimina", destructive: true, onClick: () => void app.deleteDocument(document.id) },
                  ])
                }
              >
                <DocumentRow document={document} />
              </div>
            ))}
          </div>
          <div className="crm-bottombar">
            <span className="caption secondary">Trascina qui altri file: testo, CSV, Excel, Word, PDF</span>
            <div className="spacer" />
            <Button icon={FilePlus} onClick={() => void app.chooseDocuments(company.id)}>Aggiungi documenti…</Button>
          </div>
        </>
      )}
      <DropOverlay visible={drop.targeted} />
      {menu}
    </div>
  );
}

// MARK: - Note e attività

function ActivitiesTab({ company, edit }: { company: Company; edit: (activity: Activity) => void }) {
  const app = useObserved(model());
  const [openMenu, menu] = useContextMenu();
  const [kind, setKind] = useState<ActivityKind>("note");
  const [text, setText] = useState("");
  const activities = app.crm.activitiesOf(company.id);

  const add = () => {
    const value = trimWhitespace(text);
    if (value.length === 0) return;
    const activity = newActivity(kind, value, company.id);
    if (kind === "task") activity.due = addingDays(1);
    setText("");
    void app.saveActivity(activity);
  };

  return (
    <>
      <form
        className="row"
        style={{ gap: 8, padding: 12 }}
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <select value={kind} onChange={(event) => setKind(event.target.value as ActivityKind)} style={{ width: 140 }} title="Tipo">
          {ActivityKinds.map((value) => <option key={value} value={value}>{kindTitle(value)}</option>)}
        </select>
        <input
          type="text"
          style={{ flex: 1 }}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={kind === "task" ? "Cosa c'è da fare?" : "Scrivi una nota, l'esito di una chiamata, una riunione…"}
        />
        <Button type="submit" disabled={trimSpaces(text).length === 0}>Aggiungi</Button>
      </form>
      <div className="divider" />
      {activities.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="Nessuna nota o attività"
          message="Scrivi qui sopra: chiamate, riunioni, cose da fare. Entrano anche nella scheda anonimizzata."
        />
      ) : (
        <div className="crm-list">
          {activities.map((activity) => (
            <div
              key={activity.id}
              className="list-row"
              style={{ alignItems: "flex-start" }}
              onDoubleClick={() => edit(activity)}
              onContextMenu={(event) =>
                openMenu(event, [
                  { label: "Modifica…", onClick: () => edit(activity) },
                  { label: "Elimina", destructive: true, onClick: () => void app.deleteActivity(activity.id) },
                ])
              }
            >
              <ActivityRow activity={activity} />
            </div>
          ))}
        </div>
      )}
      {menu}
    </>
  );
}

// MARK: - Trattative

function DealsTab({ company, edit }: { company: Company; edit: (deal: Deal) => void }) {
  const app = useObserved(model());
  const [openMenu, menu] = useContextMenu();
  const deals = app.crm.dealsOf(company.id);
  if (deals.length === 0) {
    return (
      <EmptyState icon={CircleDollarSign} title="Nessuna trattativa" message="Preventivi e opportunità del cliente, con importo, fase e probabilità.">
        <Button onClick={() => edit(newDeal(company.id))}>Nuova trattativa</Button>
      </EmptyState>
    );
  }
  return (
    <>
      <div className="crm-list">
        {deals.map((deal) => (
          <div
            key={deal.id}
            className="list-row"
            onDoubleClick={() => edit(deal)}
            onContextMenu={(event) =>
              openMenu(event, [
                { label: "Modifica…", onClick: () => edit(deal) },
                { label: "Elimina", destructive: true, onClick: () => void app.deleteDeal(deal.id) },
              ])
            }
          >
            <DealRow deal={deal} />
          </div>
        ))}
      </div>
      <div className="crm-bottombar">
        <div className="spacer" />
        <Button icon={Plus} onClick={() => edit(newDeal(company.id))}>Nuova trattativa</Button>
      </div>
      {menu}
    </>
  );
}
