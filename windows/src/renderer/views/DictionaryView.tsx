import { useEffect, useMemo, useState } from "react";
import { BookA, ChevronDown, ChevronUp, Eye, EyeOff, LockKeyhole, Trash2 } from "lucide-react";
import type { VaultEntry } from "../../core/dizionario/vault";
import { Alert, Button, EmptyState, SearchField, Toolbar } from "../ui/components";
import { useObserved } from "../ui/observe";
import { Format } from "../../shared/format";
import { PIICategory, capitalizedFirst, describeProtection } from "../helpers";
import { useContextMenu } from "./parts";

// MARK: - Il dizionario (DictionaryView.swift)
//
// Il dizionario unico: segnaposto, categoria e valore vero (nascosto finché non lo chiedi).

const { model } = window.anonimaiker;

type Field = "placeholder" | "category" | "value" | "lastUsed";

const collator = new Intl.Collator("it-IT", { numeric: true, sensitivity: "base" });

/// Ordinamento delle colonne del dizionario (EntryComparator).
function compare(field: Field, lhs: VaultEntry, rhs: VaultEntry): number {
  switch (field) {
    // Ordine naturale: categoria, poi numero («[FULLNAME_2]» prima di «[FULLNAME_10]»).
    case "placeholder": return lhs.label !== rhs.label ? (lhs.label < rhs.label ? -1 : 1) : lhs.number - rhs.number;
    case "category": return collator.compare(PIICategory.name(lhs.label, 1), PIICategory.name(rhs.label, 1));
    case "value": return collator.compare(lhs.value, rhs.value);
    case "lastUsed": return lhs.lastUsed.getTime() - rhs.lastUsed.getTime();
  }
}

