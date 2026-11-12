import { useEffect, useState } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import type { ChatGPTConnection } from "../../shared/api";
import { Alert, Button, Label, Spinner } from "../ui/components";
import { useObserved } from "../ui/observe";

// MARK: - Il proprio account ChatGPT
//
// Collegato o no, e il pulsante per collegarlo (o scollegarlo) senza usare il Terminale.

/// `compact`: nella chat, solo quando manca il collegamento, in una riga.
export function ChatGPTConnectView({ compact = false }: { compact?: boolean }) {
  const { model } = window.anonimaiker;
  useObserved(model);
  const chat = useObserved(model.chat);
  const [confirmsDisconnect, setConfirmsDisconnect] = useState(false);

  useEffect(() => {
    if (model.chat.codexStatus === null) void model.refreshCodexStatus();
  }, [model]);

  let body;
  if (chat.connection) {
    body = <ConnectionProgress connection={chat.connection} />;
  } else if (chat.codexStatus === null) {
    body = (
      <div className="row" style={{ gap: 6 }}>
        <Spinner mini />
        <span className="secondary">Controllo il collegamento a ChatGPT…</span>
      </div>
    );
  } else if (chat.codexStatus.kind === "ready") {
    body = (
      <div className="row">
        <Label icon={CircleCheck} color="var(--green)">Collegato al tuo account ChatGPT</Label>
        <div className="spacer" />
        {!compact && <Button onClick={() => setConfirmsDisconnect(true)}>Scollega…</Button>}
      </div>
    );
  } else {
    body = (
      <div className="row" style={{ gap: 12 }}>
        <div className="col" style={{ gap: 3, flex: 1, minWidth: 0 }}>
          <span className="headline">{compact ? "Collega il tuo account ChatGPT per usare la chat" : "Nessun account ChatGPT collegato"}</span>
          <span className="callout secondary">Serve un tuo abbonamento ChatGPT. L'accesso si fa sul sito di OpenAI: l'app non vede la tua password.</span>
        </div>
        <Button kind="primary" onClick={() => void model.connectChatGPT()} disabled={!model.isVaultReady}>Collega il tuo account ChatGPT</Button>
      </div>
    );
  }

  return (
    <div className="col chatgpt-connect" style={{ gap: 8 }}>
      {body}
      {chat.connectionError && (
        <div className="row selectable" style={{ alignItems: "flex-start", gap: 6 }}>
          <TriangleAlert size={14} strokeWidth={1.75} color="var(--orange)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
          <span className="orange" style={{ whiteSpace: "pre-wrap" }}>{chat.connectionError}</span>
        </div>
      )}
      {confirmsDisconnect && (
        <Alert
          title="Scollegare il tuo account ChatGPT?"
          message="La chat non potrà più usare GPT finché non colleghi di nuovo un account. Conversazioni e dati restano sul PC."
          onClose={() => setConfirmsDisconnect(false)}
          actions={
            <>
              <Button onClick={() => setConfirmsDisconnect(false)}>Annulla</Button>
              <Button
                kind="destructive"
                onClick={() => {
                  setConfirmsDisconnect(false);
                  void model.disconnectChatGPT();
                }}
              >
                Scollega
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

function ConnectionProgress({ connection }: { connection: ChatGPTConnection }) {
  const { model, platform } = window.anonimaiker;
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
      <div style={{ paddingTop: 2 }}><Spinner mini /></div>
      <div className="col" style={{ gap: 4, flex: 1, minWidth: 0 }}>
        {connection.kind === "installing" ? (
          <span>Preparo il collegamento a ChatGPT (una volta sola, circa un minuto)…</span>
        ) : (
          <>
            <span>Si è aperto il browser: accedi con il tuo account ChatGPT e conferma.</span>
            {connection.url && (
              <a
                className="callout"
                href={connection.url}
                onClick={(event) => {
                  event.preventDefault();
                  if (connection.url) void platform.openExternal(connection.url);
                }}
              >
                Il browser non si è aperto? Apri la pagina di accesso
              </a>
            )}
          </>
        )}
      </div>
      <Button onClick={() => model.cancelChatGPTConnection()}>Annulla</Button>
    </div>
  );
}
