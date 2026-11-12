import { clipboard, ipcRenderer } from "electron";

// MARK: - Quello che chiede al processo principale
//
// Finestre di Apri e Salva, custode della chiave (DPAPI), preferenze, collegamenti e cartelle. Il resto (motore, file
// cifrati) lo fa il preload da solo con Node.

export interface FileFilter {
  name: string;
  extensions: string[];
}

export const Platform = {
  version: (): Promise<string> => ipcRenderer.invoke("app:version"),
  paths: (): Promise<{ appData: string; resources: string; packaged: boolean; appPath: string }> => ipcRenderer.invoke("app:paths"),

  chooseFile: (options: { title?: string; filters?: FileFilter[] } = {}): Promise<string | null> => ipcRenderer.invoke("dialog:open", options),
  /// Più file insieme (documenti del progetto, allegati della chat); vuoto se si annulla.
  chooseFiles: (options: { title?: string; filters?: FileFilter[] } = {}): Promise<string[]> => ipcRenderer.invoke("dialog:openMany", options),
  chooseSaveLocation: (options: { title?: string; defaultPath?: string; filters?: FileFilter[] } = {}): Promise<string | null> =>
    ipcRenderer.invoke("dialog:save", options),
  chooseFolder: (options: { title?: string } = {}): Promise<string | null> => ipcRenderer.invoke("dialog:folder", options),

  /// Il custode di Windows: sigilla e apre la chiave dei dati (sincrono, come il Portachiavi sul Mac).
  keyCustody: {
    isAvailable: (): boolean => ipcRenderer.sendSync("custode:disponibile"),
    seal(raw: Uint8Array): Uint8Array {
      const result = ipcRenderer.sendSync("custode:sigilla", raw) as { ok: boolean; data?: Uint8Array; error?: string };
      if (!result.ok || !result.data) throw new Error(result.error ?? "cifratura non riuscita");
      return new Uint8Array(result.data);
    },
    unseal(sealed: Uint8Array): Uint8Array {
      const result = ipcRenderer.sendSync("custode:apri", sealed) as { ok: boolean; data?: Uint8Array; error?: string };
      if (!result.ok || !result.data) throw new Error(result.error ?? "chiave non apribile");
      return new Uint8Array(result.data);
    },
  },

  /// Le preferenze dell'interfaccia (come UserDefaults sul Mac).
  readPreferences: (): Record<string, unknown> => ipcRenderer.sendSync("prefs:read"),
  writePreferences: (prefs: Record<string, unknown>): boolean => ipcRenderer.sendSync("prefs:write", prefs),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:open", url),
  showInFolder: (path: string): Promise<void> => ipcRenderer.invoke("shell:show", path),
  openPath: (path: string): Promise<string> => ipcRenderer.invoke("shell:openPath", path),
  copy: (text: string) => clipboard.writeText(text),
  /// Il testo negli appunti (per incollare la risposta di un'AI).
  paste: (): Promise<string> => clipboard.readText(),

  installUpdate: (installer: string): Promise<void> => ipcRenderer.invoke("update:install", installer),

  /// I comandi dei menu («nuovo-progetto», «copia», «guida»…).
  onMenu(listener: (command: string) => void): () => void {
    const handler = (_event: unknown, command: string) => listener(command);
    ipcRenderer.on("menu", handler);
    return () => ipcRenderer.removeListener("menu", handler);
  },
};

export type PlatformAPI = typeof Platform;
