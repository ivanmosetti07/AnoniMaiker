import { useState, type ReactNode } from "react";
import {
  ArrowDownToLine, CircleCheck, CircleX, Copy, EyeOff, FilePlus2, FolderPlus, Info, Inbox, RefreshCw, ShieldCheck, TriangleAlert, Undo2,
} from "lucide-react";
import type { DocumentPreview } from "../../core/documenti/segmentedText";
import type { Workspace } from "../../shared/api";
import { Banner, Button, Icon, Label, ProgressBar, Spinner, Toolbar, ToolbarSeparator } from "../ui/components";
import { useObserved } from "../ui/observe";
import { formatTitle } from "../helpers";
import { DocumentPreviewView } from "./preview";
import { TextPane, type TextRange } from "./textPane";

// MARK: - Il banco di lavoro (WorkspaceView.swift)
//
// A sinistra il testo (scritto, incollato o da un file), a destra il risultato.

const { model } = window.anonimaiker;

export function WorkspaceView({ space: observedSpace }: { space: Workspace }) {
  useObserved(model);
  const space = useObserved(observedSpace);
  const isAnonymize = space.mode === "anonymize";
  const runTitle = isAnonymize ? "Anonimizza" : "Riconverti";
  const open = (file: File) => void model.open(window.anonimaiker.pathForFile(file), space);

  /// «Excel · cella per cella», «PDF · ne esce un PDF nuovo».
  const inputDetail = (() => {
    const source = space.source;
    if (!source) return null;
    const how = source.format === "csv" || source.format === "xlsx" ? "cella per cella"
      : source.format === "docx" ? "la formattazione resta"
      : source.format === "pdf" ? "ne esce un PDF nuovo" : "";
    return [source.name, source.isFile ? formatTitle(source.format) : "", how].filter((part) => part.length > 0).join(" · ");
  })();

  const outputDetail = (() => {
    const source = space.source;
    if (!space.isFile || !space.hasOutput || !source) return null;
    return space.recognizedPages > 0 ? `${space.recognizedPages} pagine lette con l'OCR` : formatTitle(source.format);
  })();

  const engine = model.engineState;
  return (
    <div className="content">
      <Toolbar title={runTitle} subtitle={space.source?.name}>
        <Button icon={FilePlus2} onClick={() => void model.chooseFile(space)} shortcut="Ctrl+O" title="Apri un file: testo, Markdown, CSV, Excel, Word o PDF">
          Apri…
        </Button>
        <Button
          icon={isAnonymize ? EyeOff : Undo2}
          kind="primary"
          onClick={() => void model.run(space)}
          disabled={!model.canRun(space)}
          shortcut="Ctrl+Enter"
          title={runTitle}
        >
          {runTitle}
        </Button>
        <ToolbarSeparator />
        <Button icon={Copy} kind="plain" iconOnly onClick={() => model.copy(space)} disabled={!space.hasOutput} shortcut="Ctrl+Shift+C" title="Copia il risultato">
          Copia
        </Button>
        <Button icon={ArrowDownToLine} kind="plain" iconOnly onClick={() => void model.save(space)} disabled={!space.hasOutput} shortcut="Ctrl+S" title="Salva il risultato in un file">
          Salva…
        </Button>
        {isAnonymize && (
          <Button
            icon={Inbox}
            kind="plain"
            iconOnly
            onClick={() => void model.saveToProject(space)}
            disabled={space.isFile || !space.hasOutput || space.isStale || space.isRunning || space.projectNote !== null}
            title={space.isFile ? "Salva nei documenti del progetto · I file anonimizzati entrano da soli nei documenti del progetto"
              : "Salva nei documenti del progetto · Archivia il testo e la sua versione anonimizzata nei documenti del progetto (le persone entrano nel CRM)"}
          >
            Salva nei documenti del progetto
          </Button>
        )}
        <Button icon={CircleX} kind="plain" iconOnly onClick={() => space.clear()} disabled={space.isEmpty} title="Pulisci · Ricomincia da capo">
          Pulisci
        </Button>
      </Toolbar>

      {isAnonymize && engine.kind === "missing" && (
        <Banner icon={TriangleAlert}>Il motore di anonimizzazione non è nell'app. Esegui npm run motore e ricompila.</Banner>
      )}
      {isAnonymize && engine.kind === "failed" && <Banner icon={TriangleAlert}>{engine.message}</Banner>}

      <div className="panes">
        <Pane title={isAnonymize ? "Originale" : "Con i segnaposto"} detail={inputDetail}>
          {space.isFile ? (
            <FileDrop onDropFile={open}>
              <FilePane preview={space.inputPreview} highlightPlaceholders={!isAnonymize} />
            </FileDrop>
          ) : (
            <TextPane
              text={space.input}
              onChange={(text) => (space.input = text)}
              onDropFile={open}
              placeholder={
                <div className="col" style={{ gap: 6 }}>
                  <span>{isAnonymize ? "Incolla un testo o trascina qui un file" : "Incolla la risposta dell'AI o trascina qui un file anonimizzato"}</span>
                  <span className="callout">Testo, Markdown, CSV, Excel, Word o PDF; oppure aprilo con Ctrl+O. Niente lascia il PC.</span>
                </div>
              }
            />
          )}
        </Pane>
        <div className="vdivider" />
        <Pane title={isAnonymize ? "Anonimizzato" : "Riconvertito"} detail={outputDetail}>
          <div className="col" style={{ flex: 1, minHeight: 0, gap: 0, opacity: space.isStale ? 0.45 : 1 }}>
            {space.isFile ? (
              <FilePane
                preview={space.outputPreview}
                highlightPlaceholders={isAnonymize}
                compared={isAnonymize ? null : space.inputPreview}
                highlights={space.highlights}
                waiting={space.isRunning}
              />
            ) : (
              <TextPane text={space.output} highlights={space.highlights} editable={false} highlightClass={isAnonymize ? "ph" : "rv"} />
            )}
          </div>
          {!space.hasOutput && !space.isRunning && (
            <div className="pane-empty">
              <Icon icon={isAnonymize ? EyeOff : Undo2} size={30} />
              <span>{isAnonymize ? "Qui il testo con i segnaposto" : "Qui il testo con i dati veri"}</span>
              <span className="callout tertiary">
                {isAnonymize ? "[FULLNAME_1], [IBAN_1]… al posto dei dati personali" : "I segnaposto tornano i dati del dizionario"}
              </span>
            </div>
          )}
        </Pane>
      </div>
      <ReportBar space={space} />
    </div>
  );
}

