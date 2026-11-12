import AppKit
import SwiftUI

// MARK: - L'aspetto dell'app, uguale alla versione Windows
//
// Gli stessi colori, raggi e misure di `windows/src/renderer/styles.css`: chi cambia uno dei due cambia anche l'altro
// (vedi CLAUDE.md). I colori seguono il tema chiaro o scuro del Mac.

enum Tema {
    // MARK: Colori

    static let accent = Color(hex: 0xFF914D)
    static let accentStrong = Color(hex: 0xF07A30)
    static let accentSoft = Color(hex: 0xFF914D).opacity(0.14)
    static let onAccent = Color.white

    static let bg = Color(light: 0xF7F7F8, dark: 0x1E1E20)
    static let surface = Color(light: 0xFFFFFF, dark: 0x262628)
    static let sidebar = Color(light: 0xF0F0F2, dark: 0x1A1A1C)
    static let bar = Color(light: 0xF3F3F5, dark: 0x222224)
    static let hover = Color(lightGray: 0, lightAlpha: 0.05, darkGray: 1, darkAlpha: 0.06)
    static let selected = Color(lightGray: 0, lightAlpha: 0.08, darkGray: 1, darkAlpha: 0.10)
    static let border = Color(lightGray: 0, lightAlpha: 0.10, darkGray: 1, darkAlpha: 0.12)
    static let text = Color(light: 0x1C1C1E, dark: 0xF2F2F4)
    static let secondary = Color(light: 0x1C1C1E, dark: 0xF2F2F4, alpha: 0.62)
    static let tertiary = Color(light: 0x1C1C1E, dark: 0xF2F2F4, alpha: 0.38)

    static let red = Color(hex: 0xE5383B)
    static let orange = Color(hex: 0xE8820C)
    static let green = Color(hex: 0x2F9E44)
    static let blue = Color(hex: 0x1F6FEB)
    static let purple = Color(hex: 0x8250DF)
    static let indigo = Color(hex: 0x5856D6)
    static let gray = Color(hex: 0x8E8E93)

    // MARK: Misure

    static let radius: CGFloat = 8
    static let radiusSmall: CGFloat = 5
    static let radiusSheet: CGFloat = 10
    static let radiusCard: CGFloat = 12

    // MARK: Caratteri (corpo 13 come su Windows)

    static let body = Font.system(size: 13)
    static let callout = Font.system(size: 12)
    static let caption = Font.system(size: 11)
    static let headline = Font.system(size: 13, weight: .semibold)
    static let barTitle = Font.system(size: 15, weight: .semibold)
    static let title2 = Font.system(size: 16, weight: .semibold)
    static let title = Font.system(size: 20, weight: .semibold)
    static let largeTitle = Font.system(size: 26, weight: .semibold)
    static let mono = Font.system(size: 12, design: .monospaced)
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: alpha)
    }

    /// Un colore diverso nel tema chiaro e in quello scuro.
    init(light: UInt32, dark: UInt32, alpha: Double = 1) {
        self.init(nsColor: NSColor(name: nil) { appearance in
            let hex = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                           blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
        })
    }

    /// Nero o bianco trasparenti (velature di passaggio, selezione, bordi).
    init(lightGray: CGFloat, lightAlpha: CGFloat, darkGray: CGFloat, darkAlpha: CGFloat) {
        self.init(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(white: darkGray, alpha: darkAlpha) : NSColor(white: lightGray, alpha: lightAlpha)
        })
    }
}

// MARK: - Pulsanti

/// Il pulsante principale: arancione pieno, testo bianco («Anonimizza», «Salva», «Crea»).
struct PrimaryButtonStyle: ButtonStyle {
    var large = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        PrimaryButton(configuration: configuration, large: large, isEnabled: isEnabled)
    }

    private struct PrimaryButton: View {
        let configuration: Configuration
        let large: Bool
        let isEnabled: Bool
        @State private var hovering = false

        var body: some View {
            configuration.label
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Tema.onAccent)
                .padding(.horizontal, large ? 16 : 10)
                .padding(.vertical, large ? 7 : 5)
                .background(hovering || configuration.isPressed ? Tema.accentStrong : Tema.accent,
                            in: .rect(cornerRadius: Tema.radiusSmall))
                .opacity(isEnabled ? 1 : 0.45)
                .contentShape(.rect)
                .onHover { hovering = $0 && isEnabled }
        }
    }
}

