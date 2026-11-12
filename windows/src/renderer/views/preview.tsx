import { useState, type ReactNode } from "react";
import type { DocumentPreview, PreviewSheet } from "../../core/documenti/segmentedText";
import { Segmented } from "../ui/components";
import { highlighted, placeholderRanges, TextPane, type TextRange } from "./textPane";

// MARK: - Anteprime dei file: testo o tabelle

/// L'anteprima di un file: le tabelle (CSV, Excel) cella per cella, il resto come testo.
export function DocumentPreviewView({
  preview, highlights = [], highlightPlaceholders = false, comparedWith, highlightClass,
}: {
  preview: DocumentPreview;
  /// Le parti da evidenziare nell'anteprima testuale.
  highlights?: readonly TextRange[];
  /// Per le tabelle: evidenzia i segnaposto, oppure le celle diverse da quelle di un'altra anteprima.
  highlightPlaceholders?: boolean;
  comparedWith?: DocumentPreview | null;
  highlightClass?: string;
}) {
  if (preview.kind === "text") {
    const ranges = highlights.length === 0 && highlightPlaceholders ? placeholderRanges(preview.text) : highlights;
    return <TextPane text={preview.text} highlights={ranges} editable={false} highlightClass={highlightClass} />;
  }
  return (
    <TablePreview
      sheets={preview.sheets}
      highlightPlaceholders={highlightPlaceholders}
      compared={comparedWith?.kind === "sheets" ? comparedWith.sheets : undefined}
    />
  );
}

/// La larghezza di ogni colonna, dalla riga di testo più lunga (fra 70 e 280 punti).
function columnWidths(rows: string[][]): number[] {
  const columns = Math.max(0, ...rows.map((row) => row.length));
  return Array.from({ length: columns }, (_, c) => {
    const longest = Math.max(0, ...rows.flatMap((row) => (c < row.length ? row[c].split("\n").map((line) => [...line].length) : [])));
    return Math.min(280, Math.max(70, longest * 7.4 + 18));
  });
}

/// Le celle di uno o più fogli (le prime 200 righe).
export function TablePreview({ sheets, highlightPlaceholders = false, compared }: { sheets: PreviewSheet[]; highlightPlaceholders?: boolean; compared?: PreviewSheet[] }) {
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, Math.max(0, sheets.length - 1));
  const sheet = sheets[index];

  const changed = (row: number, column: number) => {
    const other = compared?.[index]?.rows[row]?.[column];
    return other !== undefined && other !== sheet.rows[row][column];
  };
  const content = (text: string): ReactNode => (highlightPlaceholders ? highlighted(text, placeholderRanges(text)) : text);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--surface)" }}>
      {sheets.length > 1 && (
        <>
          <div style={{ padding: 8 }}>
            <Segmented value={String(index)} options={sheets.map((s, i) => ({ value: String(i), label: s.name }))} onChange={(value) => setSelected(Number(value))} />
          </div>
          <div className="divider" />
        </>
      )}
      {sheet && sheet.rows.length > 0 ? (
        <div style={{ flex: 1, overflow: "auto", padding: 10 }}>
          <table style={{ borderCollapse: "collapse", tableLayout: "fixed" }} className="selectable">
            <colgroup>{columnWidths(sheet.rows).map((width, c) => <col key={c} style={{ width }} />)}</colgroup>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      style={{
                        fontSize: 12,
                        fontWeight: r === 0 ? 600 : 400,
                        padding: "5px 8px",
                        verticalAlign: "top",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        border: "0.5px solid rgba(128,128,128,0.25)",
                        background: changed(r, c) ? "var(--accent-soft)" : r === 0 ? "var(--selected)" : undefined,
                      }}
                    >
                      {content(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">Foglio vuoto</div>
      )}
    </div>
  );
}
