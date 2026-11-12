import { PIIDetectors } from "./piiDetectors";
import { characters, charIsWhitespace, icu } from "./piiText";

const emailRegex = icu(String.raw`^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$`, { global: false });

/** I controlli dei codici, per le schede del CRM (gli stessi che usa il motore). */
export const Validators = {
  isValidVATNumber(value: string): boolean {
    return PIIDetectors.pivaOK(value);
  },

  /** Codice fiscale di una persona (16 caratteri) o di una società (11 cifre, come la partita IVA). */
  isValidTaxCode(value: string): boolean {
    const compact = characters(value).filter((c) => !charIsWhitespace(c));
    return compact.length === 11 ? PIIDetectors.pivaOK(compact.join("")) : PIIDetectors.cfOK(compact.join(""));
  },

  isValidIBAN(value: string): boolean {
    return PIIDetectors.ibanOK(value);
  },

  isValidEmail(value: string): boolean {
    return emailRegex.test(value);
  },
};
