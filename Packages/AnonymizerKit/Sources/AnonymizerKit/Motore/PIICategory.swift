import Foundation

/// Le categorie che il motore riconosce, con il nome italiano e i gruppi delle Impostazioni.
public enum PIICategory {
    /// Tutte le etichette, nell'ordine delle Impostazioni.
    public static let all = ["FULLNAME", "EMAIL", "TELEPHONENUM", "CF", "PIVA", "ID_DOC", "IBAN", "CREDITCARDNUMBER", "STREET",
                             "BUILDINGNUM", "TARGA", "CATASTO", "DOCID", "IPADDR", "ORG", "AMOUNT", "DATE", "TIME", "AGE", "GENDER",
                             "CITY", "PROVINCE", "ZIPCODE", "URL"]

    static let names: [String: String] = [
        "FULLNAME": "nomi", "AGE": "età", "GENDER": "generi", "DATE": "date", "TIME": "orari", "STREET": "indirizzi", "BUILDINGNUM": "numeri civici",
        "ZIPCODE": "CAP", "CITY": "città", "PROVINCE": "province", "EMAIL": "email", "TELEPHONENUM": "telefoni", "CF": "codici fiscali",
        "PIVA": "partite IVA", "ID_DOC": "documenti d'identità", "IBAN": "IBAN", "CREDITCARDNUMBER": "carte", "AMOUNT": "importi", "TARGA": "targhe",
        "ORG": "aziende", "DOCID": "codici di atti", "CATASTO": "dati catastali", "URL": "indirizzi web", "IPADDR": "indirizzi IP",
    ]

    /// Al singolare, per «1 codice fiscale» (non «1 codici fiscali»).
    static let singularNames: [String: String] = [
        "FULLNAME": "nome", "GENDER": "genere", "DATE": "data", "TIME": "orario", "STREET": "indirizzo", "BUILDINGNUM": "numero civico",
        "PROVINCE": "provincia", "TELEPHONENUM": "telefono", "CF": "codice fiscale", "PIVA": "partita IVA", "ID_DOC": "documento d'identità",
        "CREDITCARDNUMBER": "carta", "AMOUNT": "importo", "TARGA": "targa", "ORG": "azienda", "DOCID": "codice di atto",
        "CATASTO": "dato catastale", "URL": "indirizzo web", "IPADDR": "indirizzo IP",
    ]

    /// Nome della categoria al plurale (per gli elenchi) o accordato con `count`.
    public static func name(_ label: String, count: Int = 2) -> String {
        if count == 1, let one = singularNames[label] { return one }
        return names[label] ?? label.lowercased()
    }

    /// «Codici fiscali»: il nome con l'iniziale maiuscola, per le Impostazioni.
    public static func title(_ label: String) -> String {
        let name = name(label)
        return name.prefix(1).uppercased() + name.dropFirst()
    }

    /// Dati che dicono chi è una persona o danno accesso a un suo conto. All'AI il valore vero non serve:
    /// le basta ricopiare il segnaposto dove va.
    public static let personal = ["FULLNAME", "EMAIL", "TELEPHONENUM", "CF", "PIVA", "ID_DOC", "IBAN", "CREDITCARDNUMBER",
                                  "STREET", "BUILDINGNUM", "TARGA", "CATASTO", "DOCID", "IPADDR"]
    /// In un CRM l'azienda è il cliente: si nasconde di serie.
    public static let companies = ["ORG"]
    /// Dati con cui l'AI lavora (conti, scadenze, orari, luoghi, siti): restano in chiaro, a meno di sceglierli.
    public static let workingData = ["AMOUNT", "DATE", "TIME", "AGE", "GENDER", "CITY", "PROVINCE", "ZIPCODE", "URL"]

    /// Cosa si nasconde di serie: dati personali e aziende.
    public static let defaultHidden = Set(personal + companies)

    /// Dati che identificano da soli chi c'è dietro: quelli già nel dizionario si nascondono anche dove il modello non li vede.
    static let identifying: Set<String> = ["FULLNAME", "ORG", "EMAIL", "TELEPHONENUM", "CF", "PIVA", "ID_DOC", "IBAN",
                                           "CREDITCARDNUMBER", "TARGA", "IPADDR", "DOCID", "URL"]
}