/// Il pulsante normale: piatto, bordo sottile, sfondo bianco.
struct FlatButtonStyle: ButtonStyle {
    var small = false
    var large = false
    var destructive = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        FlatButton(configuration: configuration, small: small, large: large, destructive: destructive, isEnabled: isEnabled)
    }

    private struct FlatButton: View {
        let configuration: Configuration
        let small: Bool
        let large: Bool
        let destructive: Bool
        let isEnabled: Bool
        @State private var hovering = false

        var body: some View {
            configuration.label
                .font(.system(size: small ? 12 : 13))
                .foregroundStyle(destructive ? Tema.red : Tema.text)
                .padding(.horizontal, small ? 8 : large ? 16 : 10)
                .padding(.vertical, small ? 2 : large ? 7 : 5)
                .background {
                    RoundedRectangle(cornerRadius: Tema.radiusSmall)
                        .fill(Tema.surface)
                        .overlay(RoundedRectangle(cornerRadius: Tema.radiusSmall).fill(configuration.isPressed ? Tema.selected : hovering ? Tema.hover : .clear))
                        .overlay(RoundedRectangle(cornerRadius: Tema.radiusSmall).strokeBorder(Tema.border))
                }
                .opacity(isEnabled ? 1 : 0.45)
                .contentShape(.rect)
                .onHover { hovering = $0 && isEnabled }
        }
    }
}

/// Un pulsante senza bordo (icone delle barre, voci leggere); acceso: arancio tenue.
struct PlainIconButtonStyle: ButtonStyle {
    var isOn = false
    var padding: CGFloat = 5
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        PlainButton(configuration: configuration, isOn: isOn, padding: padding, isEnabled: isEnabled)
    }

    private struct PlainButton: View {
        let configuration: Configuration
        let isOn: Bool
        let padding: CGFloat
        let isEnabled: Bool
        @State private var hovering = false

        var body: some View {
            configuration.label
                .font(.system(size: 13))
                .foregroundStyle(isOn ? Tema.accentStrong : Tema.text)
                .padding(padding)
                .background(isOn ? Tema.accentSoft : configuration.isPressed ? Tema.selected : hovering ? Tema.hover : .clear,
                            in: .rect(cornerRadius: Tema.radiusSmall))
                .opacity(isEnabled ? 1 : 0.45)
                .contentShape(.rect)
                .onHover { hovering = $0 && isEnabled }
        }
    }
}

/// Un collegamento arancione (al posto del blu di sistema).
struct AccentLinkButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        LinkButton(configuration: configuration, isEnabled: isEnabled)
    }

    private struct LinkButton: View {
        let configuration: Configuration
        let isEnabled: Bool
        @State private var hovering = false

        var body: some View {
            configuration.label
                .foregroundStyle(Tema.accentStrong)
                .underline(hovering)
                .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.45)
                .contentShape(.rect)
                .onHover { hovering = $0 && isEnabled }
        }
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var primary: PrimaryButtonStyle { PrimaryButtonStyle() }
    static var primaryLarge: PrimaryButtonStyle { PrimaryButtonStyle(large: true) }
}

extension ButtonStyle where Self == FlatButtonStyle {
    static var flat: FlatButtonStyle { FlatButtonStyle() }
    static var flatSmall: FlatButtonStyle { FlatButtonStyle(small: true) }
    static var flatLarge: FlatButtonStyle { FlatButtonStyle(large: true) }
    static var flatDestructive: FlatButtonStyle { FlatButtonStyle(destructive: true) }
}

extension ButtonStyle where Self == PlainIconButtonStyle {
    static var plainIcon: PlainIconButtonStyle { PlainIconButtonStyle() }
    static func plainIcon(on: Bool) -> PlainIconButtonStyle { PlainIconButtonStyle(isOn: on) }
}

extension ButtonStyle where Self == AccentLinkButtonStyle {
    static var accentLink: AccentLinkButtonStyle { AccentLinkButtonStyle() }
}

// MARK: - Barra in cima a una vista