function Pane({ title, detail, children }: { title: string; detail: string | null; children: ReactNode }) {
  return (
    <div className="pane">
      <div className="pane-title">
        <span className="headline">{title}</span>
        {detail && <span className="secondary truncate" title={detail}>{detail}</span>}
      </div>
      <div className="divider" />
      <div className="pane-body">{children}</div>
    </div>
  );
}

/// Un file trascinato sull'anteprima si apre al suo posto.
function FileDrop({ onDropFile, children }: { onDropFile: (file: File) => void; children: ReactNode }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`pane-body ${dragging ? "drop" : ""}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) {
          event.preventDefault();
          onDropFile(file);
        }
      }}
    >
      {children}
    </div>
  );
}

function FilePane({ preview, highlightPlaceholders, compared, highlights = [], waiting = true }: {
  preview: DocumentPreview | null;
  highlightPlaceholders: boolean;
  compared?: DocumentPreview | null;
  highlights?: readonly TextRange[];
  waiting?: boolean;
}) {
  if (preview) {
    return <DocumentPreviewView preview={preview} highlights={highlights} highlightPlaceholders={highlightPlaceholders} comparedWith={compared} />;
  }
  if (!waiting) return null;
  return (
    <div className="empty">
      <Spinner />
    </div>
  );
}

// MARK: - La riga in fondo

/// La riga in fondo: avanzamento, cosa è stato nascosto o rimesso, avvisi.
export function ReportBar({ space: observedSpace }: { space: Workspace }) {
  useObserved(model);
  const space = useObserved(observedSpace);
  return <div className="reportbar">{reportContent(space)}</div>;
}

function reportContent(space: Workspace): ReactNode {
  if (space.isRunning) {
    if (space.progress === null) return <Spinner />;
    return (
      <>
        <ProgressBar value={space.progress} />
        <span className="secondary">{model.engineState.kind === "loading" ? "Preparo il motore…" : "Anonimizzo sul PC…"}</span>
        <Button small onClick={() => model.cancel(space)}>Annulla</Button>
      </>
    );
  }
  if (space.isStale) {
    return (
      <Label icon={RefreshCw} className="secondary">
        Il testo è cambiato: premi {space.mode === "anonymize" ? "Anonimizza" : "Riconverti"} (Ctrl+Invio) per aggiornare il risultato
      </Label>
    );
  }
  const outcome = space.outcome;
  if (!outcome) {
    return <Label icon={ShieldCheck} className="secondary">Tutto avviene su questo PC: niente viene inviato.</Label>;
  }
  if (outcome.kind === "anonymized") {
    const report = outcome.report;
    return (
      <>
        {report.isEmpty ? (
          <Label icon={CircleCheck} className="secondary">Nessun dato da nascondere con le categorie scelte</Label>
        ) : (
          <>
            <Label icon={EyeOff}>Nascosti: {report.summary}</Label>
            {report.newEntries > 0 && (
              <span className="secondary" style={{ flexShrink: 0 }}>
                · {report.newEntries} {report.newEntries === 1 ? "nuovo" : "nuovi"} nel dizionario
              </span>
            )}
          </>
        )}
        {space.projectNote !== null && (
          <>
            <span className="spacer" style={{ minWidth: 8 }} />
            <Button kind="link" icon={FolderPlus} onClick={() => (model.section = "documents")} title="Apri i documenti del progetto">
              {space.projectNote}
            </Button>
          </>
        )}
      </>
    );
  }
  const result = outcome.result;
  const unknown = result.unknown;
  return (
    <>
      <Label icon={result.count === 0 ? Info : CircleCheck} className={result.count === 0 ? "secondary" : ""}>
        {result.count === 0 ? "Nessun segnaposto da riconvertire" : `Riconvertiti ${result.count} segnaposto`}
      </Label>
      {unknown.length > 0 && (
        <Label
          icon={TriangleAlert}
          color="var(--orange)"
          title="Non sono nel dizionario di questo PC: forse li ha inventati l'AI o vengono da un altro computer."
        >
          {unknown.length} sconosciuti, rimasti com'erano: {unknown.slice(0, 4).join(", ")}{unknown.length > 4 ? "…" : ""}
        </Label>
      )}
    </>
  );
}
