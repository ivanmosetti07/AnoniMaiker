// I progetti (ognuno con dizionario, CRM e chat suoi) e il CRM che si riempie dai documenti.
//
// Nomi diversi da Swift:
// - `Project(name:notes:created:)` → `Project.create(name, notes, created)`.
// - `ProjectStore.Part` → `ProjectPart`; `ProjectStore.split(vault:crm:chats:)` → `ProjectStore.split(vault, crm, chats)`.
// - `CRMExtraction.apply(_:vault:source:to: &database)` → `CRMExtraction.apply(text, vault, source, database)`: il CRM
//   passato si modifica (come `inout`).
// - In più: `ProjectFolder`, il tipo della cartella che serve (`SecureFolder` va bene).
export { Project, ProjectSpace, ProjectStore, type ProjectFolder, type ProjectPart } from "./projectStore";
export { CRMExtraction, CRMExtractionReport } from "./crmExtraction";
