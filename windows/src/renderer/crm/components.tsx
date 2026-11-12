import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { BadgeCheck, ChevronLeft, Circle, TriangleAlert } from "lucide-react";
import type { Activity, CRMDocument, Deal } from "../../core/crm/crmModel";
import type { CRMRoute } from "../../shared/navigation";
import { Format } from "../../shared/format";
import { Button, Icon, Spinner, type MenuEntry } from "../ui/components";
import { useObserved } from "../ui/observe";
import {
  Colors, DoneIcon, answersOf, anonymizedOf, formatIcon, formatTitle, fullName, isOpen, isOverdue, kindIcon, kindTitle, originalOf,
  stageColor, stageTitle,
} from "./helpers";
import "./crm.css";

// MARK: - Pezzi comuni delle schede del CRM

const model = () => window.anonimaiker.model;

/// La pila di navigazione della sezione (Documenti o Aziende): `NavigationStack` del Mac.
export interface CRMNavigation {
  push(route: CRMRoute): void;
  pop(): void;
}

export const NavigationContext = createContext<CRMNavigation | null>(null);

export function useNavigation(): CRMNavigation | null {
  return useContext(NavigationContext);
}

/// Il pulsante «Indietro» in cima a un dettaglio.
export function BackButton() {
  const navigation = useNavigation();
  if (!navigation) return null;
  return (
    <Button icon={ChevronLeft} kind="plain" iconOnly onClick={() => navigation.pop()} shortcut="Alt+ArrowLeft" title="Indietro">
      Indietro
    </Button>
  );
}

/// Un'etichetta colorata («Cliente», «Preventivo inviato»).
export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className="crm-badge" style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}>
      {text}
    </span>
  );
}

/// Un controllo di validità accanto a un codice (partita IVA, codice fiscale, IBAN).
export function ValidityNote({ value, isValid, message }: { value: string; isValid: (value: string) => boolean; message: string }) {
  if (value.trim().length === 0 || isValid(value)) return null;
  return (
    <span className="crm-validity">
      <Icon icon={TriangleAlert} size={12} /> {message}
    </span>
  );
}

/// Una riga «etichetta: valore» delle schede, selezionabile.
export function DetailRow({ title, value, valid }: { title: string; value: string; valid?: boolean | null }) {
  return (
    <>
      <div className="secondary" style={{ textAlign: "right" }}>{title}</div>
      <div className="row" style={{ gap: 4, alignItems: "baseline" }}>
        <span className="selectable" style={{ wordBreak: "break-word" }}>{value}</span>
        {valid !== undefined && valid !== null && (
          <span
            title={valid ? "Il codice di controllo torna" : "Il codice di controllo non torna: controlla il valore"}
            style={{ color: valid ? Colors.green : Colors.orange, display: "inline-flex", alignSelf: "center" }}
          >
            <Icon icon={valid ? BadgeCheck : TriangleAlert} size={13} />
          </span>
        )}
      </div>
    </>
  );
}

