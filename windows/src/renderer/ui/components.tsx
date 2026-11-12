import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Search, X } from "lucide-react";

// MARK: - I mattoni dell'interfaccia
//
// Gli equivalenti dei controlli di SwiftUI usati dall'app Mac: pulsanti con icona, barra degli strumenti, etichette,
// banner, avanzamento, finestre sopra la finestra (sheet), avvisi, menu e campi.

export function Icon({ icon: IconType, size = 15, color, style }: { icon: LucideIcon; size?: number; color?: string; style?: CSSProperties }) {
  return <IconType size={size} strokeWidth={1.75} color={color} style={style} aria-hidden />;
}

/// Un'etichetta con icona (come `Label` di SwiftUI).
export function Label({ icon, children, className, title, color }: { icon?: LucideIcon; children: ReactNode; className?: string; title?: string; color?: string }) {
  return (
    <span className={`label ${className ?? ""}`} title={title} style={color ? { color } : undefined}>
      {icon && <Icon icon={icon} size={14} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

type ButtonKind = "default" | "primary" | "plain" | "link" | "destructive";

export function Button({
  icon, children, onClick, disabled, kind = "default", small, title, shortcut, className, iconOnly, type = "button",
}: {
  icon?: LucideIcon;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: ButtonKind;
  small?: boolean;
  /// Il suggerimento (come `.help`).
  title?: string;
  /// Scorciatoia da tastiera: «Ctrl+O», «Ctrl+Enter», «Ctrl+Shift+C», «Escape».
  shortcut?: string;
  className?: string;
  /// Solo l'icona, il testo come suggerimento.
  iconOnly?: boolean;
  type?: "button" | "submit";
}) {
  useShortcut(shortcut, () => !disabled && onClick?.());
  const classes = ["btn", kind === "default" ? "" : kind, small ? "small" : "", iconOnly ? "icon" : "", className ?? ""].join(" ");
  const tip = [title ?? (iconOnly && typeof children === "string" ? children : undefined), shortcut ? `(${shortcut})` : undefined].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} onClick={onClick} disabled={disabled} title={tip || undefined}>
      {icon && <Icon icon={icon} size={small ? 13 : 15} />}
      {!iconOnly && children}
    </button>
  );
}

/// Una scorciatoia da tastiera per tutta la finestra.
export function useShortcut(shortcut: string | undefined, action: () => void) {
  const ref = useRef(action);
  ref.current = action;
  useEffect(() => {
    if (!shortcut) return;
    const parts = shortcut.toLowerCase().split("+");
    const key = parts[parts.length - 1];
    const ctrl = parts.includes("ctrl");
    const shift = parts.includes("shift");
    const alt = parts.includes("alt");
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) !== ctrl || event.shiftKey !== shift || event.altKey !== alt) return;
      const pressed = event.key.toLowerCase();
      if (pressed === key || (key === "enter" && pressed === "enter") || (key === "esc" && pressed === "escape")) {
        event.preventDefault();
        ref.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcut]);
}

/// La barra in cima a una sezione: titolo, sottotitolo e pulsanti.
export function Toolbar({ title, subtitle, children, leading }: { title: string; subtitle?: string; children?: ReactNode; leading?: ReactNode }) {
  return (
    <div className="toolbar">
      {leading}
      <div className="titles">
        <span className="t truncate">{title}</span>
        {subtitle ? <span className="s truncate">{subtitle}</span> : null}
      </div>
      <div className="spacer" />
      {children}
    </div>
  );
}

export function ToolbarSeparator() {
  return <div className="sep" />;
}