/// La barra della vista: titolo e sottotitolo a sinistra, i pulsanti a destra (al posto della barra della finestra).
/// Lo spazio a destra resta libero per il pulsante della chat.
struct TopBar<Leading: View, Actions: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var leading: Leading
    @ViewBuilder var actions: Actions

    var body: some View {
        HStack(spacing: 4) {
            leading
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(Tema.barTitle).lineLimit(1)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(Tema.caption).foregroundStyle(Tema.secondary).lineLimit(1).truncationMode(.middle)
                }
            }
            .padding(.trailing, 12)
            Spacer(minLength: 0)
            actions
        }
        .padding(.leading, 12)
        .padding(.trailing, TopBar.chatButtonSpace)
        .padding(.vertical, 8)
        .frame(minHeight: 48)
        .background(Tema.bar)
        .overlay(alignment: .bottom) { Rectangle().fill(Tema.border).frame(height: 1) }
    }

    /// Il pulsante della chat sta sopra l'angolo in alto a destra di ogni vista.
    static var chatButtonSpace: CGFloat { 56 }
}

extension TopBar where Leading == EmptyView {
    init(title: String, subtitle: String? = nil, @ViewBuilder actions: () -> Actions) {
        self.init(title: title, subtitle: subtitle, leading: { EmptyView() }, actions: actions)
    }
}

/// Il separatore fra i gruppi di pulsanti di una barra.
struct BarSeparator: View {
    var body: some View {
        Rectangle().fill(Tema.border).frame(width: 1, height: 22).padding(.horizontal, 6)
    }
}

/// Un'icona per un pulsante di barra, con il suggerimento.
struct BarIcon: View {
    let title: String
    let symbol: String

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 15))
            .frame(width: 17, height: 17)
            .accessibilityLabel(title)
    }
}

// MARK: - Controlli

/// Il controllo a segmenti arancione (al posto del segmentato di sistema): largo quanto il testo.
struct AccentSegmented<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(value: Value, title: String)]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(options.enumerated()), id: \.offset) { index, option in
                if index > 0 { Rectangle().fill(Tema.border).frame(width: 1) }
                Button {
                    selection = option.value
                } label: {
                    Text(option.title)
                        .font(Tema.body)
                        .foregroundStyle(option.value == selection ? Tema.onAccent : Tema.text)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                        .frame(maxHeight: .infinity)
                        .background(option.value == selection ? Tema.accent : Tema.surface)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
        .fixedSize()
        .clipShape(.rect(cornerRadius: Tema.radiusSmall))
        .overlay(RoundedRectangle(cornerRadius: Tema.radiusSmall).strokeBorder(Tema.border))
    }
}

/// Un campo di testo con il bordo e l'anello arancione quando è attivo.
struct StyledFieldModifier: ViewModifier {
    @FocusState private var focused: Bool

    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .font(Tema.body)
            .focused($focused)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(Tema.surface, in: .rect(cornerRadius: Tema.radiusSmall))
            .overlay(RoundedRectangle(cornerRadius: Tema.radiusSmall).strokeBorder(focused ? Tema.accent : Tema.border))
            .background(RoundedRectangle(cornerRadius: Tema.radiusSmall + 2).stroke(focused ? Tema.accentSoft : .clear, lineWidth: 4))
    }
}

extension View {
    func styledField() -> some View { modifier(StyledFieldModifier()) }
}

/// Il campo di ricerca delle barre.
struct SearchField: View {
    @Binding var text: String
    var prompt = "Cerca"
    var width: CGFloat?

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(Tema.tertiary)
            TextField(prompt, text: $text).textFieldStyle(.plain).font(Tema.body)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Tema.tertiary) }
                    .buttonStyle(.plain)
                    .help("Cancella")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .frame(width: width)
        .background(Tema.surface, in: .rect(cornerRadius: Tema.radiusSmall))
        .overlay(RoundedRectangle(cornerRadius: Tema.radiusSmall).strokeBorder(Tema.border))
    }
}

/// La barra di avanzamento sottile, arancione.
struct ThinProgressBar: View {
    let value: Double
    var width: CGFloat = 160
    var tint: Color = Tema.accent

    var body: some View {
        ZStack(alignment: .leading) {
            Capsule().fill(Tema.selected)
            Capsule().fill(tint).frame(width: width * min(1, max(0, value)))
        }
        .frame(width: width, height: 6)
        .animation(.easeOut(duration: 0.2), value: value)
    }
}

