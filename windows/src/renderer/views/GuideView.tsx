import { useState, type ReactNode } from "react";
import {
  ArrowLeftRight, ArrowRight, BadgeCheck, BookA, Bug, CircleArrowDown, CircleHelp, Cpu, EyeOff, FileSearch, Folder, Hand, HardDrive,
  History, Key, MessagesSquare, ShieldCheck, TriangleAlert, UserRoundKey, Users, type LucideIcon,
} from "lucide-react";
import { ChatGPTConnectView } from "../chat";
import { Button, Icon, Sheet } from "../ui/components";
import { useObserved } from "../ui/observe";
import logotipo from "../assets/logotipo.svg";
import logotipoNegativo from "../assets/logotipo-negativo.svg";
import simbolo from "../assets/simbolo.svg";
import maikerhub from "../assets/maikerhub.svg";

// MARK: - La guida (GuideView.swift)
//
// Si apre da sola al primo avvio e poi da Aiuto › Guida di AnoniMaiker. Pochi passi: cosa fa l'app, perché è privata,
// la copia di sicurezza (da fare subito), il primo progetto, il primo file, la chat con GPT.

const { model } = window.anonimaiker;
const pages = 7;

export function GuideView() {
  useObserved(model);
  const [page, setPage] = useState(0);
  const close = (action: "backup" | "createProject" | "anonymize" | "chat" | null = null) => model.finishGuide(action);
  const last = page === pages - 1;

  return (
    <Sheet onClose={() => close()} width={640}>
      <div className="guide">
        {/* Una pagina alla volta, senza dissolvenze. */}
        <div className="guide-page" key={page}>
          {page === 0 && <Welcome />}
          {page === 1 && (
            <Page title="Tutto resta sul tuo PC" icon={ShieldCheck}>
              <Point icon={Cpu} title="Il motore di anonimizzazione è dentro l'app" text="Riconosce nomi, aziende, codici fiscali, IBAN, email, telefoni, indirizzi, documenti e targhe senza mandare niente in rete." />
              <Point icon={BookA} title="Un dizionario cifrato" text="Ogni dato ha sempre lo stesso segnaposto, così qualsiasi file anonimizzato si riconverte. Il dizionario è cifrato con una chiave protetta da Windows per il tuo utente." />
              <Point icon={EyeOff} title="Tu decidi cosa nascondere" text="Di serie: dati personali e aziende. Importi, date e città restano in chiaro perché servono all'AI. Si cambia in Impostazioni › Cosa nascondere." />
            </Page>
          )}
          {page === 2 && (
            <Page title="Prima di tutto: la copia di sicurezza" icon={HardDrive}>
              <Point icon={TriangleAlert} title="Senza copia, su un PC nuovo i dati non si riaprono" text="La chiave dei dati è legata a questo PC. Se lo cambi, lo resetti o si rompe, dizionario, clienti e chat si recuperano solo da una copia di sicurezza." />
              <Point icon={Key} title="Protetta da una password che scegli tu" text="Almeno 10 caratteri. Conservala bene: senza password la copia non si apre, nemmeno per noi." />
              <Point icon={History} title="Rifalla ogni tanto" text="Da File › Crea copia di sicurezza… (Ctrl+Maiusc+B). In basso a sinistra vedi la data dell'ultima." />
              <Action onClick={() => close("backup")} disabled={!model.isVaultReady}>Crea la copia di sicurezza</Action>
            </Page>
          )}
          {page === 3 && (
            <Page title="Si lavora per progetti" icon={Folder}>
              <Point icon={Folder} title="Un progetto per ogni lavoro" text="Un cliente, un evento, una pratica. Apri il progetto e dentro trovi subito «Anonimizza», «Riconverti» e i suoi «Documenti», ognuno con l'originale, la versione anonimizzata e le modifiche dell'AI." />
              <Point icon={Users} title="Il CRM si riempie da solo" text="Le persone e le aziende trovate nei documenti del progetto entrano nel suo CRM, con email e telefoni della stessa riga. Trattative e attività le aggiungi tu." />
              <Point icon={BookA} title="Ogni progetto ha il suo dizionario" text="I segnaposto di un progetto valgono solo lì: un file si riconverte dentro il progetto da cui viene." />
              <Action onClick={() => close("createProject")}>Crea il primo progetto</Action>
            </Page>
          )}
          {page === 4 && (
            <Page title="Anonimizzare e riconvertire" icon={ArrowLeftRight}>
              <Point number={1} title="Anonimizza" text="Nel progetto, incolla un testo o trascina un file (Testo, Markdown, CSV, Excel, Word, PDF) nel banco «Anonimizza»: il file entra da solo nei documenti del progetto." />
              <Point number={2} title="Usa l'AI che preferisci" text="Copia o salva il risultato con i segnaposto e dallo a ChatGPT, Claude o altri. Formattazione e celle restano come nell'originale." />
              <Point number={3} title="Riconverti" text="Incolla la risposta (o il file che ti restituisce) nel banco «Riconverti»: i segnaposto tornano i dati veri." />
              <Action onClick={() => close("anonymize")}>Prova adesso</Action>
            </Page>
          )}
          {page === 5 && (
            <Page title="La chat con GPT, a destra" icon={MessagesSquare}>
              <Point icon={FileSearch} title="Lavora sui documenti del progetto" text="Si apre a destra con Ctrl+J. GPT trova e legge i documenti del progetto (solo anonimizzati) e propone modifiche o documenti nuovi: li applichi tu con un clic, come nuove versioni." />
              <Point icon={UserRoundKey} title="Con il tuo abbonamento ChatGPT" text="Ognuno collega il proprio account, con un clic: l'accesso si fa sul sito di OpenAI e nell'app non ci sono chiavi né password." />
              <div style={{ paddingLeft: 40 }}>
                <ChatGPTConnectView />
              </div>
              <Action onClick={() => close("chat")}>Apri la chat</Action>
            </Page>
          )}
          {page === 6 && (
            <Page title="Sei pronto" icon={BadgeCheck}>
              <Point icon={CircleHelp} title="Questa guida resta a portata di mano" text="La riapri da Aiuto › Guida di AnoniMaiker (F1)." />
              <Point icon={CircleArrowDown} title="Aggiornamenti automatici" text="Quando esce una nuova versione l'app te lo dice e la installa con un clic. Si regola in Impostazioni › Aggiornamenti." />
              <Point icon={Hand} title="Un controllo finale è sempre tuo" text="Il motore è molto accurato ma non infallibile: prima di mandare un testo importante dai un'occhiata ai segnaposto evidenziati." />
              <Point icon={Bug} title="Idee o problemi?" text="Scrivili su GitHub: Aiuto › Segnala un problema." />
            </Page>
          )}
        </div>
        <div className="guide-footer">
          <div style={{ flex: 1, display: "flex", visibility: last ? "hidden" : "visible" }}>
            <Button kind="link" onClick={() => close()}>Salta la guida</Button>
          </div>
          <div className="guide-dots">
            {Array.from({ length: pages }, (_, index) => <span key={index} className={index === page ? "on" : ""} />)}
          </div>
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            {page > 0 && <Button onClick={() => setPage(page - 1)}>Indietro</Button>}
            {last ? (
              <Button kind="primary" onClick={() => close()} shortcut="Enter">Inizia</Button>
            ) : (
              <Button kind="primary" onClick={() => setPage(page + 1)} shortcut="Enter">Avanti</Button>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function Welcome() {
  return (
    <div className="col" style={{ alignItems: "center", gap: 18, textAlign: "center" }}>
      <img src={simbolo} alt="" width={88} height={88} />
      <picture>
        <source srcSet={logotipoNegativo} media="(prefers-color-scheme: dark)" />
        <img src={logotipo} alt="AnoniMaiker" style={{ height: 30 }} />
      </picture>
      <div className="secondary" style={{ fontSize: 16, lineHeight: 1.4, maxWidth: 520 }}>
        Usa l'intelligenza artificiale sui documenti dei tuoi clienti senza darle i dati veri.
      </div>
      {/* Dati veri → segnaposto → AI → dati veri. */}
      <div className="row" style={{ gap: 10, marginTop: 10 }}>
        <Step text={"Mario Rossi\nIBAN IT60…"} caption="Il tuo testo" background="rgba(128, 128, 128, 0.12)" />
        <Arrow />
        <Step text={"[FULLNAME_1]\nIBAN [IBAN_1]"} caption="Cosa vede l'AI" background="rgba(232, 130, 12, 0.12)" />
        <Arrow />
        <Step text={"Gentile\nMario Rossi…"} caption="La risposta" background="rgba(47, 158, 68, 0.12)" />
      </div>
      <div style={{ marginTop: 14 }}>
        <MaikerHubSignature />
      </div>
    </div>
  );
}

function Step({ text, caption, background }: { text: string; caption: string; background: string }) {
  return (
    <div className="col" style={{ alignItems: "center", gap: 6 }}>
      <div className="guide-step" style={{ background }}>{text}</div>
      <span className="caption secondary">{caption}</span>
    </div>
  );
}

function Arrow() {
  return <Icon icon={ArrowRight} color="var(--tertiary)" style={{ marginBottom: 20 }} />;
}

function Page({ title, icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 10, fontSize: 20, fontWeight: 600 }}>
        <Icon icon={icon} size={22} />
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Point({ icon, number, title, text }: { icon?: LucideIcon; number?: number; title: string; text: string }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
      <div style={{ width: 28, display: "flex", justifyContent: "center", flexShrink: 0, color: "var(--accent)" }}>
        {icon ? (
          <Icon icon={icon} size={20} />
        ) : (
          <span style={{ width: 20, height: 20, borderRadius: "50%", border: "1.6px solid var(--accent)", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {number}
          </span>
        )}
      </div>
      <div className="col" style={{ gap: 3 }}>
        <span className="headline">{title}</span>
        <span className="secondary" style={{ lineHeight: 1.45 }}>{text}</span>
      </div>
    </div>
  );
}

function Action({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <div style={{ paddingTop: 4 }}>
      <Button className="large" onClick={onClick} disabled={disabled}>{children}</Button>
    </div>
  );
}

/// «Un prodotto MaikerHub», con il logo del marchio.
export function MaikerHubSignature({ height = 9 }: { height?: number }) {
  return (
    <div className="row" style={{ gap: 6, justifyContent: "center" }}>
      <span className="caption secondary">Un prodotto</span>
      <img src={maikerhub} alt="MaikerHub" style={{ height }} />
    </div>
  );
}