export function Banner({ icon, children, tint = "orange" }: { icon: LucideIcon; children: ReactNode; tint?: "orange" | "red" | "blue" }) {
  return (
    <div className={`banner ${tint}`}>
      <Icon icon={icon} />
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

export function ProgressBar({ value, width = 160 }: { value: number; width?: number }) {
  return (
    <div className="progress" style={{ width }}>
      <div style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}

export function Spinner({ mini }: { mini?: boolean }) {
  return <div className={`spinner ${mini ? "mini" : ""}`} />;
}

/// Una finestra sopra la finestra (come `.sheet`): Esc la chiude.
export function Sheet({ children, onClose, width, actions }: { children: ReactNode; onClose?: () => void; width?: number; actions?: ReactNode }) {
  useShortcut(onClose ? "Escape" : undefined, () => onClose?.());
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className="sheet" style={{ width }} role="dialog">
        <div className="sheet-body">{children}</div>
        {actions && <div className="sheet-actions">{actions}</div>}
      </div>
    </div>
  );
}

/// Un avviso con un messaggio e i pulsanti (come `.alert` / `.confirmationDialog`).
export function Alert({ title, message, onClose, actions }: { title: string; message?: ReactNode; onClose: () => void; actions?: ReactNode }) {
  return (
    <Sheet onClose={onClose} width={420} actions={actions ?? <Button kind="primary" onClick={onClose}>OK</Button>}>
      <div className="col" style={{ gap: 10 }}>
        <div className="title2">{title}</div>
        {message && <div className="selectable" style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{message}</div>}
      </div>
    </Sheet>
  );
}

export interface MenuEntry {
  label?: string;
  icon?: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
  checked?: boolean;
  destructive?: boolean;
  separator?: boolean;
}

/// Un pulsante che apre un menu (come `Menu` di SwiftUI).
export function MenuButton({ label, items, className, align = "left", disabled }: { label: ReactNode; items: MenuEntry[]; className?: string; align?: "left" | "right"; disabled?: boolean }) {
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
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }} className={className}>
      <div onClick={() => !disabled && setOpen(!open)} style={{ display: "contents", opacity: disabled ? 0.45 : 1 }}>{label}</div>
      {open && <MenuList items={items} onPick={() => setOpen(false)} align={align} />}
    </div>
  );
}

function MenuList({ items, onPick, align }: { items: MenuEntry[]; onPick: () => void; align: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ top: "calc(100% + 4px)", [align]: 0 });
  // Se il menu esce dalla finestra in basso, si apre verso l'alto.
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect && rect.bottom > window.innerHeight - 8) setStyle({ bottom: "calc(100% + 4px)", [align]: 0 });
  }, [align]);
  return (
    <div className="menu" ref={ref} style={style}>
      {items.map((item, index) =>
        item.separator ? (
          <div key={index} className="menu-sep" />
        ) : (
          <div
            key={index}
            className={`menu-item ${item.disabled ? "disabled" : ""}`}
            style={item.destructive ? { color: "var(--red)" } : undefined}
            onClick={() => {
              onPick();
              item.onClick?.();
            }}
          >
            <span style={{ width: 15, display: "inline-flex" }}>{item.checked ? "✓" : item.icon ? <Icon icon={item.icon} size={14} /> : null}</span>
            {item.label}
          </div>
        ),
      )}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder = "Cerca", width }: { value: string; onChange: (value: string) => void; placeholder?: string; width?: number }) {
  return (
    <div className="search" style={{ width }}>
      <Icon icon={Search} size={13} />
      <input type="search" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {value && (
        <button className="btn plain icon" style={{ padding: 1 }} onClick={() => onChange("")} title="Cancella">
          <Icon icon={X} size={12} />
        </button>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, children, disabled }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="toggle" style={{ opacity: disabled ? 0.45 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button key={option.value} className={option.value === value ? "on" : ""} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/// Il vuoto di una sezione (come `ContentUnavailableView`).
export function EmptyState({ icon, title, message, children }: { icon: LucideIcon; title: string; message?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon icon={icon} size={34} />
      <div className="title2" style={{ color: "var(--text)" }}>{title}</div>
      {message && <div style={{ maxWidth: 420, lineHeight: 1.45 }}>{message}</div>}
      {children}
    </div>
  );
}
