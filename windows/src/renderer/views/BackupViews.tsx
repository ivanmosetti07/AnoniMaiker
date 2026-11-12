import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, CircleCheck, HardDrive, TriangleAlert } from "lucide-react";
import type { BackupContents } from "../../core/sicurezza/backup";
import { Format } from "../../shared/format";
import { Button, Icon, Label, Sheet, Spinner } from "../ui/components";
import { useObserved } from "../ui/observe";
import { BackupInfo, describeSummary } from "../helpers";
import { FormRow, FormSection, LabeledContent } from "./parts";

// MARK: - Copia di sicurezza: creare e ripristinare (BackupViews.swift)

const { model } = window.anonimaiker;
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

function SheetTitle({ icon, children }: { icon: typeof HardDrive; children: string }) {
  return (
    <div className="row" style={{ gap: 10, fontSize: 20, fontWeight: 600 }}>
      <Icon icon={icon} size={22} />
      <span>{children}</span>
    </div>
  );
}

/// Crea una copia di tutto, protetta da una password.
export function BackupExportSheet() {
  useObserved(model);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const strength = BackupInfo.strength(password);
  const mismatch = confirmation.length > 0 && confirmation !== password;
  const canCreate = Array.from(password).length >= BackupInfo.minimumPasswordLength && password === confirmation && !working;
  const dismiss = () => (model.backupStep = null);
  const totals = model.totals ? describeSummary(model.totals) : "…";

  const create = async () => {
    if (!canCreate) return;
    setWorking(true);
    try {
      if (await model.exportBackup(password)) dismiss();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Sheet
      onClose={working ? undefined : dismiss}
      width={540}
      actions={
        <>
          {working && (
            <div className="row" style={{ marginRight: "auto" }}>
              <Spinner />
              <span className="secondary">Cifro la copia…</span>
            </div>
          )}
          <Button onClick={dismiss} disabled={working}>Annulla</Button>
          <Button kind="primary" onClick={() => void create()} disabled={!canCreate}>Crea e salva…</Button>
        </>
      }
    >
      <form
        className="col"
        style={{ gap: 14 }}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <SheetTitle icon={HardDrive}>Crea una copia di sicurezza</SheetTitle>
        <span className="secondary" style={{ lineHeight: 1.45 }}>
          Dentro ci sono tutti i progetti, con documenti, CRM, dizionari e conversazioni ({totals}), cifrati con la password che scegli adesso. Con la copia e la password riavrai tutto anche su un altro PC (o su un Mac).
        </span>
        <FormSection>
          <FormRow>
            <span style={{ width: 150 }}>Password</span>
            <input ref={first} type="password" value={password} onChange={(event) => setPassword(event.target.value)} style={{ flex: 1 }} />
          </FormRow>
          <FormRow>
            <span style={{ width: 150 }}>Ripeti la password</span>
            <input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} style={{ flex: 1 }} />
          </FormRow>
          <FormRow>
            <div className="progress" style={{ flex: 1 }}>
              <div
                style={{
                  width: `${(strength.score / 3) * 100}%`,
                  background: strength.score === 0 ? "var(--red)" : strength.score === 1 ? "var(--orange)" : "var(--green)",
                }}
              />
            </div>
            <span className="caption secondary" style={{ width: 150 }}>
              {password.length === 0 ? `Almeno ${BackupInfo.minimumPasswordLength} caratteri` : strength.label}
            </span>
          </FormRow>
          {mismatch && (
            <FormRow>
              <span className="caption orange">Le due password non coincidono.</span>
            </FormRow>
          )}
        </FormSection>
        <Label icon={TriangleAlert} color="var(--orange)" className="callout">
          <span style={{ whiteSpace: "normal" }}>
            Se perdi la password la copia non si apre più, e nessuno la può recuperare. Salvala, per esempio, in un gestore di password.
          </span>
        </Label>
        {error && <span className="callout red selectable">{error}</span>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/// Apre una copia con la password e, a richiesta, sostituisce i dati di questo PC.
export function BackupRestoreSheet({ path }: { path: string }) {
  useObserved(model);
  const [password, setPassword] = useState("");
  const [contents, setContents] = useState<BackupContents | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [aside, setAside] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  const dismiss = () => (model.backupStep = null);
  const fileName = path.split(/[\\/]/).pop() ?? path;

  const open = async () => {
    if (password.length === 0 || working) return;
    setWorking(true);
    try {
      setContents(await model.openBackup(path, password));
      setError(null);
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setWorking(false);
    }
  };

  const restore = async (opened: BackupContents) => {
    setWorking(true);
    try {
      setAside(await model.restore(opened));
      setRestored(true);
      setError(null);
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setWorking(false);
    }
  };

  const busy = (text: string) =>
    working && (
      <div className="row" style={{ marginRight: "auto" }}>
        <Spinner />
        <span className="secondary">{text}</span>
      </div>
    );

  let body;
  let actions;
  if (restored) {
    body = (
      <>
        <Label icon={CircleCheck} color="var(--green)">
          <span style={{ whiteSpace: "normal" }}>Ripristino completato: dizionario, CRM e documenti sono quelli della copia.</span>
        </Label>
        {aside && <span className="secondary">I dati di prima sono in «{aside.split(/[\\/]/).pop()}».</span>}
      </>
    );
    actions = (
      <>
        {aside && (
          <div style={{ marginRight: "auto" }}>
            <Button onClick={() => void window.anonimaiker.platform.showInFolder(aside)}>Mostra in Esplora file</Button>
          </div>
        )}
        <Button kind="primary" onClick={dismiss} shortcut="Enter">Chiudi</Button>
      </>
    );
  } else if (contents) {
    const current = model.isVaultReady ? (model.totals ? describeSummary(model.totals) : "…") : "non apribili";
    body = (
      <>
        <div className="card col" style={{ gap: 6 }}>
          <span style={{ fontWeight: 500 }}>Copia del {Format.dateTime(contents.summary.created)}</span>
          <span className="secondary">{describeSummary(contents.summary)}</span>
        </div>
        <Label icon={TriangleAlert} color="var(--orange)" className="callout">
          <span style={{ whiteSpace: "normal" }}>
            I dati di questo PC ({current}) verranno sostituiti. Non si cancellano: finiscono in una cartella «Sostituiti il …» accanto al dizionario.
          </span>
        </Label>
      </>
    );
    actions = (
      <>
        {busy("Ripristino…")}
        <Button onClick={dismiss} disabled={working}>Annulla</Button>
        <Button kind="destructive" onClick={() => void restore(contents)} disabled={working}>Sostituisci i dati di questo PC</Button>
      </>
    );
  } else {
    body = (
      <>
        <span className="secondary" style={{ lineHeight: 1.45 }}>
          Scrivi la password con cui hai creato la copia. Finché non confermi, i dati di questo PC non cambiano.
        </span>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void open();
          }}
        >
          <input
            ref={field}
            type="password"
            placeholder="Password della copia"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ width: "100%" }}
          />
        </form>
      </>
    );
    actions = (
      <>
        {busy("Apro la copia…")}
        <Button onClick={dismiss} disabled={working}>Annulla</Button>
        <Button kind="primary" onClick={() => void open()} disabled={password.length === 0 || working}>Apri la copia</Button>
      </>
    );
  }

  return (
    <Sheet onClose={working ? undefined : dismiss} width={540} actions={actions}>
      <div className="col" style={{ gap: 14 }}>
        <SheetTitle icon={ArchiveRestore}>Ripristina una copia di sicurezza</SheetTitle>
        <span className="secondary selectable">{fileName}</span>
        {body}
        {error && <span className="callout red selectable">{error}</span>}
      </div>
    </Sheet>
  );
}

/// Le Impostazioni › Copia di sicurezza.
export function BackupSettings() {
  useObserved(model);
  useEffect(() => {
    void model.allProjectsSummary();
  }, []);
  return (
    <>
      <FormSection
        footer="La chiave dei dati è legata a questo PC e al tuo utente di Windows: su un PC nuovo i dati si riaprono solo da una copia di sicurezza. Fanne una dopo ogni giornata di lavoro importante."
      >
        <LabeledContent label="Ultima copia">{model.lastBackup ? Format.dateTime(model.lastBackup) : "Mai fatta"}</LabeledContent>
        <LabeledContent label="Contenuto">{model.totals ? describeSummary(model.totals) : "…"}</LabeledContent>
      </FormSection>
      <FormSection>
        <FormRow>
          <Button onClick={() => model.startExport()} disabled={!model.isVaultReady}>Crea copia di sicurezza…</Button>
          <Button onClick={() => void model.startRestore()}>Ripristina da una copia…</Button>
        </FormRow>
      </FormSection>
    </>
  );
}
