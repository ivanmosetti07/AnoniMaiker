import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// MARK: - Un riquadro di testo
//
// A sinistra si scrive o si incolla (e si trascinano i file); a destra il risultato, in sola lettura, con le parti
// evidenziate. Le correzioni automatiche sono spente: il testo deve restare esattamente quello dell'utente.

export interface TextRange {
  /// In unità UTF-16, come NSRange (e come gli indici delle stringhe di JavaScript).
  location: number;
  length: number;
}

/// I segnaposto in un testo («[FULLNAME_1]», anche con gli spazi dell'AI: «[ IBAN_2 ]»).
const placeholderPattern = /\[\s*[A-Z][A-Z_]*_\p{Nd}+\s*\]/gu;

export function placeholderRanges(text: string): TextRange[] {
  return Array.from(text.matchAll(placeholderPattern), (match) => ({ location: match.index ?? 0, length: match[0].length }));
}

/// Il testo spezzato in parti normali ed evidenziate.
export function highlighted(text: string, highlights: readonly TextRange[], className = "ph"): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  const sorted = [...highlights].filter((range) => range.location + range.length <= text.length).sort((a, b) => a.location - b.location);
  sorted.forEach((range, index) => {
    if (range.location < at) return;
    if (range.location > at) parts.push(text.slice(at, range.location));
    parts.push(<mark key={index} className={className}>{text.slice(range.location, range.location + range.length)}</mark>);
    at = range.location + range.length;
  });
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

export function TextPane({
  text, onChange, highlights = [], editable = true, onDropFile, placeholder, highlightClass = "ph",
}: {
  text: string;
  onChange?: (text: string) => void;
  highlights?: readonly TextRange[];
  editable?: boolean;
  /// Un file trascinato si apre invece di incollarne il percorso.
  onDropFile?: (file: File) => void;
  /// Quello che si vede finché il riquadro è vuoto.
  placeholder?: ReactNode;
  highlightClass?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const readonly = useRef<HTMLDivElement>(null);
  const parts = useMemo(() => (editable ? [] : highlighted(text, highlights, highlightClass)), [text, highlights, editable, highlightClass]);
  // Un risultato nuovo si mostra dall'inizio.
  useEffect(() => {
    if (!editable) readonly.current?.scrollTo({ top: 0 });
  }, [text, editable]);

  const dropHandlers = onDropFile
    ? {
        onDragOver: (event: React.DragEvent) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragging(true);
          }
        },
        onDragLeave: () => setDragging(false),
        onDrop: (event: React.DragEvent) => {
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) {
            event.preventDefault();
            onDropFile(file);
          }
        },
      }
    : {};

  return (
    <div className={`textpane ${dragging ? "drop" : ""}`} {...dropHandlers}>
      {editable ? (
        <textarea
          value={text}
          onChange={(event) => onChange?.(event.target.value)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
        />
      ) : (
        <div className="readonly" ref={readonly}>{parts}</div>
      )}
      {placeholder && text.length === 0 && (
        <div style={{ position: "absolute", top: 14, left: 19, right: 19, pointerEvents: "none", color: "var(--tertiary)", lineHeight: 1.5 }}>
          {placeholder}
        </div>
      )}
    </div>
  );
}
