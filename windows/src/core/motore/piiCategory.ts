import { characters } from "./piiText";

/** Le categorie che il motore riconosce, con il nome italiano e i gruppi delle Impostazioni. */
export const PIICategory = {
  /** Tutte le etichette, nell'ordine delle Impostazioni. */
  all: ["FULLNAME", "EMAIL", "TELEPHONENUM", "CF", "PIVA", "ID_DOC", "IBAN", "CREDITCARDNUMBER", "STREET",
    "BUILDINGNUM", "TARGA", "CATASTO", "DOCID", "IPADDR", "ORG", "AMOUNT", "DATE", "TIME", "AGE", "GENDER",
    "CITY", "PROVINCE", "ZIPCODE", "URL"] as readonly string[],

  /** Le etichette che possono stare in un segnaposto: quelle del motore più «altro dato» di «nascondi sempre». */
  get placeholderLabels(): readonly string[] {
    return [...PIICategory.all, "OTHER"];
  },

  names: {
    FULLNAME: "nomi", AGE: "età", GENDER: "generi", DATE: "date", TIME: "orari", STREET: "indirizzi", BUILDINGNUM: "numeri civici",
    ZIPCODE: "CAP", CITY: "città", PROVINCE: "province", EMAIL: "email", TELEPHONENUM: "telefoni", CF: "codici fiscali",
    PIVA: "partite IVA", ID_DOC: "documenti d'identità", IBAN: "IBAN", CREDITCARDNUMBER: "carte", AMOUNT: "importi", TARGA: "targhe",
    ORG: "aziende", OTHER: "altri dati", DOCID: "codici di atti", CATASTO: "dati catastali", URL: "indirizzi web", IPADDR: "indirizzi IP",
  } as Readonly<Record<string, string>>,

  /** Al singolare, per «1 codice fiscale» (non «1 codici fiscali»). */
  singularNames: {
    FULLNAME: "nome", GENDER: "genere", DATE: "data", TIME: "orario", STREET: "indirizzo", BUILDINGNUM: "numero civico",
    PROVINCE: "provincia", TELEPHONENUM: "telefono", CF: "codice fiscale", PIVA: "partita IVA", ID_DOC: "documento d'identità",
    CREDITCARDNUMBER: "carta", AMOUNT: "importo", TARGA: "targa", ORG: "azienda", OTHER: "altro dato", DOCID: "codice di atto",
    CATASTO: "dato catastale", URL: "indirizzo web", IPADDR: "indirizzo IP",
  } as Readonly<Record<string, string>>,

  /** Nome della categoria al plurale (per gli elenchi) o accordato con `count`. */
  name(label: string, count = 2): string {
    if (count === 1 && Object.hasOwn(PIICategory.singularNames, label)) return PIICategory.singularNames[label];
    return Object.hasOwn(PIICategory.names, label) ? PIICategory.names[label] : label.toLowerCase();
  },

  /** «Codici fiscali»: il nome con l'iniziale maiuscola, per le Impostazioni. */
  title(label: string): string {
    const chars = characters(PIICategory.name(label));
    if (chars.length === 0) return "";
    return chars[0].toUpperCase() + chars.slice(1).join("");
  },

  /** Dati che dicono chi è una persona o danno accesso a un suo conto. All'AI il valore vero non serve:
   *  le basta ricopiare il segnaposto dove va. */
  personal: ["FULLNAME", "EMAIL", "TELEPHONENUM", "CF", "PIVA", "ID_DOC", "IBAN", "CREDITCARDNUMBER",
    "STREET", "BUILDINGNUM", "TARGA", "CATASTO", "DOCID", "IPADDR"] as readonly string[],
  /** In un CRM l'azienda è il cliente: si nasconde di serie. */
  companies: ["ORG"] as readonly string[],
  /** Dati con cui l'AI lavora (conti, scadenze, orari, luoghi, siti): restano in chiaro, a meno di sceglierli. */
  workingData: ["AMOUNT", "DATE", "TIME", "AGE", "GENDER", "CITY", "PROVINCE", "ZIPCODE", "URL"] as readonly string[],

  /** Cosa si nasconde di serie: dati personali e aziende (una copia nuova a ogni lettura). */
  get defaultHidden(): Set<string> {
    return new Set([...PIICategory.personal, ...PIICategory.companies]);
  },

  /** Dati che identificano da soli chi c'è dietro: quelli già nel dizionario si nascondono anche dove il modello non li vede. */
  identifying: new Set(["FULLNAME", "ORG", "EMAIL", "TELEPHONENUM", "CF", "PIVA", "ID_DOC", "IBAN",
    "CREDITCARDNUMBER", "TARGA", "IPADDR", "DOCID", "URL"]) as ReadonlySet<string>,
};
