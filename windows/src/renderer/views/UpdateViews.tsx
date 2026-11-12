import type { ReactNode } from "react";
import { BadgeCheck, CircleArrowDown, Settings2, TriangleAlert, type LucideIcon } from "lucide-react";
import type { AppRelease } from "../../core/aggiornamenti/updates";
import { Format } from "../../shared/format";
import { Button, Icon, ProgressBar, Sheet, Spinner, Toggle } from "../ui/components";
import { useObserved } from "../ui/observe";
import { UpdateLinks, byteCount } from "../helpers";
import { FormRow, FormSection, LabeledContent } from "./parts";

// MARK: - Aggiornamenti (UpdateViews.swift)

const { model, platform } = window.anonimaiker;

/// La finestra degli aggiornamenti: controllo, novità, download, errori.
export function UpdateSheet() {
  useObserved(model);
  const updates = useObserved(model.updates);
  const phase = updates.phase;
  const dismiss = () => (updates.isPresented = false);
  const sizeText = (release: AppRelease) => `Download di ${byteCount(release.installerSize)}.`;

  let body: ReactNode;
  let actions: ReactNode;
  switch (phase.kind) {
    case "idle":
    case "checking":
      body = (
        <div className="row" style={{ gap: 10 }}>
          <Spinner />
          <span>Controllo se c'è una nuova versione…</span>
        </div>
      );
      actions = <Button onClick={dismiss}>Chiudi</Button>;
      break;
    case "upToDate":
      body = <Header title="AnoniMaiker è aggiornata" detail={`Hai l'ultima versione, la ${model.appVersion}.`} icon={BadgeCheck} color="var(--green)" />;
      actions = <Button kind="primary" onClick={dismiss} shortcut="Enter">OK</Button>;
      break;
    case "available": {
      const release = phase.release;
      body = (
        <>
          <Header
            title={`È disponibile AnoniMaiker ${release.version}`}
            detail={`Hai la versione ${model.appVersion}. ${sizeText(release)}`}
            icon={CircleArrowDown}
            color="var(--accent)"
          />
          <Notes release={release} />
          <span className="callout secondary">I tuoi dati restano dove sono: si sostituisce solo l'app, che poi si riapre da sola.</span>
        </>
      );
      actions = (
        <>
          <div style={{ marginRight: "auto" }}>
            <Button onClick={() => model.skip(release)}>Salta questa versione</Button>
          </div>
          <Button onClick={dismiss}>Più tardi</Button>
          <Button kind="primary" onClick={() => void model.install(release)}>Installa e riavvia</Button>
        </>
      );
      break;
    }
    case "downloading":
      body = (
        <>
          <Header title={`Scarico AnoniMaiker ${phase.release.version}…`} detail={sizeText(phase.release)} icon={CircleArrowDown} color="var(--accent)" />
          <ProgressBar value={phase.progress} width={472} />
        </>
      );
      actions = <Button onClick={() => model.cancelUpdate()}>Annulla</Button>;
      break;
    case "installing":
      body = (
        <>
          <Header title={`Installo AnoniMaiker ${phase.release.version}…`} detail={phase.step} icon={Settings2} color="var(--accent)" />
          <Spinner />
        </>
      );
      actions = null;
      break;
    case "failed": {
      const release = phase.release;
      body = <Header title="Aggiornamento non riuscito" detail={phase.message} icon={TriangleAlert} color="var(--orange)" />;
      actions = (
        <>
          <div style={{ marginRight: "auto" }}>
            <Button onClick={() => model.openReleasePage(release)}>Pagina di download</Button>
          </div>
          <Button onClick={dismiss}>Chiudi</Button>
          {release && <Button kind="primary" onClick={() => void model.install(release)}>Riprova</Button>}
        </>
      );
      break;
    }
  }

  return (
    <Sheet onClose={updates.isBusy ? undefined : dismiss} width={520} actions={actions ?? undefined}>
      <div className="col" style={{ gap: 16 }}>{body}</div>
    </Sheet>
  );
}

function Header({ title, detail, icon, color }: { title: string; detail: string; icon: LucideIcon; color: string }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
      <Icon icon={icon} size={34} color={color} />
      <div className="col" style={{ gap: 4 }}>
        <span className="title2">{title}</span>
        <span className="secondary selectable" style={{ lineHeight: 1.45 }}>{detail}</span>
      </div>
    </div>
  );
}

/// Le note della release sono Markdown di GitHub: i titoli («## Novità») diventano grassetto, i trattini puntini.
export function readableNotes(notes: string): string {
  return notes.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      const title = trimmed.replace(/^#+/, "").trim();
      return title.length === 0 ? "" : `**${title}**`;
    }
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) return "• " + trimmed.slice(2);
    return line;
  }).join("\n");
}

/// Grassetto («**…**») e codice («`…`»), il resto com'è.
function inlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={index} className="mono">{part.slice(1, -1)}</code>;
    return part;
  });
}

function Notes({ release }: { release: AppRelease }) {
  if (release.notes.trim().length === 0) return null;
  return (
    <div
      className="selectable"
      style={{
        maxHeight: 220, overflow: "auto", padding: 10, whiteSpace: "pre-wrap", lineHeight: 1.45,
        background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8,
      }}
    >
      {inlineMarkdown(readableNotes(release.notes).trim())}
    </div>
  );
}

/// Impostazioni › Aggiornamenti.
export function UpdateSettings() {
  useObserved(model);
  const updates = useObserved(model.updates);
  return (
    <>
      <FormSection
        footer="Gli aggiornamenti arrivano dalle release del progetto su GitHub. L'app installa solo installatori firmati con la chiave del progetto; i tuoi dati non si toccano."
      >
        <LabeledContent label="Versione installata">{model.appVersion}</LabeledContent>
        <FormRow>
          <Toggle checked={updates.automatic} onChange={(value) => (updates.automatic = value)}>Controlla automaticamente ogni giorno</Toggle>
        </FormRow>
        <LabeledContent label="Ultimo controllo">{updates.lastCheck ? Format.dateTime(updates.lastCheck) : "mai"}</LabeledContent>
        <FormRow>
          <Button onClick={() => void model.checkForUpdates(true)} disabled={updates.isBusy}>Controlla adesso</Button>
        </FormRow>
      </FormSection>
      <FormSection>
        <FormRow><Button kind="link" onClick={() => void platform.openExternal(UpdateLinks.projectPage)}>Pagina del progetto</Button></FormRow>
        <FormRow><Button kind="link" onClick={() => void platform.openExternal(UpdateLinks.releasesPage)}>Tutte le versioni e le novità</Button></FormRow>
        <FormRow><Button kind="link" onClick={() => void platform.openExternal(UpdateLinks.issuesPage)}>Segnala un problema</Button></FormRow>
      </FormSection>
    </>
  );
}
