import { useEffect, useRef, useState } from "react";
import { ChevronDown, CircleCheck, EyeOff, FileText, Lock, TriangleAlert, Trash2, Undo2 } from "lucide-react";
import type { CRMDocument, DocumentVersion } from "../../core/crm/crmModel";
import type { AnonymizationResult } from "../../core/anonimizzazione/anonymizer";
import type { DocumentPreview } from "../../core/documenti/segmentedText";
import { Format } from "../../shared/format";
import { Alert, Banner, Button, EmptyState, Icon, Label, MenuButton, Segmented, Spinner, Toolbar, useShortcut } from "../ui/components";
import { useObserved } from "../ui/observe";
import { DocumentPreviewView } from "../views/preview";
import { placeholderRanges, TextPane, type TextRange } from "../views/textPane";
import { BackButton, useContextMenu } from "./components";
import { answersOf, anonymizedOf, originalOf, previewPlainText } from "./helpers";

const model = () => window.anonimaiker.model;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/// Un documento del cliente: l'originale, la versione anonimizzata da dare all'AI, le risposte dell'AI riconvertite.
export function DocumentDetailView({ documentID }: { documentID: string }) {
  const app = useObserved(model());
  const document = app.crm.document(documentID);
  if (!document) {
    return (
      <div className="content">
        <Toolbar title="" leading={<BackButton />} />
        <EmptyState icon={FileText} title="Documento non trovato" />
      </div>
    );
  }
  return <DocumentContent document={document} />;
}

