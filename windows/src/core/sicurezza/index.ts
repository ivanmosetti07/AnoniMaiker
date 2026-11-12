// La cartella cifrata, il custode della chiave e la copia di sicurezza.
export { SecureFolder, FolderError, type FolderErrorCode } from "./secureFolder";
export {
  KeyCustody,
  KeyFile,
  CustodyError,
  describeProtection,
  fileKeyProtection,
  windowsKeyProtection,
  PlainKeyProtection,
  setDefaultKeyProtection,
  defaultKeyProtection,
  type KeyProtection,
  type KeyProtectionKind,
  type WindowsKeyCustody,
} from "./keyCustody";
export { Backup, BackupSummary, BackupError, type BackupErrorCode, type BackupContents } from "./backup";
export {
  AESGCM,
  referenceDateOffset,
  encodeSwiftDate,
  decodeSwiftDate,
  encodeBase64,
  decodeBase64,
  decodeUUID,
  decodeInt,
  newUUID,
  isPlainObject,
  characterCount,
} from "./swiftCoding";