// MARK: - Contenitori

/// Una card: superficie bianca, bordo sottile, angoli di 8 (al posto di GroupBox).
struct Card<Content: View>: View {
    var padding: CGFloat = 14
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Tema.surface, in: .rect(cornerRadius: Tema.radius))
            .overlay(RoundedRectangle(cornerRadius: Tema.radius).strokeBorder(Tema.border))
    }
}

/// Un riquadro con il titolo fuori (icona e testo 12 semibold), come i gruppi delle schede.
struct TitledCard<Content: View>: View {
    let title: String
    var symbol: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol).font(.system(size: 13)) }
                Text(title).font(.system(size: 12, weight: .semibold))
            }
            .padding(.leading, 2)
            Card { content }
        }
    }
}

/// Una sezione di modulo: intestazione grigia, righe in un riquadro bianco, nota sotto (al posto di `.formStyle(.grouped)`).
struct FormSection<Content: View>: View {
    var header: String?
    var footer: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let header {
                Text(header).font(.system(size: 12, weight: .semibold)).foregroundStyle(Tema.secondary).padding(.horizontal, 4)
            }
            VStack(spacing: 0) {
                _VariadicView.Tree(FormRowsLayout()) { content }
            }
            .background(Tema.surface, in: .rect(cornerRadius: Tema.radius))
            .overlay(RoundedRectangle(cornerRadius: Tema.radius).strokeBorder(Tema.border))
            if let footer {
                Text(footer).font(Tema.caption).foregroundStyle(Tema.secondary).lineSpacing(3).padding(.horizontal, 4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.bottom, 18)
    }
}

/// Le righe di una sezione: separate da una linea sottile.
private struct FormRowsLayout: _VariadicView_MultiViewRoot {
    func body(children: _VariadicView.Children) -> some View {
        ForEach(children) { child in
            if child.id != children.first?.id { Rectangle().fill(Tema.border).frame(height: 1) }
            child
        }
    }
}

/// Una riga di modulo: altezza minima 38, margini 9×12.
struct FormRow<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: 10) { content }
            .font(Tema.body)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frame(minHeight: 38)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// «Etichetta … valore» in una riga di modulo.
struct LabeledRow: View {
    let label: String
    let value: String

    var body: some View {
        FormRow {
            Text(label).fixedSize()
            Spacer(minLength: 12)
            // Il valore va a capo invece di troncarsi.
            Text(value).foregroundStyle(Tema.secondary).textSelection(.enabled).multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true).layoutPriority(1)
        }
    }
}

/// La riga dei pulsanti in fondo a una finestra sopra la finestra: sfondo «bar», bordo in alto.
struct SheetActions<Leading: View, Trailing: View>: View {
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 8) {
            leading
            Spacer(minLength: 8)
            trailing
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Tema.bar)
        .overlay(alignment: .top) { Rectangle().fill(Tema.border).frame(height: 1) }
    }
}

extension SheetActions where Leading == EmptyView {
    init(@ViewBuilder trailing: () -> Trailing) {
        self.init(leading: { EmptyView() }, trailing: trailing)
    }
}

/// La barra in fondo a una vista (risultati, suggerimenti): sfondo «bar», bordo in alto.
struct BottomBar<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: 10) { content }
            .font(Tema.callout)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(minHeight: 36)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Tema.bar)
            .overlay(alignment: .top) { Rectangle().fill(Tema.border).frame(height: 1) }
    }
}

/// Il vuoto di una vista (al posto di ContentUnavailableView): icona 34, titolo 16, testo largo al massimo 420.
struct EmptyState<Actions: View>: View {
    let title: String
    let symbol: String
    var message: String?
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol).font(.system(size: 34, weight: .light)).foregroundStyle(Tema.tertiary)
            Text(title).font(Tema.title2).foregroundStyle(Tema.text)
            if let message {
                Text(message).font(Tema.body).foregroundStyle(Tema.secondary).multilineTextAlignment(.center).lineSpacing(3)
                    .frame(maxWidth: 420).fixedSize(horizontal: false, vertical: true)
            }
            actions.padding(.top, 4)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension EmptyState where Actions == EmptyView {
    init(_ title: String, symbol: String, message: String? = nil) {
        self.init(title: title, symbol: symbol, message: message, actions: { EmptyView() })
    }
}

