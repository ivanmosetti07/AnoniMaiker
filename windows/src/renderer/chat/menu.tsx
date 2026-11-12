import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, ChevronRight } from "lucide-react";
import { Icon } from "../ui/components";

// MARK: - I menu della chat
//
// Come `MenuButton` di ui/components, con in più i titoli di gruppo (i `Picker` dentro un `Menu` del Mac) e i
// sottomenu («Documento del progetto ›»), che il menu dell'allegato e quello del modello usano.

export type ChatMenuEntry =
  | { kind: "item"; label: string; icon?: LucideIcon; checked?: boolean; disabled?: boolean; destructive?: boolean; onClick: () => void }
  | { kind: "header"; label: string }
  | { kind: "separator" }
  | { kind: "submenu"; label: string; icon?: LucideIcon; disabled?: boolean; items: ChatMenuEntry[] };

export function ChatMenu({ label, items, title, disabled, align = "left" }: { label: ReactNode; items: ChatMenuEntry[]; title?: string; disabled?: boolean; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <div ref={ref} className="chat-menu-anchor">
      <button type="button" className={`chat-menu-label ${open ? "open" : ""}`} disabled={disabled} title={title} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && <ChatMenuList items={items} align={align} onPick={() => setOpen(false)} />}
    </div>
  );
}

function ChatMenuList({ items, align, onPick, nested }: { items: ChatMenuEntry[]; align: "left" | "right"; onPick: () => void; nested?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<number | null>(null);
  const [style, setStyle] = useState<CSSProperties>(nested ? { top: -5, left: "100%" } : { top: "calc(100% + 4px)", [align]: 0 });
  // Se il menu esce dalla finestra, si apre dall'altra parte.
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const next: CSSProperties = { ...style };
    if (rect.bottom > window.innerHeight - 8) {
      if (nested) next.top = Math.max(-rect.top + 8, window.innerHeight - 8 - rect.bottom - 5);
      else {
        delete next.top;
        next.bottom = "calc(100% + 4px)";
      }
    }
    if (nested && rect.right > window.innerWidth - 8) {
      delete next.left;
      next.right = "100%";
    }
    setStyle(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="menu chat-menu" ref={ref} style={style}>
      {items.map((item, index) => {
        switch (item.kind) {
          case "separator":
            return <div key={index} className="menu-sep" />;
          case "header":
            return <div key={index} className="chat-menu-header">{item.label}</div>;
          case "submenu":
            return (
              <div
                key={index}
                className={`menu-item chat-submenu ${item.disabled ? "disabled" : ""} ${submenu === index ? "active" : ""}`}
                onMouseEnter={() => setSubmenu(index)}
                onClick={() => setSubmenu(index)}
              >
                <span className="chat-menu-mark">{item.icon ? <Icon icon={item.icon} size={14} /> : null}</span>
                <span className="truncate" style={{ flex: 1 }}>{item.label}</span>
                <Icon icon={ChevronRight} size={13} />
                {submenu === index && !item.disabled && <ChatMenuList items={item.items} align="left" onPick={onPick} nested />}
              </div>
            );
          case "item":
            return (
              <div
                key={index}
                className={`menu-item ${item.disabled ? "disabled" : ""}`}
                style={item.destructive ? { color: "var(--red)" } : undefined}
                onMouseEnter={() => setSubmenu(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  onPick();
                  item.onClick();
                }}
              >
                <span className="chat-menu-mark">{item.checked ? <Icon icon={Check} size={14} /> : item.icon ? <Icon icon={item.icon} size={14} /> : null}</span>
                <span className="truncate">{item.label}</span>
              </div>
            );
        }
      })}
    </div>
  );
}
