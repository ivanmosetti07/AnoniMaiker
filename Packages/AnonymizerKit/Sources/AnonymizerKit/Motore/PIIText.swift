import Foundation

// MARK: - Testo indicizzato per code point
//
// Le posizioni del motore sono in code point (come le stringhe di Python della pipeline originale): così i risultati
// del porting coincidono con quelli di riferimento.

/// Testo indicizzato per caratteri Unicode (code point).
struct PIIText: Sendable {
    let string: String
    let scalars: [Unicode.Scalar]
    /// Da offset UTF-16 (NSRegularExpression) a indice di code point.
    private let fromUTF16: [Int]

    init(_ string: String) {
        self.string = string
        scalars = Array(string.unicodeScalars)
        var map: [Int] = []
        map.reserveCapacity(string.utf16.count + 1)
        for (index, scalar) in scalars.enumerated() {
            map.append(index)
            if scalar.utf16.count == 2 { map.append(index) }
        }
        map.append(scalars.count)
        fromUTF16 = map
    }

    var count: Int { scalars.count }

    subscript(index: Int) -> Unicode.Scalar { scalars[index] }

    func slice(_ start: Int, _ end: Int) -> String {
        guard start < end else { return "" }
        var view = String.UnicodeScalarView()
        view.append(contentsOf: scalars[max(0, start)..<min(end, scalars.count)])
        return String(view)
    }

    /// Match di un'espressione regolare, con le posizioni in code point.
    func matches(_ regex: NSRegularExpression) -> [(start: Int, end: Int)] {
        regex.matches(in: string, range: NSRange(location: 0, length: string.utf16.count)).map {
            (fromUTF16[$0.range.location], fromUTF16[$0.range.location + $0.range.length])
        }
    }
}

extension Unicode.Scalar {
    /// `str.isspace()` di Python.
    var pyIsSpace: Bool { properties.isWhitespace || (0x1C...0x1F).contains(value) }

    /// `str.isalnum()` di Python: lettere (categorie L*) o caratteri numerici.
    var pyIsAlnum: Bool {
        switch properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: return true
        default: return properties.numericType != nil
        }
    }

    var pyIsDigit: Bool { properties.numericType == .decimal || properties.numericType == .digit }

    /// Carattere interno a una parola.
    var isWordCharacter: Bool { pyIsAlnum || self == "_" }

    var isASCIIAlnum: Bool { isASCII && (("0"..."9").contains(self) || ("A"..."Z").contains(self) || ("a"..."z").contains(self)) }
}