function DocumentContent({ document }: { document: CRMDocument }) {
  const app = useObserved(model());
  const [selection, setSelection] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  /// La stessa versione con i segnaposto (per le risposte dell'AI): le celle cambiate si evidenziano.
  const [compared, setCompared] = useState<DocumentPreview | null>(null);
  const [highlights, setHighlights] = useState<TextRange[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [openMenu, menu] = useContextMenu();
  const current = useRef<string | null>(null);

  const version = document.versions.find((item) => item.id === selection) ?? null;
  const original = originalOf(document);
  const anonymized = anonymizedOf(document);
  const answers = answersOf(document);
  const busy = app.busyDocuments.has(document.id);

  // Si ricarica quando cambia la versione scelta, quando arrivano versioni nuove o cambia il dizionario.
  useEffect(() => {
    if (selection === null || !document.versions.some((item) => item.id === selection)) {
      const fallback = anonymizedOf(document)?.id ?? originalOf(document)?.id ?? null;
      if (fallback !== selection) {
        setSelection(fallback);
        return;
      }
    }
    const chosen = document.versions.find((item) => item.id === selection);
    current.current = selection;
    if (!chosen) {
      setPreview(null);
      setHighlights([]);
      return;
    }
    setLoading(true);
    model()
      .preview(chosen, document)
      .then((result) => {
        if (current.current !== chosen.id) return;
        setLoadError(null);
        setPreview(result.preview);
        setCompared(result.compared);
        setHighlights(result.highlights);
        setUnknown(result.unknown);
      })
      .catch((error: unknown) => {
        if (current.current !== chosen.id) return;
        setLoadError(describe(error));
        setPreview(null);
        setHighlights([]);
      })
      .finally(() => {
        if (current.current === chosen.id) setLoading(false);
      });
  }, [selection, document.versions.length, app.vault.count]);

  /// Dopo una risposta nuova, la mostra.
  const addAnswer = async (add: () => Promise<void>) => {
    const before = new Set(answersOf(document).map((answer) => answer.id));
    await add();
    const updated = model().crm.document(document.id);
    const added = updated ? answersOf(updated).find((answer) => !before.has(answer.id)) : undefined;
    if (added) setSelection(added.id);
  };

  const anonymize = async () => {
    await app.anonymizeDocument(document.id);
    const updated = model().crm.document(document.id);
    const id = updated ? anonymizedOf(updated)?.id : undefined;
    if (id) setSelection(id);
  };

  const versionRow = (item: DocumentVersion, title: string, icon: typeof FileText, detail: string, onContext?: (event: React.MouseEvent) => void) => (
    <div key={item.id} className={`side-row ${selection === item.id ? "selected" : ""}`} onClick={() => setSelection(item.id)} onContextMenu={onContext}>
      <Icon icon={icon} />
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        <span>{title}</span>
        {detail.length > 0 && <span className="caption secondary" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{detail}</span>}
      </div>
    </div>
  );

  return (
    <div className="content">
      <Toolbar title={document.title} subtitle={app.crm.company(document.companyID)?.name ?? ""} leading={<BackButton />}>
        <Button
          icon={EyeOff}
          kind="plain"
          iconOnly
          onClick={() => void anonymize()}
          disabled={busy || app.engineState.kind === "missing" || original === null}
        >
          {anonymized === null ? "Anonimizza" : "Anonimizza di nuovo"}
        </Button>
        <MenuButton
          align="right"
          label={
            <button className="btn plain" title="Risposta dell'AI: aggiungi la risposta dell'AI scritta con i segnaposto, qui la leggi riconvertita">
              <Icon icon={Undo2} /> <Icon icon={ChevronDown} size={11} />
            </button>
          }
          items={[
            { label: "Incolla dagli appunti", onClick: () => void addAnswer(() => app.pasteAnswer(document.id)) },
            { label: "Importa da un file…", onClick: () => void addAnswer(() => app.importAnswer(document.id)) },
          ]}
        />
        <Button icon={Trash2} kind="plain" iconOnly onClick={() => setConfirmingDeletion(true)}>Elimina…</Button>
      </Toolbar>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div className="crm-versions">
          <div className="side-section">Documento</div>
          {original && versionRow(original, "Originale", FileText, original.fileName.length === 0 ? Format.date(original.created) : original.fileName)}
          <div className="side-section">Da dare all'AI</div>
          {anonymized ? versionRow(anonymized, "Anonimizzato", EyeOff, anonymized.summary) : <div className="hint">Non ancora anonimizzato</div>}
          <div className="side-section">Risposte dell'AI</div>
          {answers.length === 0 && <div className="hint">Incolla o importa la risposta: qui torna con i dati veri</div>}
          {answers.map((answer, index) =>
            versionRow(
              answer,
              `Risposta ${index + 1}`,
              Undo2,
              Format.dateTime(answer.created) + (answer.summary.length === 0 ? "" : ` · ${answer.summary}`),
              (event) => openMenu(event, [{ label: "Elimina risposta", destructive: true, onClick: () => void app.removeVersion(answer.id, document.id) }]),
            ),
          )}
        </div>
        <div className="vdivider" />
        <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column" }}>
          {busy && (
            <>
              <div className="row callout" style={{ padding: 10, background: "var(--bar)" }}>
                <Spinner mini />
                <span className="secondary">Anonimizzo sul PC, con i dati del cliente che il CRM conosce…</span>
              </div>
              <div className="divider" />
            </>
          )}
          {loadError && <Banner icon={TriangleAlert}>{loadError}</Banner>}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {preview ? (
              <DocumentPreviewView
                preview={preview}
                highlights={highlights}
                highlightPlaceholders={version?.kind === "anonymized"}
                comparedWith={compared}
              />
            ) : loading ? (
              <div className="empty">
                <Spinner />
                <span>{document.format === "pdf" ? "Leggo il PDF…" : "Apro il documento…"}</span>
              </div>
            ) : (
              <div className="empty">Scegli una versione</div>
            )}
          </div>
          {version && <ActionBar document={document} version={version} preview={preview} unknown={unknown} />}
        </div>
      </div>
      {menu}
      {confirmingDeletion && (
        <Alert
          title={`Eliminare «${document.title}» e tutte le sue versioni?`}
          onClose={() => setConfirmingDeletion(false)}
          actions={
            <>
              <Button onClick={() => setConfirmingDeletion(false)}>Annulla</Button>
              <Button
                kind="destructive"
                onClick={() => {
                  setConfirmingDeletion(false);
                  void app.deleteDocument(document.id);
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

function ActionBar({ document, version, preview, unknown }: { document: CRMDocument; version: DocumentVersion; preview: DocumentPreview | null; unknown: string[] }) {
  const app = model();
  const text = preview ? previewPlainText(preview) : "";
  return (
    <div className="reportbar">
      {version.kind === "original" && (
        <>
          <span className="secondary"><Label icon={Lock}>Originale, con i dati veri: resta su questo PC</Label></span>
          <div className="spacer" />
          <Button onClick={() => void app.export(version, document)}>Esporta…</Button>
        </>
      )}
      {version.kind === "anonymized" && (
        <>
          <Label icon={EyeOff}>{version.summary.length === 0 ? "Anonimizzato" : version.summary}</Label>
          <div className="spacer" />
          <Button onClick={() => app.copy(text)} title="Copia il testo anonimizzato, da incollare nell'AI">Copia</Button>
          <Button onClick={() => void app.export(version, document)}>Esporta…</Button>
        </>
      )}
      {version.kind === "aiAnswer" && (
        <>
          {unknown.length === 0 ? (
            <Label icon={CircleCheck}>{version.summary.length === 0 ? "Risposta riconvertita" : version.summary}</Label>
          ) : (
            <Label icon={TriangleAlert} color="var(--orange)">
              {`${unknown.length} segnaposto sconosciuti: ${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? "…" : ""}`}
            </Label>
          )}
          <div className="spacer" />
          <Button onClick={() => app.copy(text)}>Copia riconvertito</Button>
          <Button onClick={() => void app.export(version, document)}>Esporta riconvertito…</Button>
        </>
      )}
    </div>
  );
}

/// La scheda del cliente anonimizzata, pronta da copiare nell'AI.
export function DossierSheet({ companyID, onClose }: { companyID: string; onClose: () => void }) {
  const [original, setOriginal] = useState("");
  const [result, setResult] = useState<AnonymizationResult | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useShortcut("Escape", onClose);

  useEffect(() => {
    let alive = true;
    model()
      .dossier(companyID)
      .then((value) => {
        if (!alive) return;
        setOriginal(value.original);
        setResult(value.anonymized);
      })
      .catch((reason: unknown) => alive && setError(describe(reason)));
    return () => {
      alive = false;
    };
  }, [companyID]);

  /// Salva il testo con la finestra «Salva con nome» (lo scaricamento di Electron).
  const save = () => {
    if (!result) return;
    try {
      const url = URL.createObjectURL(new Blob([result.text], { type: "text/markdown" }));
      const link = window.document.createElement("a");
      link.href = url;
      link.download = "Scheda cliente (anonimizzata).md";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (reason) {
      model().alert = describe(reason);
    }
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet" role="dialog" style={{ width: 780, height: 640, maxHeight: "calc(100% - 40px)" }}>
        <div className="row" style={{ padding: 16, gap: 12 }}>
          <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
            <span className="title2">Scheda anonimizzata</span>
            <span className="callout secondary">Anagrafica, contatti, trattative, note e documenti del cliente, senza dati personali.</span>
          </div>
          <div style={{ opacity: result ? 1 : 0.45, pointerEvents: result ? undefined : "none" }}>
            <Segmented
              value={showOriginal ? "original" : "anonymized"}
              options={[{ value: "anonymized", label: "Anonimizzata" }, { value: "original", label: "Originale" }]}
              onChange={(value) => setShowOriginal(value === "original")}
            />
          </div>
        </div>
        <div className="divider" />
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {result ? (
            <TextPane text={showOriginal ? original : result.text} highlights={showOriginal ? [] : placeholderRanges(result.text)} editable={false} />
          ) : error ? (
            <EmptyState icon={TriangleAlert} title="Non sono riuscito ad anonimizzare la scheda" message={error} />
          ) : (
            <div className="empty">
              <Spinner />
              <span>Anonimizzo la scheda sul PC…</span>
            </div>
          )}
        </div>
        <div className="sheet-actions" style={{ alignItems: "center" }}>
          {result && (
            <span className="callout truncate" style={{ minWidth: 0 }}>
              <Label icon={EyeOff}>{result.report.isEmpty ? "Nessun dato da nascondere" : `Nascosti: ${result.report.summary}`}</Label>
            </span>
          )}
          <div className="spacer" />
          <Button onClick={() => result && model().copy(result.text)} disabled={result === null || showOriginal} title="Copia la scheda anonimizzata, da incollare nell'AI">
            Copia
          </Button>
          <Button onClick={save} disabled={result === null}>Salva…</Button>
          <Button onClick={onClose} title="Chiudi (Esc)">Chiudi</Button>
        </div>
      </div>
    </div>
  );
}