/// Una riga di un elenco piatto: margini 8×16, linea sotto, passaggio del mouse, selezione arancio tenue.
struct FlatRowModifier: ViewModifier {
    var isSelected = false
    @State private var hovering = false

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? Tema.accentSoft : hovering ? Tema.hover : .clear)
            .overlay(alignment: .bottom) { Rectangle().fill(Tema.border).frame(height: 1) }
            .contentShape(.rect)
            .onHover { hovering = $0 }
    }
}

extension View {
    func flatRow(selected: Bool = false) -> some View { modifier(FlatRowModifier(isSelected: selected)) }

    /// La superficie bianca di elenchi e riquadri di contenuto.
    func surfaceBackground() -> some View { background(Tema.surface) }
}

/// Una riga della barra laterale: arancio tenue quando è scelta, con l'icona arancione.
struct SidebarRow<Trailing: View>: View {
    let title: String
    let symbol: String
    let isSelected: Bool
    var action: () -> Void
    @ViewBuilder var trailing: Trailing
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 13))
                    .foregroundStyle(isSelected ? Tema.accentStrong : Tema.text)
                    .frame(width: 18, height: 16)
                Text(title).font(Tema.body).foregroundStyle(Tema.text).lineLimit(1)
                Spacer(minLength: 4)
                trailing
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(isSelected ? Tema.accentSoft : hovering ? Tema.hover : .clear, in: .rect(cornerRadius: Tema.radiusSmall))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .padding(.horizontal, 8)
        .padding(.vertical, 0.5)
    }
}

extension SidebarRow where Trailing == EmptyView {
    init(title: String, symbol: String, isSelected: Bool, action: @escaping () -> Void) {
        self.init(title: title, symbol: symbol, isSelected: isSelected, action: action, trailing: { EmptyView() })
    }
}

/// L'intestazione di un gruppo della barra laterale.
struct SidebarSectionHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Tema.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.top, 10)
            .padding(.bottom, 2)
    }
}

/// Il titolo di una finestra sopra la finestra: icona 22 e testo 20 semibold.
struct SheetTitle: View {
    let title: String
    let symbol: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 20))
            Text(title).font(Tema.title)
        }
    }
}

/// Il contorno tratteggiato arancione quando si trascina un file sopra un'area.
struct DropOutline: View {
    var inset: CGFloat = 6
    var radius: CGFloat = 8

    var body: some View {
        RoundedRectangle(cornerRadius: radius)
            .strokeBorder(Tema.accent, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
            .padding(inset)
            .allowsHitTesting(false)
    }
}

// MARK: - Aggiunte della cornice (finestra, impostazioni, fogli)

/// La casella di spunta arancione (al posto della blu di sistema), 15 punti come su Windows.
struct AccentCheckboxStyle: ToggleStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                RoundedRectangle(cornerRadius: 3.5)
                    .fill(configuration.isOn ? Tema.accent : Tema.surface)
                    .overlay(RoundedRectangle(cornerRadius: 3.5).strokeBorder(configuration.isOn ? Tema.accent : Tema.tertiary, lineWidth: 1))
                    .overlay {
                        if configuration.isOn {
                            Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Tema.onAccent)
                        }
                    }
                    .frame(width: 15, height: 15)
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
                configuration.label.font(Tema.body).foregroundStyle(Tema.text).fixedSize(horizontal: false, vertical: true)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.45)
    }
}

extension ToggleStyle where Self == AccentCheckboxStyle {
    static var accentCheckbox: AccentCheckboxStyle { AccentCheckboxStyle() }
}

/// Una scelta da un menu con l'aspetto di un pulsante piatto (al posto del menu a comparsa di sistema, come i `select`
/// di Windows): il valore scelto e la freccia in giù.
struct FlatMenuPicker<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(value: Value, title: String)]

    var body: some View {
        Menu {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                Button {
                    selection = option.value
                } label: {
                    if option.value == selection { Label(option.title, systemImage: "checkmark") } else { Text(option.title) }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(options.first { $0.value == selection }?.title ?? "").lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(Tema.secondary)
            }
        }
        .menuStyle(.button)
        .buttonStyle(.flat)
        .menuIndicator(.hidden)
        .fixedSize()
    }
}
