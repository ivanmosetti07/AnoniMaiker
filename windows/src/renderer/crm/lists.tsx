import { useState } from "react";
import { CircleCheck, CircleDollarSign, NotebookPen, Plus, Users } from "lucide-react";
import type { Activity, Contact, Deal } from "../../core/crm/crmModel";
import { Format } from "../../shared/format";
import { Button, EmptyState, SearchField, Segmented, Toolbar } from "../ui/components";
import { useObserved } from "../ui/observe";
import { ActivityRow, DealRow, useContextMenu } from "./components";
import { ActivityEditor, ContactEditor, DealEditor } from "./editors";
import { compareNames, fullName, isOpen, newActivity, newContact, newDeal, sum, weightedAmount } from "./helpers";

// MARK: - Persone, trattative e attività del progetto

const model = () => window.anonimaiker.model;

export function ContactsView() {
  const app = useObserved(model());
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [openMenu, menu] = useContextMenu();
  const crm = app.crm;

  const query = search.trim().toLowerCase();
  const contacts = crm.contacts
    .filter((contact) =>
      query.length === 0 ||
      [fullName(contact), contact.email, contact.role, crm.company(contact.companyID)?.name ?? ""].some((value) => value.toLowerCase().includes(query)))
    .sort((a, b) => compareNames(fullName(a), fullName(b)));

  return (
    <div className="content">
      <Toolbar title="Persone" subtitle={crm.contacts.length === 0 ? "" : String(crm.contacts.length)}>
        <SearchField value={search} onChange={setSearch} placeholder="Cerca nome, email, ruolo o azienda" width={280} />
        <Button icon={Plus} kind="plain" iconOnly onClick={() => setEditing(newContact())} disabled={!app.isVaultReady}>Nuova persona</Button>
      </Toolbar>
      {crm.contacts.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nessuna persona"
          message="Le persone trovate nei documenti del progetto arrivano qui da sole, con email e telefoni. Il CRM le conosce, quindi si nascondono anche dove il motore non le vede."
        >
          <Button onClick={() => setEditing(newContact())}>Nuova persona</Button>
        </EmptyState>
      ) : (
        <div className="crm-table">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: "22%" }}>Nome</th>
                <th>Ruolo</th>
                <th>Azienda</th>
                <th>Email</th>
                <th>Telefono</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr
                  key={contact.id}
                  className={selection === contact.id ? "selected" : ""}
                  onClick={() => setSelection(contact.id)}
                  onDoubleClick={() => setEditing(contact)}
                  onContextMenu={(event) => {
                    setSelection(contact.id);
                    openMenu(event, [
                      { label: "Modifica…", onClick: () => setEditing(contact) },
                      ...(contact.companyID !== null ? [{ label: "Apri l'azienda", onClick: () => app.openCompany(contact.companyID) }] : []),
                      { separator: true },
                      { label: "Elimina", destructive: true, onClick: () => void app.deleteContact(contact.id) },
                    ]);
                  }}
                >
                  <td style={{ fontWeight: 600 }}>{fullName(contact)}</td>
                  <td>{contact.role}</td>
                  <td>{crm.company(contact.companyID)?.name ?? "—"}</td>
                  <td className="selectable">{contact.email}</td>
                  <td className="digits">{contact.mobile.length === 0 ? contact.phone : contact.mobile}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {menu}
      {editing && <ContactEditor contact={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

type DealFilter = "open" | "won" | "lost" | "all";

const dealFilters: { value: DealFilter; label: string }[] = [
  { value: "open", label: "Aperte" },
  { value: "won", label: "Vinte" },
  { value: "lost", label: "Perse" },
  { value: "all", label: "Tutte" },
];

const farFuture = Number.MAX_SAFE_INTEGER;

export function DealsView() {
  const app = useObserved(model());
  const [filter, setFilter] = useState<DealFilter>("open");
  const [editing, setEditing] = useState<Deal | null>(null);
  const [openMenu, menu] = useContextMenu();
  const crm = app.crm;

  const deals = crm.deals
    .filter((deal) => {
      switch (filter) {
        case "open": return isOpen(deal.stage);
        case "won": return deal.stage === "won";
        case "lost": return deal.stage === "lost";
        case "all": return true;
      }
    })
    // Dalla chiusura prevista più vicina; a pari data, la modificata più di recente.
    .sort((a, b) => (a.expectedClose?.getTime() ?? farFuture) - (b.expectedClose?.getTime() ?? farFuture) || b.updated.getTime() - a.updated.getTime());

  const open = crm.deals.filter((deal) => isOpen(deal.stage));
  const summary = {
    open: sum(open.map((deal) => deal.amount)) ?? 0,
    weighted: sum(open.map(weightedAmount)) ?? 0,
    won: sum(crm.deals.filter((deal) => deal.stage === "won").map((deal) => deal.amount)) ?? 0,
  };

  return (
    <div className="content">
      <Toolbar title="Trattative">
        <Button icon={Plus} kind="plain" iconOnly onClick={() => setEditing(newDeal())} disabled={!app.isVaultReady}>Nuova trattativa</Button>
      </Toolbar>
      <div className="row" style={{ gap: 28, padding: 16, background: "var(--bg)" }}>
        <Figure value={Format.amount(summary.open)} label="in trattative aperte" />
        <Figure value={Format.amount(summary.weighted)} label="pesato con la probabilità" />
        <Figure value={Format.amount(summary.won)} label="vinto" />
        <div className="spacer" />
        <Segmented value={filter} options={dealFilters} onChange={setFilter} />
      </div>
      <div className="divider" />
      {deals.length === 0 ? (
        <EmptyState
          icon={CircleDollarSign}
          title={filter === "open" ? "Nessuna trattativa aperta" : "Nessuna trattativa"}
          message={crm.companies.length === 0 ? "Le opportunità e i preventivi del progetto, con importo, fase e probabilità." : "Preventivi e opportunità dei tuoi clienti."}
        />
      ) : (
        <div className="crm-list">
          {deals.map((deal) => (
            <div
              key={deal.id}
              className="list-row"
              onDoubleClick={() => setEditing(deal)}
              onContextMenu={(event) =>
                openMenu(event, [
                  { label: "Modifica…", onClick: () => setEditing(deal) },
                  { label: "Apri l'azienda", onClick: () => app.openCompany(deal.companyID), disabled: deal.companyID === null },
                  { separator: true },
                  { label: "Elimina", destructive: true, onClick: () => void app.deleteDeal(deal.id) },
                ])
              }
            >
              <DealRow deal={deal} showCompany />
            </div>
          ))}
        </div>
      )}
      {menu}
      {editing && <DealEditor deal={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="crm-figure">
      <span className="v">{value}</span>
      <span className="caption secondary">{label}</span>
    </div>
  );
}

export function ActivitiesView() {
  const app = useObserved(model());
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [openMenu, menu] = useContextMenu();
  const crm = app.crm;

  const activities = showAll ? [...crm.activities].sort((a, b) => b.date.getTime() - a.date.getTime()) : crm.openTasks;

  return (
    <div className="content">
      <Toolbar title="Attività" subtitle={showAll ? "Tutte" : "Da fare"}>
        <Segmented
          value={showAll ? "all" : "todo"}
          options={[{ value: "todo", label: "Da fare" }, { value: "all", label: "Tutte" }]}
          onChange={(value) => setShowAll(value === "all")}
        />
        <Button icon={Plus} kind="plain" iconOnly onClick={() => setEditing(newActivity("task"))} disabled={!app.isVaultReady}>Nuova attività</Button>
      </Toolbar>
      {activities.length === 0 ? (
        <EmptyState
          icon={showAll ? NotebookPen : CircleCheck}
          title={showAll ? "Nessuna nota o attività" : "Niente da fare"}
          message={showAll ? "Note, chiamate, riunioni e cose da fare dei tuoi clienti." : "Le cose da fare di tutti i clienti compaiono qui, dalla scadenza più vicina."}
        />
      ) : (
        <div className="crm-list">
          {activities.map((activity) => (
            <div
              key={activity.id}
              className="list-row"
              style={{ alignItems: "flex-start" }}
              onDoubleClick={() => setEditing(activity)}
              onContextMenu={(event) =>
                openMenu(event, [
                  { label: "Modifica…", onClick: () => setEditing(activity) },
                  ...(activity.companyID !== null ? [{ label: "Apri l'azienda", onClick: () => app.openCompany(activity.companyID) }] : []),
                  { separator: true },
                  { label: "Elimina", destructive: true, onClick: () => void app.deleteActivity(activity.id) },
                ])
              }
            >
              <ActivityRow activity={activity} showCompany />
            </div>
          ))}
        </div>
      )}
      {menu}
      {editing && <ActivityEditor activity={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
