// MARK: - Il modello dell'app, completo
//
// `AppModel` e le sue estensioni (come i file `AppModel+….swift`): importare da qui garantisce che tutti i metodi ci
// siano. Niente Electron: funziona anche sotto vitest, con una piattaforma finta.

import "./appModelProjects";
import "./appModelCRM";
import "./appModelBackup";
import "./appModelUpdates";
import "./appModelChat";

export {
  AppModel, AppSection, CRMRoute, OpenedFile, Workspace, describe,
  type AppModelOptions, type BackupStep, type EngineState, type GuideAction, type MenuCommand, type VaultState,
  type WorkspaceMode, type WorkspaceOutcome,
} from "./appModel";
export type { VersionPreview } from "./appModelCRM";
export { backupFilter } from "./appModelBackup";
export { chatEffortKey, chatModelKey } from "./appModelChat";
export { ChatState, PendingAttachment, type ChatGPTConnection, type ChatPhase } from "./chatState";
export { UpdateState, type UpdatePhase } from "./updateState";
export { FilePanels } from "./filePanels";
export { Preferences } from "./preferences";
