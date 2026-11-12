import SwiftUI

// MARK: - Le risposte di GPT in Markdown, a blocchi
//
// Come `windows/src/renderer/chat/markdown.tsx`: paragrafi, titoli, elenchi, citazioni, codice e linee; dentro ogni
// blocco grassetto, corsivo, codice e collegamenti con `AttributedString(markdown:)` (solo in linea). Niente HTML: il testo
// resta testo. I collegamenti si aprono nel browser, e solo quelli del web e della posta.

enum ChatMarkdown {
    enum Block: Equatable {
        case paragraph([String])
        case heading(level: Int, text: String)
        case code(String)
        case list(ordered: Bool, start: Int, items: [[String]])
        case quote([String])
        case rule
    }

    private static let fence = /^\s{0,3}(```|~~~)/
    private static let heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
    private static let bullet = /^(\s*)([-*+])\s+(.*)$/
    private static let numbered = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
    private static let quote = /^\s{0,3}>\s?(.*)$/
    private static let rule = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

    /// Le righe divise in blocchi.
    static func blocks(_ text: String) -> [Block] {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")
        var blocks: [Block] = []
        var index = 0
        func isBlank(_ line: String) -> Bool { line.trimmingCharacters(in: .whitespaces).isEmpty }
        while index < lines.count {
            let line = lines[index]
            if isBlank(line) {
                index += 1
                continue
            }
            if let opening = line.firstMatch(of: fence) {
                let marker = String(opening.1)
                var body: [String] = []
                index += 1
                while index < lines.count, !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix(marker) {
                    body.append(lines[index])
                    index += 1
                }
                index += 1
                blocks.append(.code(body.joined(separator: "\n")))
                continue
            }
            if let title = line.wholeMatch(of: heading) {
                blocks.append(.heading(level: title.1.count, text: String(title.2)))
                index += 1
                continue
            }
            if line.wholeMatch(of: rule) != nil {
                blocks.append(.rule)
                index += 1
                continue
            }
            if line.wholeMatch(of: quote) != nil {
                var body: [String] = []
                while index < lines.count, let match = lines[index].wholeMatch(of: quote) {
                    body.append(String(match.1))
                    index += 1
                }
                blocks.append(.quote(body))
                continue
            }
            let bulletMatch = line.wholeMatch(of: bullet)
            let numberMatch = bulletMatch == nil ? line.wholeMatch(of: numbered) : nil
            if bulletMatch != nil || numberMatch != nil {
                let ordered = bulletMatch == nil
                var items: [[String]] = []
                while index < lines.count {
                    let current = lines[index]
                    let item = ordered ? current.wholeMatch(of: numbered).map { String($0.3) } : current.wholeMatch(of: bullet).map { String($0.3) }
                    if let item {
                        items.append([item])
                    } else if !isBlank(current), current.first?.isWhitespace == true, !items.isEmpty {
                        // Il seguito di una voce (rientrato).
                        items[items.count - 1].append(current.trimmingCharacters(in: .whitespaces))
                    } else {
                        break
                    }
                    index += 1
                }
                blocks.append(.list(ordered: ordered, start: numberMatch.flatMap { Int($0.2) } ?? 1, items: items))
                continue
            }
            var body: [String] = []
            while index < lines.count {
                let current = lines[index]
                if isBlank(current) || current.firstMatch(of: fence) != nil || current.wholeMatch(of: heading) != nil
                    || current.wholeMatch(of: quote) != nil || current.wholeMatch(of: bullet) != nil
                    || current.wholeMatch(of: numbered) != nil || current.wholeMatch(of: rule) != nil { break }
                body.append(current)
                index += 1
            }
            blocks.append(.paragraph(body))
        }
        return blocks
    }

    /// Solo indirizzi del web e della posta: niente `javascript:` né file.
    static func isSafe(_ url: URL) -> Bool {
        ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "")
    }

    private static let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    /// Le righe di un blocco con grassetto, corsivo, codice e collegamenti (gli a capo restano).
    static func inline(_ lines: [String]) -> AttributedString {
        let text = lines.map { $0.replacing(/\ {2,}$/, with: "") }.joined(separator: "\n")
        var attributed = (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
        // Gli indirizzi scritti così come sono diventano collegamenti.
        let plain = String(attributed.characters)
        for match in detector?.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) ?? [] {
            guard let url = match.url, let found = Range(match.range, in: plain), plain[found].lowercased().hasPrefix("http"),
                  isSafe(url), let range = Range(match.range, in: attributed),
                  attributed[range].runs.allSatisfy({ $0.link == nil }) else { continue }
            attributed[range].link = url
        }
        for run in attributed.runs {
            if let link = run.link {
                if isSafe(link) {
                    attributed[run.range].foregroundColor = Tema.accentStrong
                    attributed[run.range].underlineStyle = .single
                } else {
                    attributed[run.range].link = nil
                }
            }
            if run.inlinePresentationIntent?.contains(.code) == true {
                attributed[run.range].font = Tema.mono
                attributed[run.range].backgroundColor = Tema.selected
            }
        }
        return attributed
    }
}

/// Una risposta di GPT: i blocchi uno sotto l'altro, come le regole `.md` di `chat.css`.
struct ChatMarkdownView: View {
    let text: String

    var body: some View {
        let blocks = ChatMarkdown.blocks(text)
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                view(for: block)
                    .padding(.top, index > 0 && isHeading(block) ? 4 : 0)
            }
        }
        .font(Tema.body)
        .lineSpacing(3)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.openURL, OpenURLAction { url in ChatMarkdown.isSafe(url) ? .systemAction : .discarded })
    }

    private func isHeading(_ block: ChatMarkdown.Block) -> Bool {
        if case .heading = block { return true }
        return false
    }

    @ViewBuilder private func view(for block: ChatMarkdown.Block) -> some View {
        switch block {
        case .paragraph(let lines):
            Text(ChatMarkdown.inline(lines))
                .fixedSize(horizontal: false, vertical: true)
        case .heading(let level, let text):
            // # → 16, ## → 14, gli altri 13 (come h3, h4, h5 su Windows).
            Text(ChatMarkdown.inline([text]))
                .font(.system(size: level == 1 ? 16 : level == 2 ? 14 : 13, weight: .semibold))
                .lineSpacing(1)
                .fixedSize(horizontal: false, vertical: true)
        case .code(let code):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(Tema.mono)
                    .lineSpacing(2)
                    .fixedSize()
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Tema.surface, in: .rect(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Tema.border))
        case .list(let ordered, let start, let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { offset, item in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(ordered ? "\(start + offset)." : "•")
                            .monospacedDigit()
                            .frame(minWidth: 14, alignment: .trailing)
                        Text(ChatMarkdown.inline(item))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(.leading, 6)
        case .quote(let lines):
            Text(ChatMarkdown.inline(lines))
                .foregroundStyle(Tema.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 10)
                .padding(.vertical, 2)
                .overlay(alignment: .leading) { Rectangle().fill(Tema.border).frame(width: 3) }
        case .rule:
            Rectangle().fill(Tema.border).frame(height: 1).padding(.vertical, 2)
        }
    }
}
