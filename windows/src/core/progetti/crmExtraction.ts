import { Masking } from "../anonimizzazione";
import { nonEmptyLines } from "../chat/chatModel";
import type { CRMDatabase } from "../crm/crmDatabase";
import { Company, Contact } from "../crm/crmModel";
import { Vault } from "../dizionario";

// MARK: - Il CRM del progetto si riempie dai documenti
//
// Dopo l'anonimizzazione, il testo con i segnaposto dice dove sono persone e aziende. Si legge riga per riga (in una
// tabella una riga è una riga del foglio): ogni nome diventa una persona, ogni azienda un'azienda. Se su una riga c'è
// una sola persona, email, telefono e codice fiscale della riga sono suoi, e così l'azienda se è una sola. Nome e
// cognome in due colonne vicine («Mario» «Rossi») sono una persona sola. Chi c'è già non si duplica: si completano
// solo i campi vuoti.

export class CRMExtractionReport {
  newPeople = 0;
  newCompanies = 0;
  updatedPeople = 0;

  get isEmpty(): boolean {
    return this.newPeople === 0 && this.newCompanies === 0 && this.updatedPeople === 0;
  }

  /// «12 persone e 3 aziende nuove nel CRM»
  get summary(): string {
    const parts: string[] = [];
    if (this.newPeople > 0) parts.push(this.newPeople === 1 ? "1 persona" : `${this.newPeople} persone`);
    if (this.newCompanies > 0) parts.push(this.newCompanies === 1 ? "1 azienda" : `${this.newCompanies} aziende`);
    let text = parts.length === 0 ? "" : parts.join(" e ") + (this.newPeople + this.newCompanies === 1 ? " nuova" : " nuove") + " nel CRM";
    if (this.updatedPeople > 0) {
      text += (text.length === 0 ? "" : ", ") + (this.updatedPeople === 1 ? "1 persona completata" : `${this.updatedPeople} persone completate`);
    }
    return text;
  }

  equals(other: CRMExtractionReport): boolean {
    return this.newPeople === other.newPeople && this.newCompanies === other.newCompanies && this.updatedPeople === other.updatedPeople;
  }
}

const placeholder = /\[([A-Z_]+)_(\d+)\]/g;

/// I campi di un contatto che si completano dalla riga.
type FillableField = "email" | "phone" | "taxCode";

export const CRMExtraction = {
  /// Aggiunge al CRM persone e aziende trovate nel testo anonimizzato `anonymized`. `source` è il nome del documento.
  /// Come `inout` in Swift: `database` si modifica.
  apply(anonymized: string, vault: Vault, source: string, database: CRMDatabase, now: Date = new Date()): CRMExtractionReport {
    const report = new CRMExtractionReport();
    const companiesByName = new Map<string, string>();
    for (const company of database.companies) {
      const k = key(Masking.withoutLegalForm(company.name));
      if (!companiesByName.has(k)) companiesByName.set(k, company.id);
    }
    const peopleByName = new Map<string, string>();
    for (const contact of database.contacts) {
      const k = key(Contact.fullName(contact));
      if (!peopleByName.has(k)) peopleByName.set(k, contact.id);
    }
    const note = `Trovato in «${source}».`;

    for (const text of nonEmptyLines(anonymized)) {
      const found = CRMExtraction.values(text, vault);
      if (found.length === 0) continue;

      // Aziende della riga.
      const lineCompanies: string[] = [];
      for (const item of found) {
        if (item.label !== "ORG") continue;
        const name = item.value;
        const k = key(Masking.withoutLegalForm(name));
        if (k.length === 0 || Masking.isPlace("ORG", name)) continue;
        const id = companiesByName.get(k);
        if (id !== undefined) {
          lineCompanies.push(id);
        } else {
          const company = Company.create();
          company.name = name;
          company.notes = note.replaceAll("Trovato", "Trovata");
          database.saveCompany(company, now);
          companiesByName.set(k, company.id);
          lineCompanies.push(company.id);
          report.newCompanies += 1;
        }
      }

      // Persone della riga: nome e cognome in due celle vicine diventano una persona sola.
      const names = found.filter((item) => item.label === "FULLNAME").map((item) => item.value);
      let people: string[];
      if (names.length === 2 && names.every((name) => words(name).length === 1)) {
        people = [names.join(" ")];
      } else {
        people = names.filter((name) => words(name).length >= 2);
      }
      people = people.filter((name) => !Masking.isPlace("FULLNAME", name));
      const single = people.length === 1;
      for (const name of people) {
        const k = key(name);
        let contact: Contact;
        let isNew = false;
        const existingID = peopleByName.get(k);
        const existing = existingID !== undefined ? database.contact(existingID) : null;
        if (existing !== null) {
          contact = { ...existing };
        } else {
          const parts = splitOnce(name);
          contact = Contact.create(parts[0], parts.length > 1 ? parts[1] : "");
          contact.notes = note;
          isNew = true;
        }
        let changed = false;
        if (single) {
          const fill = (field: FillableField, label: string) => {
            const value = found.find((item) => item.label === label)?.value;
            if (contact[field].length > 0 || value === undefined) return;
            contact[field] = value;
            changed = true;
          };
          fill("email", "EMAIL");
          fill("phone", "TELEPHONENUM");
          fill("taxCode", "CF");
          if (contact.companyID === null && lineCompanies.length === 1) {
            contact.companyID = lineCompanies[0];
            changed = true;
          }
        }
        if (!isNew && !changed) continue;
        database.saveContact(contact, now);
        peopleByName.set(k, contact.id);
        if (isNew) report.newPeople += 1;
        else report.updatedPeople += 1;
      }
    }
    return report;
  },

  /// I valori veri dei segnaposto di una riga, nell'ordine.
  values(line: string, vault: Vault): { label: string; value: string }[] {
    const result: { label: string; value: string }[] = [];
    for (const match of line.matchAll(placeholder)) {
      const entry = vault.entry(match[0]);
      if (entry !== null) result.push({ label: entry.label, value: entry.value });
    }
    return result;
  },
};

function key(name: string): string {
  return Vault.normalized(name);
}

/// `name.split(separator: " ")`: le parole, senza quelle vuote.
function words(name: string): string[] {
  return name.split(" ").filter((word) => word.length > 0);
}

/// `name.split(separator: " ", maxSplits: 1)`: la prima parola e il resto (gli spazi in testa non contano).
function splitOnce(name: string): string[] {
  const start = name.search(/[^ ]/);
  if (start < 0) return [];
  const rest = name.slice(start);
  const space = rest.indexOf(" ");
  if (space < 0) return [rest];
  const tail = rest.slice(space + 1);
  return tail.length === 0 ? [rest.slice(0, space)] : [rest.slice(0, space), tail];
}
