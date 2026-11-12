// MARK: - Quello che il preload dà all'interfaccia
//
// `window.anonimaiker`: il modello dell'app (oggetti vivi, osservabili con `useObserved`), la piattaforma (finestre,
// appunti, collegamenti) e l'aiuto per i file trascinati. Solo tipi: l'interfaccia non importa codice del preload.

import type { AppModel } from "../preload/model";
import type { PlatformAPI } from "../preload/platform";

export type {
  AppModel, AppSection, BackupStep, ChatGPTConnection, ChatPhase, ChatState, CRMRoute, EngineState, GuideAction, MenuCommand,
  OpenedFile, PendingAttachment, UpdatePhase, UpdateState, VaultState, VersionPreview, Workspace, WorkspaceMode, WorkspaceOutcome,
} from "../preload/model";
export type { FileFilter, PlatformAPI } from "../preload/platform";

export interface AnoniMaikerAPI {
  model: AppModel;
  platform: PlatformAPI;
  /// Il percorso di un file trascinato nella finestra (`webUtils.getPathForFile`).
  pathForFile(file: File): string;
}

declare global {
  interface Window {
    anonimaiker: AnoniMaikerAPI;
  }
}