export function DictionaryView() {
  useObserved(model);
  const [search, setSearch] = useState("");
  const [showValues, setShowValues] = useState(false);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [sort, setSort] = useState<{ field: Field; reverse: boolean }>({ field: "placeholder", reverse: false });
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  useEffect(() => {
    void model.refreshVault();
  }, []);

  const vault = model.vault;
  const entries = useMemo(() => {
    const query = search.trim().toLowerCase();
    const all = model.dictionaryClient ? vault.entriesOf(model.dictionaryClient) : vault.entries;
    const filtered = query.length === 0 ? all : all.filter((entry) =>
      entry.placeholder.toLowerCase().includes(query) || entry.value.toLowerCase().includes(query)
      || PIICategory.name(entry.label, 1).includes(query));
    const sorted = [...filtered].sort((a, b) => compare(sort.field, a, b));
    return sort.reverse ? sorted.reverse() : sorted;
  }, [vault, search, sort, model.dictionaryClient]);

  /// «Edilnord S.r.l., Bianchi Bike».
  const clients = (entry: VaultEntry) => {
    const names = [...entry.clients].map((id) => model.crm.company(id)?.name).filter((name): name is string => !!name).sort(collator.compare);
    return names.length === 0 ? "—" : names.join(", ");
  };

  const select = (event: React.MouseEvent, id: string) => {
    if (event.shiftKey && anchor) {
      const ids = entries.map((entry) => entry.id);
      const [from, to] = [ids.indexOf(anchor), ids.indexOf(id)].sort((a, b) => a - b);
      if (from >= 0) {
        setSelection(new Set(ids.slice(from, to + 1)));
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelection(next);
    } else {
      setSelection(new Set([id]));
    }
    setAnchor(id);
  };

  const copy = (text: string) => model.copy(text);
  const menuItems = (ids: string[]) => {
    const entry = ids.length === 1 ? vault.entry(ids[0]) : null;
    return [
      ...(entry
        ? [
            { label: "Copia segnaposto", onClick: () => copy(entry.placeholder) },
            { label: "Copia valore vero", onClick: () => copy(entry.value) },
            { separator: true },
          ]
        : []),
      { label: "Elimina…", destructive: true, disabled: ids.length === 0, onClick: () => setConfirmingRemoval(true) },
    ];
  };
  const menu = useContextMenu(() => menuItems([...selection]));

  const header = (field: Field | null, title: string, width?: number) => (
    <th
      className={field ? "sortable" : ""}
      style={{ width }}
      onClick={() => field && setSort(sort.field === field ? { field, reverse: !sort.reverse } : { field, reverse: false })}
    >
      <span className="row" style={{ gap: 4 }}>
        {title}
        {field && sort.field === field && (sort.reverse ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
      </span>
    </th>
  );

  return (
    <div className="content">
      <Toolbar title="Dizionario" subtitle={vault.isEmpty ? undefined : `${vault.count} voci`}>
        <SearchField value={search} onChange={setSearch} placeholder="Cerca segnaposto, valore o categoria" width={250} />
        <select
          value={model.dictionaryClient ?? ""}
          onChange={(event) => (model.dictionaryClient = event.target.value || null)}
          title="Mostra solo le voci di un cliente"
          style={{ marginLeft: 6, maxWidth: 180 }}
        >
          <option value="">Tutti i clienti</option>
          {model.companyChoices.map((company) => (
            <option key={company.id} value={company.id}>{company.name}</option>
          ))}
        </select>
        <Button
          icon={showValues ? Eye : EyeOff}
          kind="plain"
          className={showValues ? "on" : ""}
          onClick={() => setShowValues(!showValues)}
          title={showValues ? "Nascondi i valori veri" : "Mostra i valori veri"}
        >
          {showValues ? "Nascondi valori" : "Mostra valori"}
        </Button>
        <Button icon={Trash2} kind="plain" onClick={() => setConfirmingRemoval(true)} disabled={selection.size === 0}>Elimina…</Button>
      </Toolbar>

      {vault.isEmpty ? (
        <EmptyState icon={BookA} title="Il dizionario è vuoto" message="Anonimizza un testo: i dati nascosti e i loro segnaposto compariranno qui." />
      ) : (
        <div className="dictionary" onClick={(event) => event.target === event.currentTarget && setSelection(new Set())}>
          <table className="grid">
            <thead>
              <tr>
                {header("placeholder", "Segnaposto", 170)}
                {header("category", "Categoria", 140)}
                {header("value", "Valore vero")}
                {header(null, "Clienti", 170)}
                {header("lastUsed", "Ultimo uso", 160)}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className={selection.has(entry.id) ? "selected" : ""}
                  onMouseDown={(event) => event.button === 0 && select(event, entry.id)}
                  onContextMenu={(event) => {
                    // Il clic destro fuori dalla selezione seleziona la riga cliccata.
                    const ids = selection.has(entry.id) ? [...selection] : [entry.id];
                    if (!selection.has(entry.id)) setSelection(new Set(ids));
                    setAnchor(entry.id);
                    menu.open(event, menuItems(ids));
                  }}
                >
                  <td className="mono">{entry.placeholder}</td>
                  <td>{capitalizedFirst(PIICategory.name(entry.label, 1))}</td>
                  <td className={showValues ? "selectable" : "tertiary"}>{showValues ? entry.value : "••••••••"}</td>
                  <td className="secondary" title={clients(entry)}>{clients(entry)}</td>
                  <td className="secondary">{Format.dateTime(entry.lastUsed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {menu.element}

      <div className="footerbar">
        <LockKeyhole size={13} />
        {model.vaultState.kind === "ready" ? (
          <span className="truncate">Cifrato sul PC · chiave custodita da: {describeProtection(model.vaultState.protection)}</span>
        ) : (
          <span>Dizionario non aperto</span>
        )}
        <span className="spacer" />
        <Button kind="link" onClick={() => model.showVaultInFinder()}>Mostra in Esplora file</Button>
      </div>

      {confirmingRemoval && selection.size > 0 && (
        <Alert
          title={`Eliminare ${selection.size === 1 ? "questa voce" : `${selection.size} voci`} dal dizionario?`}
          message="I file che usano questi segnaposto non potranno più riavere i dati veri. I numeri non verranno riusati."
          onClose={() => setConfirmingRemoval(false)}
          actions={
            <>
              <Button onClick={() => setConfirmingRemoval(false)}>Annulla</Button>
              <Button
                kind="destructive"
                onClick={() => {
                  const removed = [...selection];
                  setSelection(new Set());
                  setConfirmingRemoval(false);
                  void model.remove(removed);
                }}
              >
                Elimina
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
