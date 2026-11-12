import { useState } from "react";
import { Building2, Plus } from "lucide-react";
import type { Company, CompanyStatus } from "../../core/crm/crmModel";
import { CRMRoute } from "../../shared/navigation";
import { Format } from "../../shared/format";
import { Button, EmptyState, SearchField, Toolbar } from "../ui/components";
import { useObserved } from "../ui/observe";
import { Badge, useContextMenu, useNavigation } from "./components";
import { CompanyEditor } from "./editors";
import { CompanyStatuses, isOpen, newCompany, statusColor, statusTitle, sum } from "./helpers";

const model = () => window.anonimaiker.model;

/// L'elenco delle aziende: un clic seleziona, doppio clic apre la scheda.
export function CompaniesView() {
  const app = useObserved(model());
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CompanyStatus | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [editing, setEditing] = useState<Company | null>(null);
  const [openMenu, menu] = useContextMenu();
  const crm = app.crm;

  const query = search.trim().toLowerCase();
  const companies = crm.sortedCompanies.filter((company) =>
    (status === null || company.status === status) &&
    (query.length === 0 || [company.name, company.city, company.sector, company.vatNumber].some((value) => value.toLowerCase().includes(query))));

  const openAmount = (company: Company) => sum(crm.dealsOf(company.id).filter((deal) => isOpen(deal.stage)).map((deal) => deal.amount));
  const open = (id: string) => navigation?.push(CRMRoute.company(id));

  return (
    <div className="content">
      <Toolbar title="Aziende" subtitle={crm.companies.length === 0 ? "" : String(crm.companies.length)}>
        <SearchField value={search} onChange={setSearch} placeholder="Cerca nome, città, settore o partita IVA" width={280} />
        <select
          value={status ?? ""}
          onChange={(event) => setStatus(event.target.value === "" ? null : (event.target.value as CompanyStatus))}
          title="Filtra per stato"
          style={{ marginLeft: 6 }}
        >
          <option value="">Tutte</option>
          {CompanyStatuses.map((value) => <option key={value} value={value}>{statusTitle(value)}</option>)}
        </select>
        <Button icon={Plus} kind="plain" iconOnly onClick={() => setEditing(newCompany())} disabled={!app.isVaultReady}>Nuova azienda</Button>
      </Toolbar>
      {crm.companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nessuna azienda"
          message="Le aziende trovate nei documenti del progetto arrivano qui da sole. Puoi aggiungerne a mano: i dati restano su questo PC, cifrati."
        >
          <Button kind="primary" onClick={() => setEditing(newCompany())}>Nuova azienda</Button>
        </EmptyState>
      ) : (
        <div className="crm-table">
          <table className="grid">
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Azienda</th>
                <th style={{ width: 120 }}>Stato</th>
                <th style={{ width: 130 }}>Città</th>
                <th style={{ width: 80 }}>Contatti</th>
                <th style={{ width: 140 }}>Trattative aperte</th>
                <th style={{ width: 90 }}>Documenti</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr
                  key={company.id}
                  className={selection === company.id ? "selected" : ""}
                  onClick={() => setSelection(company.id)}
                  onDoubleClick={() => open(company.id)}
                  onContextMenu={(event) => {
                    setSelection(company.id);
                    openMenu(event, [
                      { label: "Apri la scheda", onClick: () => open(company.id) },
                      { label: "Modifica…", onClick: () => setEditing(company) },
                    ]);
                  }}
                >
                  <td>
                    <div className="col" style={{ gap: 2 }}>
                      <span style={{ fontWeight: 600 }}>{company.name}</span>
                      {company.sector.length > 0 && <span className="caption secondary">{company.sector}</span>}
                    </div>
                  </td>
                  <td><Badge text={statusTitle(company.status)} color={statusColor(company.status)} /></td>
                  <td>{company.city}</td>
                  <td className="digits">{crm.contactsOf(company.id).length}</td>
                  <td className="digits">{Format.amount(openAmount(company))}</td>
                  <td className="digits">{crm.documentsOf(company.id).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {menu}
      {editing && <CompanyEditor company={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
