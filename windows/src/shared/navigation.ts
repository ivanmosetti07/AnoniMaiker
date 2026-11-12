// MARK: - La navigazione dell'app
//
// Le sezioni della barra laterale e le pile di navigazione del CRM (da AppModel.swift). Solo JavaScript: le usano sia il
// modello (nel preload) sia l'interfaccia.

export type AppSection = "anonymize" | "reveal" | "documents" | "people" | "companies" | "deals" | "activities" | "dictionary";

export const AppSection = {
  allCases: ["anonymize", "reveal", "documents", "people", "companies", "deals", "activities", "dictionary"] as readonly AppSection[],

  title(section: AppSection): string {
    switch (section) {
      case "anonymize": return "Anonimizza";
      case "reveal": return "Riconverti";
      case "documents": return "Documenti";
      case "people": return "Persone";
      case "companies": return "Aziende";
      case "deals": return "Trattative";
      case "activities": return "Attività";
      case "dictionary": return "Dizionario";
    }
  },

  /// Il simbolo del Mac (SF Symbols): l'interfaccia lo traduce nella sua icona.
  symbol(section: AppSection): string {
    switch (section) {
      case "anonymize": return "eye.slash";
      case "reveal": return "arrow.uturn.backward.circle";
      case "documents": return "doc.on.doc";
      case "people": return "person.2";
      case "companies": return "building.2";
      case "deals": return "eurosign.circle";
      case "activities": return "checklist";
      case "dictionary": return "character.book.closed";
    }
  },
};

/// Dove si va dentro la sezione Aziende (o Documenti).
export type CRMRoute = { kind: "company"; id: string } | { kind: "document"; id: string };

export const CRMRoute = {
  company: (id: string): CRMRoute => ({ kind: "company", id }),
  document: (id: string): CRMRoute => ({ kind: "document", id }),
  equals: (a: CRMRoute, b: CRMRoute): boolean => a.kind === b.kind && a.id === b.id,
};
