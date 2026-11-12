import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type MenuEntry } from "../ui/components";

// MARK: - Pezzi comuni delle viste dell'app
//
// Le sezioni di un modulo raggruppato (`Form` con `.formStyle(.grouped)`), le righe «etichetta: valore»
// (`LabeledContent`) e il menu del clic destro (`.contextMenu`).

/// Una sezione di un modulo raggruppato: titolo sopra, righe in un riquadro, nota sotto.
export function FormSection({ header, footer, children }: { header?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="form-section">
      {header && <div className="form-section-header">{header}</div>}
      <div className="form-section-box">{children}</div>
      {footer && <div className="form-section-footer">{footer}</div>}
    </div>
  );
}

/// Una riga di una sezione.
export function FormRow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="form-row" style={style}>{children}</div>;
}

/// «Etichetta ……… valore».
export function LabeledContent({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="form-row">
      <span>{label}</span>
      <span className="spacer" />
      <span className="secondary selectable" style={{ textAlign: "right" }}>{children}</span>
    </div>
  );
}

/// Il menu del clic destro: `onContextMenu={menu.open}` sull'elemento e `{menu.element}` nella vista.
export function useContextMenu(items: () => MenuEntry[]) {
  const [position, setPosition] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  return {
    /// `override`: le voci da mostrare al posto di quelle di `items` (quando dipendono da cosa è stato cliccato).
    open: (event: React.MouseEvent, override?: MenuEntry[]) => {
      event.preventDefault();
      setPosition({ x: event.clientX, y: event.clientY, items: override ?? items() });
    },
    element: position ? <ContextMenu x={position.x} y={position.y} items={position.items} onClose={() => setPosition(null)} /> : null,
  };
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: x, top: y });
  // Dentro la finestra anche vicino ai bordi.
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setStyle({ left: Math.min(x, window.innerWidth - rect.width - 6), top: Math.min(y, window.innerHeight - rect.height - 6) });
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
    <div className="menu" ref={ref} style={{ ...style, position: "fixed", zIndex: 200 }}>
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
            <span style={{ width: 15, display: "inline-flex" }}>{item.checked ? "✓" : item.icon ? <Icon icon={item.icon} size={14} /> : null}</span>
            {item.label}
          </div>
        ),
      )}
    </div>
  );
}
