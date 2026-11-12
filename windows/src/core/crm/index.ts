// Il CRM: aziende, contatti, trattative, attività e documenti, cifrati nella cartella dell'app.
export {
  Company,
  CompanyStatus,
  Contact,
  Deal,
  DealStage,
  Activity,
  ActivityKind,
  DocumentVersion,
  CRMDocument,
  type DocumentVersionKind,
} from "./crmModel";
export { CRMDatabase, type KnownValue } from "./crmDatabase";
export { CRMStore, type CRMFolder } from "./crmStore";
export { ClientDossier } from "./clientDossier";
export { DecodingError } from "./codable";
