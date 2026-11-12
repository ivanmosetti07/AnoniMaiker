import { useEffect, useRef, useState } from "react";
import {
  ChevronsUpDown, CircleCheck, Folder, HardDrive, HardDriveDownload, LayoutGrid, Lock, LockKeyhole, MessagesSquare, Pencil, Plus,
  Settings, ShieldAlert, TriangleAlert,
} from "lucide-react";
import { ActivitiesView, CompaniesSection, ContactsView, DealsView, DocumentsSection } from "./crm";
import { ChatPanel } from "./chat";
import { Alert, Button, Icon, Label, MenuButton, Spinner, type MenuEntry } from "./ui/components";
import { useObserved } from "./ui/observe";
import { AppSection } from "../shared/navigation";
import { Format } from "../shared/format";
import { describeProtection, isOpenStage, isOverdue, sectionIcon } from "./helpers";
import { WorkspaceView } from "./views/WorkspaceView";
import { ProjectNameSheet, ProjectsView, type ProjectNaming } from "./views/ProjectsView";
import { DictionaryView } from "./views/DictionaryView";
import { GuideView } from "./views/GuideView";
import { BackupExportSheet, BackupRestoreSheet } from "./views/BackupViews";
import { SettingsView } from "./views/SettingsView";
import { UpdateSheet } from "./views/UpdateViews";
import { AboutSheet } from "./views/AboutSheet";
import logotipo from "./assets/logotipo.svg";
import logotipoNegativo from "./assets/logotipo-negativo.svg";

// MARK: - La finestra (ContentView.swift)
//
// A sinistra la barra laterale, al centro la sezione del progetto aperto (o l'elenco dei progetti), a destra la chat,
// larga quanto si vuole trascinando il bordo. Sopra, le finestre dell'app: guida, copia di sicurezza, impostazioni,
// aggiornamenti, «Informazioni su» e gli avvisi.

const { model } = window.anonimaiker;

export function App() {
  useObserved(model);
  const updates = useObserved(model.updates);
  const showsChat = model.showsChat && model.hasProject;

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <DataBanner />
        <div className="detail">
          {model.hasProject ? <Detail key={model.currentProjectID ?? ""} /> : <ProjectsView />}
          {model.hasProject && (
            <div className="chat-toggle">
              <Button
                icon={MessagesSquare}
                kind="plain"
                iconOnly
                className={showsChat ? "on" : ""}
                onClick={() => (model.showsChat = !model.showsChat)}
                title={`${showsChat ? "Nascondi la chat" : "Chat con GPT"} · Chat con GPT sui documenti del progetto (Ctrl+J)`}
              >
                {showsChat ? "Nascondi la chat" : "Chat con GPT"}
              </Button>
            </div>
          )}
        </div>
      </div>
      {showsChat && <ChatColumn />}

      {model.showsSettings && <SettingsView onClose={() => (model.showsSettings = false)} />}
      {model.showsAbout && <AboutSheet onClose={() => (model.showsAbout = false)} />}
      {model.showsGuide && <GuideView />}
      {updates.isPresented && <UpdateSheet />}
      {model.backupStep?.kind === "export" && <BackupExportSheet />}
      {model.backupStep?.kind === "restore" && <BackupRestoreSheet path={model.backupStep.path} key={model.backupStep.path} />}
      {model.alert !== null && <Alert title="Attenzione" message={model.alert} onClose={() => (model.alert = null)} />}
    </div>
  );
}

/// La sezione scelta nella barra laterale.
function Detail() {
  switch (model.section) {
    case "anonymize": return <WorkspaceView space={model.anonymizeSpace} key="anonymize" />;
    case "reveal": return <WorkspaceView space={model.revealSpace} key="reveal" />;
    case "documents": return <DocumentsSection />;
    case "companies": return <CompaniesSection />;
    case "people": return <ContactsView />;
    case "deals": return <DealsView />;
    case "activities": return <ActivitiesView />;
    case "dictionary": return <DictionaryView />;
  }
}

// MARK: - Barra laterale

/// La barra laterale: il progetto aperto (e il menu per cambiarlo), le sue sezioni, lo stato e le impostazioni.
function Sidebar() {
  useObserved(model);
  const crm = model.crm;
  const row = (section: AppSection, count = 0, alert = false) => (
    <div
      key={section}
      className={`side-row ${model.section === section ? "selected" : ""}`}
      onClick={() => (model.section = section)}
    >
      <Icon icon={sectionIcon(section)} />
      <span className="truncate">{AppSection.title(section)}</span>
      {count > 0 && <span className={`count ${alert ? "alert" : ""}`}>{count}</span>}
    </div>
  );
  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <picture>
          <source srcSet={logotipoNegativo} media="(prefers-color-scheme: dark)" />
          <img src={logotipo} alt="AnoniMaiker" />
        </picture>
      </div>
      <ProjectSwitcher />
      <div className="sidebar-list">
        {model.hasProject ? (
          <>
            <div className="side-section">Lavora</div>
            {row("anonymize")}
            {row("reveal")}
            {row("documents", crm.documents.length)}
            <div className="side-section">CRM del progetto</div>
            {row("people", crm.contacts.length)}
            {row("companies", crm.companies.length)}
            {row("deals", crm.deals.filter((deal) => isOpenStage(deal.stage)).length)}
            {row("activities", crm.openTasks.length, crm.openTasks.some((task) => isOverdue(task)))}
            <div className="side-section">Archivio</div>
            {row("dictionary", model.vault.count)}
          </>
        ) : (
          <div className="sidebar-note">
            Apri un progetto o creane uno nuovo: dentro trovi anonimizzatore, riconvertitore, documenti e CRM.
          </div>
        )}
      </div>
      <div className="divider" />
      <StatusFooter />
      <div className="settings-link">
        <Button icon={Settings} kind="plain" onClick={() => (model.showsSettings = true)} title="Impostazioni di AnoniMaiker (Ctrl+,)">
          Impostazioni
        </Button>
      </div>
    </div>
  );
}

