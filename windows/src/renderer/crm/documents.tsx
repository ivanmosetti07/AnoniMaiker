import { useState } from "react";
import { FilePlus, Files } from "lucide-react";
import { CRMRoute } from "../../shared/navigation";
import { Button, EmptyState, SearchField, Toolbar } from "../ui/components";
import { useObserved } from "../ui/observe";
import { DocumentRow, DropOverlay, useContextMenu, useFileDrop, useNavigation } from "./components";
import { originalOf } from "./helpers";

const model = () => window.anonimaiker.model;

/// I documenti del progetto: ogni file con le sue versioni (originale, anonimizzato, risposte e modifiche dell'AI).
/// Un file trascinato qui si anonimizza da solo, e le persone trovate entrano nel CRM del progetto.
export function DocumentsView() {
  const app = useObserved(model());
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const [openMenu, menu] = useContextMenu();
  const drop = useFileDrop((paths) => void app.addDocuments(paths, null));
  const crm = app.crm;

  const all = [...crm.documents].sort((a, b) => b.updated.getTime() - a.updated.getTime());
  const query = search.trim().toLocaleLowerCase("it-IT");
  const documents = query.length === 0
    ? all
    : all.filter((document) =>
      document.title.toLocaleLowerCase("it-IT").includes(query) || (originalOf(document)?.fileName ?? "").toLocaleLowerCase("it-IT").includes(query));

  return (
    <div className="content">
      <Toolbar title="Documenti" subtitle={app.currentProject?.name ?? ""}>
        {crm.documents.length > 0 && <SearchField value={search} onChange={setSearch} placeholder="Cerca nei titoli" width={220} />}
        <Button
          icon={FilePlus}
          kind="plain"
          iconOnly
          onClick={() => void app.chooseDocuments(null)}
          disabled={!app.isVaultReady}
          title="Aggiungi file al progetto: si anonimizzano subito"
        >
          Aggiungi documenti…
        </Button>
      </Toolbar>
      <div className="crm-dropzone" {...drop.handlers}>
        {crm.documents.length === 0 ? (
          <EmptyState
            icon={Files}
            title="Nessun documento nel progetto"
            message="Trascina qui i file (testo, Markdown, CSV, Excel, Word, PDF) o aggiungili con il pulsante: si anonimizzano subito, restano cifrati su questo PC e le persone che contengono entrano nel CRM del progetto. Anche i file anonimizzati nel banco «Anonimizza» arrivano qui."
          >
            <Button onClick={() => void app.chooseDocuments(null)} disabled={!app.isVaultReady}>Aggiungi documenti…</Button>
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
                      { label: "Anonimizza di nuovo", onClick: () => void app.anonymizeDocument(document.id), disabled: app.engineState.kind === "missing" },
                      {
                        label: "Chiedi alla chat",
                        onClick: () => {
                          app.showsChat = true;
                          void app.attachDocument(document);
                        },
                      },
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
              <span className="caption secondary">Trascina qui altri file: si anonimizzano subito</span>
              <div className="spacer" />
              <Button icon={FilePlus} onClick={() => void app.chooseDocuments(null)}>Aggiungi documenti…</Button>
            </div>
          </>
        )}
        <DropOverlay visible={drop.targeted} />
      </div>
      {menu}
    </div>
  );
}
