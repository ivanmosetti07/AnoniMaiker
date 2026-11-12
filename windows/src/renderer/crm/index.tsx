import { useMemo } from "react";
import type { CRMRoute } from "../../shared/navigation";
import { useObserved } from "../ui/observe";
import { CompaniesView } from "./companies";
import { CompanyDetailView } from "./companyDetail";
import { NavigationContext, type CRMNavigation } from "./components";
import { DocumentDetailView } from "./documentDetail";
import { DocumentsView } from "./documents";

// MARK: - Le sezioni del CRM
//
// Documenti e Aziende hanno la loro pila di navigazione (`NavigationStack` sul Mac): la vista legge il percorso del
// modello e mostra l'ultimo dettaglio, con «Indietro» in cima.

export { ActivitiesView, ContactsView, DealsView } from "./lists";

const model = () => window.anonimaiker.model;

type PathKey = "documentsPath" | "companiesPath";

function NavigationStack({ path, root }: { path: PathKey; root: () => React.ReactNode }) {
  const app = useObserved(model());
  const routes = app[path];
  const navigation = useMemo<CRMNavigation>(() => ({
    push: (route: CRMRoute) => {
      model()[path] = [...model()[path], route];
    },
    pop: () => {
      model()[path] = model()[path].slice(0, -1);
    },
  }), [path]);
  const top = routes.length > 0 ? routes[routes.length - 1] : null;
  return (
    <NavigationContext.Provider value={navigation}>
      {top === null ? root() : top.kind === "company" ? (
        <CompanyDetailView key={`c-${top.id}`} companyID={top.id} />
      ) : (
        <DocumentDetailView key={`d-${top.id}`} documentID={top.id} />
      )}
    </NavigationContext.Provider>
  );
}

/// La sezione Documenti: l'elenco dei documenti del progetto e i loro dettagli.
export function DocumentsSection() {
  return <NavigationStack path="documentsPath" root={() => <DocumentsView />} />;
}

/// La sezione Aziende: l'elenco, le schede dei clienti e i loro documenti.
export function CompaniesSection() {
  return <NavigationStack path="companiesPath" root={() => <CompaniesView />} />;
}