/// In cima alla barra laterale: il progetto aperto, con il menu per cambiarlo, crearne uno o tornare all'elenco.
function ProjectSwitcher() {
  useObserved(model);
  const [naming, setNaming] = useState<ProjectNaming | null>(null);
  const project = model.currentProject;
  const items: MenuEntry[] = [
    ...model.projects.map((item) => ({
      label: item.name,
      checked: item.id === model.currentProjectID,
      onClick: () => void model.selectProject(item.id),
    })),
    ...(model.projects.length > 0 ? [{ separator: true }] : []),
    { label: "Nuovo progetto…", icon: Plus, onClick: () => setNaming({ kind: "create" }) },
    ...(project ? [{ label: `Rinomina «${project.name}»…`, icon: Pencil, onClick: () => setNaming({ kind: "rename", project }) }] : []),
    { separator: true },
    { label: "Tutti i progetti", icon: LayoutGrid, onClick: () => void model.showProjects() },
  ];
  return (
    <>
      <MenuButton
        className="switcher-wrap"
        disabled={!model.isVaultReady}
        items={items}
        label={
          <div className={`project-switcher ${model.isVaultReady ? "" : "disabled"}`}>
            <Icon icon={Folder} color="var(--accent)" size={16} style={{ fill: "var(--accent)", flexShrink: 0 }} />
            <div className="col" style={{ gap: 1, minWidth: 0, flex: 1 }}>
              <span className="headline truncate">{project?.name ?? "Nessun progetto aperto"}</span>
              <span className="caption secondary">{model.hasProject ? "Progetto" : "Scegli o crea un progetto"}</span>
            </div>
            <Icon icon={ChevronsUpDown} size={13} color="var(--secondary)" />
          </div>
        }
      />
      {naming && <ProjectNameSheet naming={naming} onClose={() => setNaming(null)} />}
    </>
  );
}

/// In fondo alla barra laterale: il motore, la protezione dei dati e l'ultima copia di sicurezza.
function StatusFooter() {
  useObserved(model);
  const engine = model.engineState;
  const vault = model.vaultState;
  const hasData = !model.vault.isEmpty || !model.crm.isEmpty;
  const last = model.lastBackup;
  return (
    <div className="status-footer">
      {engine.kind === "loading" && (
        <div className="row" style={{ gap: 6 }}>
          <Spinner mini />
          <span className="secondary">Preparo il motore…</span>
        </div>
      )}
      {engine.kind === "ready" && (
        <span className="label">
          <Icon icon={CircleCheck} size={13} color="var(--green)" />
          <span className="truncate">Motore pronto, sul PC</span>
        </span>
      )}
      {engine.kind === "missing" && <Label icon={TriangleAlert} color="var(--orange)">Motore assente</Label>}
      {engine.kind === "failed" && <Label icon={TriangleAlert} color="var(--orange)" title={engine.message}>Motore non avviato</Label>}

      {vault.kind === "opening" && <Label icon={Lock}>Apro i dati…</Label>}
      {vault.kind === "ready" && (
        <Label icon={LockKeyhole} title={`Chiave custodita da: ${describeProtection(vault.protection)}`}>
          {vault.protection === "secureEnclave" ? "Dati cifrati · Secure Enclave" : "Dati cifrati"}
        </Label>
      )}
      {vault.kind === "failed" && <Label icon={ShieldAlert} color="var(--red)" title={vault.message}>Dati non aperti</Label>}

      <button
        className="plainlink"
        disabled={!model.isVaultReady}
        onClick={() => model.startExport()}
        title="Crea una copia di sicurezza protetta da password"
      >
        {last ? (
          <Label icon={HardDrive}>Copia: {Format.date(last)}</Label>
        ) : (
          <Label icon={HardDriveDownload} color={hasData ? "var(--orange)" : undefined}>Nessuna copia di sicurezza</Label>
        )}
      </button>
    </div>
  );
}

/// Il banner quando i dati cifrati non si aprono (per esempio su un PC nuovo). Da CRMComponents.swift.
export function DataBanner() {
  useObserved(model);
  const state = model.vaultState;
  if (state.kind !== "failed") return null;
  return (
    <div className="banner red">
      <Icon icon={ShieldAlert} />
      <div style={{ flex: 1 }} className="selectable">{state.message}</div>
      <Button onClick={() => void model.startRestore()}>Ripristina una copia…</Button>
    </div>
  );
}

// MARK: - La chat a destra

const chatWidthKey = "chat.larghezza";
const clampedChatWidth = (width: number) => Math.min(Math.max(width, 300), 640);

/// La colonna della chat a destra, larga quanto si vuole trascinando il bordo.
function ChatColumn() {
  const [width, setWidth] = useState(() => {
    const saved = model.preferences.object(chatWidthKey);
    return clampedChatWidth(typeof saved === "number" ? saved : 380);
  });
  const drag = useRef<{ x: number; width: number } | null>(null);
  const latest = useRef(width);
  latest.current = width;

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!drag.current) return;
      setWidth(clampedChatWidth(drag.current.width - (event.clientX - drag.current.x)));
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = "";
      model.preferences.set(chatWidthKey, latest.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  return (
    <div className="chat-column" style={{ width }}>
      <div
        className="chat-resizer"
        onPointerDown={(event) => {
          event.preventDefault();
          drag.current = { x: event.clientX, width };
          document.body.style.cursor = "ew-resize";
        }}
      />
      <div className="chat-body">
        <ChatPanel />
      </div>
    </div>
  );
}
