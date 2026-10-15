import Foundation

/// I controlli dei codici, per le schede del CRM (gli stessi che usa il motore).
public enum Validators {
    public static func isValidVATNumber(_ value: String) -> Bool { PIIDetectors.pivaOK(value) }

    /// Codice fiscale di una persona (16 caratteri) o di una società (11 cifre, come la partita IVA).
    public static func isValidTaxCode(_ value: String) -> Bool {
        let compact = value.filter { !$0.isWhitespace }
        return compact.count == 11 ? PIIDetectors.pivaOK(compact) : PIIDetectors.cfOK(compact)
    }

    public static func isValidIBAN(_ value: String) -> Bool { PIIDetectors.ibanOK(value) }

    public static func isValidEmail(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$"#, options: .regularExpression) != nil
    }
}
