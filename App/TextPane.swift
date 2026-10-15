import AppKit
import SwiftUI

// MARK: - Un riquadro di testo (NSTextView)
//
// A sinistra si scrive o si incolla (e si trascinano i file .txt e .md); a destra il risultato, in sola lettura, con le
// parti evidenziate. NSTextView regge anche documenti lunghi; le sostituzioni automatiche (virgolette, trattini,
// correzioni) sono spente: il testo deve restare esattamente quello dell'utente.

struct TextPane: NSViewRepresentable {
    @Binding var text: String
    var highlights: [NSRange] = []
    var isEditable = true
    var onDropFile: ((URL) -> Void)?

    static let font = NSFont.systemFont(ofSize: 14)
    static let highlightFont = NSFont.systemFont(ofSize: 14, weight: .semibold)

    static var paragraph: NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 3
        return style
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = false

        let size = scrollView.contentSize
        let textView = PaneTextView(frame: NSRect(origin: .zero, size: size))
        textView.minSize = NSSize(width: 0, height: size.height)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.containerSize = NSSize(width: size.width, height: CGFloat.greatestFiniteMagnitude)
        textView.textContainer?.widthTracksTextView = true
        textView.textContainerInset = NSSize(width: 14, height: 14)
        textView.drawsBackground = false
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isAutomaticLinkDetectionEnabled = false
        textView.isContinuousSpellCheckingEnabled = false
        textView.isGrammarCheckingEnabled = false
        textView.font = Self.font
        textView.textColor = .labelColor
        textView.defaultParagraphStyle = Self.paragraph
        textView.typingAttributes = [.font: Self.font, .foregroundColor: NSColor.labelColor, .paragraphStyle: Self.paragraph]
        textView.delegate = context.coordinator
        scrollView.documentView = textView
        apply(to: textView, coordinator: context.coordinator)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let textView = scrollView.documentView as? PaneTextView else { return }
        apply(to: textView, coordinator: context.coordinator)
    }

    private func apply(to textView: PaneTextView, coordinator: Coordinator) {
        textView.isEditable = isEditable
        textView.isSelectable = true
        textView.onDropFile = onDropFile
        if isEditable {
            if textView.string != text {
                textView.string = text
                coordinator.shown = text
            }
        } else if coordinator.shown != text || coordinator.shownHighlights != highlights {
            textView.textStorage?.setAttributedString(Self.attributed(text, highlights: highlights))
            coordinator.shown = text
            coordinator.shownHighlights = highlights
            textView.scrollToBeginningOfDocument(nil)
        }
    }

    /// Il testo con le parti evidenziate (segnaposto o dati rimessi).
    static func attributed(_ text: String, highlights: [NSRange]) -> NSAttributedString {
        let result = NSMutableAttributedString(string: text, attributes: [.font: font, .foregroundColor: NSColor.labelColor,
                                                                           .paragraphStyle: paragraph])
        let mark: [NSAttributedString.Key: Any] = [.font: highlightFont, .foregroundColor: NSColor.controlAccentColor,
                                                    .backgroundColor: NSColor.controlAccentColor.withAlphaComponent(0.14)]
        for range in highlights where NSMaxRange(range) <= result.length {
            result.addAttributes(mark, range: range)
        }
        return result
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: TextPane
        var shown: String?
        var shownHighlights: [NSRange] = []

        init(_ parent: TextPane) {
            self.parent = parent
        }

        func textDidChange(_ notification: Notification) {
            guard parent.isEditable, let textView = notification.object as? NSTextView else { return }
            shown = textView.string
            parent.text = textView.string
        }
    }
}

/// NSTextView che accetta i file .txt e .md trascinati (li apre invece di incollarne il percorso).
final class PaneTextView: NSTextView {
    var onDropFile: ((URL) -> Void)?

    private func droppedFile(_ sender: NSDraggingInfo) -> URL? {
        guard onDropFile != nil else { return nil }
        let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]
        return urls?.first
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        droppedFile(sender) != nil ? .copy : super.draggingEntered(sender)
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        droppedFile(sender) != nil ? .copy : super.draggingUpdated(sender)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        if let url = droppedFile(sender), let onDropFile {
            onDropFile(url)
            return true
        }
        return super.performDragOperation(sender)
    }
}
