import { useEffect, useRef, useState } from "react";
import { Folder, FolderPlus, Plus } from "lucide-react";
import type { Project } from "../../core/progetti/projectStore";
import { Format } from "../../shared/format";
import { Alert, Button, Icon, Sheet } from "../ui/components";
import { useObserved } from "../ui/observe";
import { useContextMenu } from "./parts";

// MARK: - I progetti (ProjectsView.swift)

const { model } = window.anonimaiker;

/// Creare o rinominare un progetto.
export type ProjectNaming = { kind: "create" } | { kind: "rename"; project: Project };

/// L'elenco dei progetti: si apre uno o se ne crea uno nuovo.
export function ProjectsView() {
  useObserved(model);
  const [naming, setNaming] = useState<ProjectNaming | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);

  // Dalla guida (o dal menu): «Crea il primo progetto».
  useEffect(() => {
    if (!model.requestsNewProject) return;
    model.requestsNewProject = false;
    // Senza annullarlo: rimettere a false la richiesta ridisegna la vista.
    setTimeout(() => setNaming({ kind: "create" }), 400);
  }, [model.requestsNewProject]);

  return (
    <div className="projects">
      <div className="col" style={{ gap: 20 }}>
        <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
          <div className="col" style={{ gap: 4, flex: 1 }}>
            <span className="large-title">Progetti</span>
            <span className="secondary" style={{ lineHeight: 1.45 }}>
              Ogni progetto contiene i suoi documenti, il suo CRM e il suo dizionario: anonimizzi, riconverti e chiedi a GPT sempre dentro un progetto.
            </span>
          </div>
          <Button icon={Plus} kind="primary" onClick={() => setNaming({ kind: "create" })} shortcut="Ctrl+Shift+N" disabled={!model.isVaultReady}>
            Nuovo progetto
          </Button>
        </div>
        {model.projects.length === 0 ? (
          <div className="col" style={{ alignItems: "center", gap: 10, paddingTop: 60, textAlign: "center" }}>
            <Icon icon={FolderPlus} size={40} color="var(--secondary)" />
            <span className="title2" style={{ fontWeight: 400 }}>Nessun progetto</span>
            <span className="secondary">Crea il primo: per esempio il nome di un cliente, di un evento o di una pratica.</span>
          </div>
        ) : (
          <div className="projects-grid">
            {model.projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onRename={() => setNaming({ kind: "rename", project })}
                onDelete={() => setDeleting(project)}
              />
            ))}
          </div>
        )}
      </div>
      {naming && <ProjectNameSheet naming={naming} onClose={() => setNaming(null)} />}
      {deleting && (
        <Alert
          title="Eliminare il progetto?"
          message="Si cancellano da questo PC i suoi documenti, il CRM, il dizionario e le conversazioni. I file anonimizzati di questo progetto non si potranno più riconvertire."
          onClose={() => setDeleting(null)}
          actions={
            <>
              <Button onClick={() => setDeleting(null)}>Annulla</Button>
              <Button
                kind="destructive"
                onClick={() => {
                  const id = deleting.id;
                  setDeleting(null);
                  void model.deleteProject(id);
                }}
              >
                Elimina «{deleting.name}»
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

function ProjectCard({ project, onRename, onDelete }: { project: Project; onRename: () => void; onDelete: () => void }) {
  const menu = useContextMenu(() => [
    { label: "Apri", onClick: () => void model.selectProject(project.id) },
    { label: "Rinomina…", onClick: onRename },
    { separator: true },
    { label: "Elimina…", destructive: true, onClick: onDelete },
  ]);
  return (
    <>
      <div className="project-card" onClick={() => void model.selectProject(project.id)} onContextMenu={menu.open} title={project.name}>
        <Icon icon={Folder} size={26} color="var(--accent)" style={{ fill: "var(--accent)" }} />
        <span className="name">{project.name}</span>
        <span className="caption secondary">Aggiornato {Format.date(project.updated)}</span>
      </div>
      {menu.element}
    </>
  );
}

/// Il nome di un progetto nuovo, o il nuovo nome di uno che c'è.
export function ProjectNameSheet({ naming, onClose }: { naming: ProjectNaming; onClose: () => void }) {
  const isNew = naming.kind === "create";
  const [name, setName] = useState(naming.kind === "rename" ? naming.project.name : "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const trimmed = name.trim();

  const confirm = () => {
    if (trimmed.length === 0) return;
    if (naming.kind === "create") void model.createProject(trimmed);
    else void model.renameProject(naming.project.id, trimmed);
    onClose();
  };

  return (
    <Sheet
      onClose={onClose}
      width={420}
      actions={
        <>
          <Button onClick={onClose}>Annulla</Button>
          <Button kind="primary" onClick={confirm} disabled={trimmed.length === 0}>{isNew ? "Crea" : "Rinomina"}</Button>
        </>
      }
    >
      <form
        className="col"
        style={{ gap: 14 }}
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <span className="title2">{isNew ? "Nuovo progetto" : "Rinomina il progetto"}</span>
        <input
          ref={input}
          type="text"
          value={name}
          aria-label="Nome del progetto"
          placeholder="Per esempio: Evento Roma 2027"
          onChange={(event) => setName(event.target.value)}
        />
        <span className="caption secondary">Il nome resta sul PC. A GPT arriva anonimizzato, come i titoli dei documenti.</span>
      </form>
    </Sheet>
  );
}
