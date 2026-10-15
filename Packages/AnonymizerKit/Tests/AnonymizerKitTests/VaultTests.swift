import Foundation
import Testing
@testable import AnonymizerKit

/// Il dizionario unico: stesso dato, stesso segnaposto; numeri mai riusati; clienti; salvataggio.
@Suite struct VaultTests {
    @Test func theSameValueKeepsItsPlaceholder() {
        var vault = Vault()
        func assign(_ label: String, _ value: String) -> String {
            let result = vault.placeholder(label: label, value: value)
            return result.placeholder + (result.isNew ? " nuovo" : "")
        }
        #expect(assign("FULLNAME", "Mario Rossi") == "[FULLNAME_1] nuovo")
        #expect(assign("FULLNAME", "  Mario Rossi ") == "[FULLNAME_1]")
        // Ogni grafia ha il suo segnaposto: riconvertendo, le maiuscole tornano com'erano.
        #expect(assign("FULLNAME", "MARIO ROSSI") == "[FULLNAME_2] nuovo")
        #expect(assign("FULLNAME", "Anna Neri") == "[FULLNAME_3] nuovo")
        #expect(assign("CITY", "Roma") == "[CITY_1] nuovo")
        // Stesso testo, categoria diversa: è un altro dato.
        #expect(assign("ORG", "Mario Rossi") == "[ORG_1] nuovo")
        #expect(vault.entries.map(\.placeholder) == ["[CITY_1]", "[FULLNAME_1]", "[FULLNAME_2]", "[FULLNAME_3]", "[ORG_1]"])
        #expect(vault.value(for: "[FULLNAME_2]") == "MARIO ROSSI")
    }

    /// Per la chat: senza badare a maiuscole e spazi, «mario  rossi» è la prima grafia nota di Mario Rossi.
    @Test func looseMatchingFindsTheFirstSpelling() throws {
        var vault = Vault()
        vault.placeholder(label: "FULLNAME", value: "Mario Rossi")
        vault.placeholder(label: "FULLNAME", value: "MARIO ROSSI")
        #expect(vault.placeholder(label: "FULLNAME", value: "mario  rossi", matching: .loose) == ("[FULLNAME_1]", false))
        #expect(vault.placeholder(forLabel: "FULLNAME", value: "mario rossi") == nil)
        // Tolta la prima grafia, la ricerca trova l'altra; anche dopo il salvataggio.
        vault.remove("[FULLNAME_1]")
        #expect(vault.placeholder(forLabel: "FULLNAME", value: "Mario rossi", matching: .loose) == "[FULLNAME_2]")
        let reloaded = try JSONDecoder().decode(Vault.self, from: JSONEncoder().encode(vault))
        #expect(reloaded.placeholder(forLabel: "FULLNAME", value: "mario ROSSI", matching: .loose) == "[FULLNAME_2]")
    }

    /// Un numero cancellato non torna libero: un file vecchio non riavrà mai la persona sbagliata.
    @Test func removedNumbersAreNeverReused() throws {
        var vault = Vault()
        vault.placeholder(label: "FULLNAME", value: "Mario Rossi")
        vault.placeholder(label: "FULLNAME", value: "Anna Neri")
        vault.remove("[FULLNAME_2]")
        #expect(vault.value(for: "[FULLNAME_2]") == nil)
        #expect(vault.placeholder(label: "FULLNAME", value: "Luca Bianchi").placeholder == "[FULLNAME_3]")
        // Anche dopo il salvataggio.
        var reloaded = try JSONDecoder().decode(Vault.self, from: JSONEncoder().encode(vault))
        #expect(reloaded == vault)
        #expect(reloaded.placeholder(label: "FULLNAME", value: "Sara Verdi").placeholder == "[FULLNAME_4]")
        // Il dato cancellato, se ritorna, prende un numero nuovo.
        #expect(reloaded.placeholder(label: "FULLNAME", value: "Anna Neri").placeholder == "[FULLNAME_5]")
    }

    @Test func entriesRememberTheirClients() {
        var vault = Vault()
        let rossi = UUID(), bianchi = UUID()
        vault.placeholder(label: "FULLNAME", value: "Mario Rossi", client: rossi)
        vault.placeholder(label: "FULLNAME", value: "Mario Rossi", client: bianchi)
        vault.placeholder(label: "EMAIL", value: "info@bianchi.it")
        vault.link("[EMAIL_1]", to: bianchi)
        #expect(vault.entry("[FULLNAME_1]")?.clients == [rossi, bianchi])
        #expect(vault.entry("[EMAIL_1]")?.clients == [bianchi])
    }

    @Test func aNewerVaultIsNotOpened() throws {
        let json = #"{"version": 99, "entries": [], "counters": {}}"#
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(Vault.self, from: Data(json.utf8)) }
    }
}