/// Un'attività in elenco: icona, testo, data, contatto; le cose da fare con la spunta.
export function ActivityRow({ activity, showCompany = false }: { activity: Activity; showCompany?: boolean }) {
  const crm = model().crm;
  const contact = crm.contact(activity.contactID);
  const company = showCompany ? crm.company(activity.companyID) : null;
  const overdue = isOverdue(activity);
  const parts: ReactNode[] = [kindTitle(activity.kind), Format.date(activity.date)];
  if (contact) parts.push(fullName(contact));
  if (company) parts.push(company.name);
  if (activity.kind === "task" && activity.due) {
    parts.push(
      <span style={{ color: overdue ? "var(--red)" : undefined, fontWeight: overdue ? 600 : 400 }}>entro il {Format.date(activity.due)}</span>,
    );
  }
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 10, flex: 1, minWidth: 0 }}>
      {activity.kind === "task" ? (
        <button
          className="btn plain icon"
          style={{ padding: 0, marginTop: 1, width: 16, justifyContent: "center", color: activity.isDone ? Colors.green : "var(--secondary)" }}
          onClick={(event) => {
            event.stopPropagation();
            void model().toggleDone(activity);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          title={activity.isDone ? "Segna da fare" : "Segna come fatta"}
        >
          <Icon icon={activity.isDone ? DoneIcon : Circle} size={16} />
        </button>
      ) : (
        <span className="secondary" style={{ width: 16, display: "inline-flex", marginTop: 1 }}>
          <Icon icon={kindIcon(activity.kind)} size={15} />
        </span>
      )}
      <div className="col" style={{ gap: 3, minWidth: 0, flex: 1 }}>
        <div
          className="crm-clamp"
          style={{ textDecoration: activity.isDone ? "line-through" : undefined, color: activity.isDone ? "var(--secondary)" : undefined }}
        >
          {activity.text}
        </div>
        <div className="caption secondary row" style={{ gap: 6, flexWrap: "wrap" }}>
          {parts.map((part, index) => (
            <span key={index} className="row" style={{ gap: 6 }}>
              {index > 0 && <span>·</span>}
              {part}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/// Una trattativa in elenco.
export function DealRow({ deal, showCompany = false }: { deal: Deal; showCompany?: boolean }) {
  const crm = model().crm;
  const company = showCompany ? crm.company(deal.companyID) : null;
  const contact = crm.contact(deal.contactID);
  return (
    <div className="row" style={{ gap: 12, flex: 1, minWidth: 0 }}>
      <div className="col" style={{ gap: 3, flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }} className="truncate">{deal.title || "Trattativa"}</span>
        <span className="caption secondary row" style={{ gap: 6 }}>
          {company && <span>{company.name}</span>}
          {contact && <span>{fullName(contact)}</span>}
          {deal.expectedClose && <span>chiusura prevista {Format.date(deal.expectedClose)}</span>}
        </span>
      </div>
      <Badge text={stageTitle(deal.stage)} color={stageColor(deal.stage)} />
      <div className="col" style={{ gap: 2, alignItems: "flex-end", minWidth: 100 }}>
        <span className="digits">{Format.amount(deal.amount)}</span>
        {isOpen(deal.stage) && <span className="caption secondary">{deal.probability}%</span>}
      </div>
    </div>
  );
}

/// Un documento in elenco.
export function DocumentRow({ document }: { document: CRMDocument }) {
  const app = useObserved(model());
  const original = originalOf(document);
  const answers = answersOf(document).length;
  return (
    <div className="row" style={{ gap: 12, flex: 1, minWidth: 0, padding: "2px 0" }}>
      <span className="secondary" style={{ width: 28, display: "inline-flex", justifyContent: "center" }}>
        <Icon icon={formatIcon(document.format)} size={22} />
      </span>
      <div className="col" style={{ gap: 3, flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }} className="truncate">{document.title}</span>
        <span className="caption secondary truncate">
          {[formatTitle(document.format), original?.fileName ?? "", Format.date(document.created)].filter((part) => part.length > 0).join(" · ")}
        </span>
      </div>
      {app.busyDocuments.has(document.id) ? (
        <Spinner />
      ) : anonymizedOf(document) ? (
        <Badge text="Anonimizzato" color={Colors.green} />
      ) : (
        <Badge text="Da anonimizzare" color={Colors.orange} />
      )}
      {answers > 0 && <Badge text={answers === 1 ? "1 versione AI" : `${answers} versioni AI`} color={Colors.indigo} />}
    </div>
  );
}

// MARK: Menu contestuale (tasto destro, come `.contextMenu`)

export type ContextMenuOpener = (event: ReactMouseEvent, items: MenuEntry[]) => void;

export function useContextMenu(): [ContextMenuOpener, ReactNode] {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const open: ContextMenuOpener = (event, items) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items });
  };
  const element = menu ? <ContextMenu {...menu} onClose={() => setMenu(null)} /> : null;
  return [open, element];
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  // Dentro la finestra anche vicino ai bordi.
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    });
  }, [x, y]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  return (
    <div className="menu" ref={ref} style={{ position: "fixed", ...position }}>
      {items.map((item, index) =>
        item.separator ? (
          <div key={index} className="menu-sep" />
        ) : (
          <div
            key={index}
            className={`menu-item ${item.disabled ? "disabled" : ""}`}
            style={item.destructive ? { color: "var(--red)" } : undefined}
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
          >
            {item.icon && <Icon icon={item.icon} size={14} />}
            {item.label}
          </div>
        ),
      )}
    </div>
  );
}

// MARK: Trascinamento dei file (come `.dropDestination`)

/// Gestori per trascinare file su una vista: aggiunge i documenti al progetto (o al cliente).
export function useFileDrop(onPaths: (paths: string[]) => void): { targeted: boolean; handlers: Record<string, (event: React.DragEvent) => void> } {
  const [targeted, setTargeted] = useState(false);
  const depth = useRef(0);
  const handlers = {
    onDragEnter: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      depth.current += 1;
      setTargeted(true);
    },
    onDragOver: (event: React.DragEvent) => {
      if (event.dataTransfer.types.includes("Files")) event.preventDefault();
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setTargeted(false);
    },
    onDrop: (event: React.DragEvent) => {
      depth.current = 0;
      setTargeted(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;
      event.preventDefault();
      onPaths(files.map((file) => window.anonimaiker.pathForFile(file)).filter((path) => path.length > 0));
    },
  };
  return { targeted, handlers };
}

/// Il bordo tratteggiato mentre si trascina.
export function DropOverlay({ visible }: { visible: boolean }) {
  return visible ? <div className="crm-drop" /> : null;
}

/// Un gruppo con titolo (come `GroupBox`).
export function GroupBox({ icon, title, children }: { icon: Parameters<typeof Icon>[0]["icon"]; title: string; children: ReactNode }) {
  return (
    <div className="crm-groupbox">
      <div className="crm-groupbox-title"><Icon icon={icon} size={14} /> {title}</div>
      <div className="card">{children}</div>
    </div>
  );
}
