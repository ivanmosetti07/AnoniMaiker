import AnonymizerKit
import SwiftUI

// MARK: - Anteprime dei file: testo o tabelle

/// L'anteprima di un file: le tabelle (CSV, Excel) cella per cella, il resto come testo.
struct DocumentPreviewView: View {
    let preview: DocumentPreview
    /// Il testo da mostrare al posto dell'anteprima testuale (con le evidenziazioni già calcolate).
    var highlights: [NSRange] = []
    /// Per le tabelle: evidenzia i segnaposto, oppure le celle diverse da quelle di un'altra anteprima.
    var highlightPlaceholders = false
    var comparedWith: DocumentPreview?

    var body: some View {
        switch preview {
        case .text(let text):
            TextPane(text: .constant(text), highlights: highlights.isEmpty && highlightPlaceholders ? Revealer.placeholderRanges(in: text) : highlights,
                     isEditable: false)
        case .sheets(let sheets):
            TablePreview(sheets: sheets, highlightPlaceholders: highlightPlaceholders,
                         compared: { if case .sheets(let other) = comparedWith { other } else { nil } }())
        }
    }
}

/// Le celle di uno o più fogli (le prime 200 righe).
struct TablePreview: View {
    let sheets: [PreviewSheet]
    var highlightPlaceholders = false
    /// Le stesse tabelle prima del cambio: le celle diverse si evidenziano.
    var compared: [PreviewSheet]?
    @State private var selected = 0

    private var index: Int { min(selected, max(0, sheets.count - 1)) }

    var body: some View {
        VStack(spacing: 0) {
            if sheets.count > 1 {
                Picker("Foglio", selection: $selected) {
                    ForEach(sheets.indices, id: \.self) { Text(sheets[$0].name).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .padding(8)
                Divider()
            }
            if let sheet = sheets.indices.contains(index) ? sheets[index] : nil, !sheet.rows.isEmpty {
                let widths = Self.columnWidths(sheet.rows)
                ScrollView([.horizontal, .vertical]) {
                    Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
                        ForEach(sheet.rows.indices, id: \.self) { r in
                            GridRow {
                                ForEach(sheet.rows[r].indices, id: \.self) { c in
                                    cell(sheet.rows[r][c], width: widths[c], header: r == 0, changed: changed(r, c))
                                }
                            }
                        }
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
            } else {
                Text("Foglio vuoto").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private func changed(_ row: Int, _ column: Int) -> Bool {
        guard let compared, compared.indices.contains(index), compared[index].rows.indices.contains(row),
              compared[index].rows[row].indices.contains(column) else { return false }
        return compared[index].rows[row][column] != sheets[index].rows[row][column]
    }

    /// La larghezza di ogni colonna, dalla riga di testo più lunga (fra 70 e 280 punti). Con la larghezza decisa prima,
    /// la griglia misura l'altezza delle righe sul testo già andato a capo: una cella lunga allunga la sua riga invece di
    /// coprire quelle sotto.
    static func columnWidths(_ rows: [[String]]) -> [CGFloat] {
        let columns = rows.map(\.count).max() ?? 0
        return (0..<columns).map { c in
            let longest = rows.compactMap { $0.indices.contains(c) ? $0[c] : nil }
                .flatMap { $0.split(separator: "\n", omittingEmptySubsequences: false) }
                .map(\.count).max() ?? 0
            return min(280, max(70, CGFloat(longest) * 7.4 + 18))
        }
    }

    private func cell(_ text: String, width: CGFloat, header: Bool, changed: Bool) -> some View {
        Text(attributed(text))
            .font(.callout)
            .fontWeight(header ? .semibold : .regular)
            .lineLimit(8)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .frame(width: width, alignment: .topLeading)
            .frame(maxHeight: .infinity, alignment: .topLeading)
            .background(changed ? Color.accentColor.opacity(0.14) : header ? Color.secondary.opacity(0.08) : .clear)
            .overlay(Rectangle().stroke(Color.secondary.opacity(0.18), lineWidth: 0.5))
    }

    private func attributed(_ text: String) -> AttributedString {
        var result = AttributedString(text)
        guard highlightPlaceholders else { return result }
        for range in Revealer.placeholderRanges(in: text) {
            if let span = Range(range, in: result) {
                result[span].foregroundColor = .accentColor
                result[span].inlinePresentationIntent = .stronglyEmphasized
            }
        }
        return result
    }
}
