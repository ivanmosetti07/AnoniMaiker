import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, type MenuItemConstructorOptions } from "electron";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// MARK: - Il processo principale
//
// La finestra, i menu e quello che solo lui può fare: le finestre di Apri e Salva, la cifratura della chiave dei dati
// con DPAPI (safeStorage) e l'avvio dell'installatore di un aggiornamento. Lo stato dell'app e il motore stanno nel
// preload, accanto all'interfaccia: tutto resta sul PC.

const projectPage = "https://github.com/ivanmosetti07/AnoniMaiker";
const issuesPage = "https://github.com/ivanmosetti07/AnoniMaiker/issues";

let window: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(() => {
    app.setAppUserModelId("com.ivanmosetti.anonimaiker");
    registerHandlers();
    Menu.setApplicationMenu(buildMenu());
    createWindow();
  });
  // Chiudere la finestra chiude l'app: il motore libera la memoria.
  app.on("window-all-closed", () => app.quit());
}

function createWindow() {
  window = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 880,
    minHeight: 540,
    title: "AnoniMaiker",
    backgroundColor: "#00000000",
    show: false,
    icon: join(__dirname, "../../build/icon.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      // Il preload usa Node (motore, file cifrati) e dà il modello all'interfaccia: la pagina è solo locale.
      sandbox: false,
      contextIsolation: false,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  window.once("ready-to-show", () => window?.show());
  // Nessuna pagina esterna dentro l'app: i collegamenti si aprono nel browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window?.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
  window.on("closed", () => (window = null));
  // Nell'app installata solo con «--prova» esplicito (la prova automatica dell'installatore su GitHub Actions).
  if (process.env.ANONIMAIKER_PROVA && (!app.isPackaged || process.argv.includes("--prova"))) void runScript(process.env.ANONIMAIKER_PROVA);
}

/// Per le prove: un copione di passi (JSON: `[{ "js": "...", "attesa": 500, "schermata": "file.png" }]`) da eseguire
/// nella finestra, con le schermate. Serve a provare l'interfaccia senza toccare il mouse; alla fine l'app si chiude.
async function runScript(path: string) {
  const steps = JSON.parse(readFileSync(path, "utf8")) as { js?: string; attesa?: number; schermata?: string; risultato?: string }[];
  await new Promise<void>((resolve) => window?.webContents.once("did-finish-load", () => resolve()));
  for (const step of steps) {
    if (!window) return;
    if (step.js) {
      try {
        const result = await window.webContents.executeJavaScript(step.js, true);
        if (result !== undefined) console.log("[prova]", JSON.stringify(result));
        if (step.risultato) writeFileSync(step.risultato, JSON.stringify(result ?? null));
      } catch (error) {
        console.log("[prova] errore:", String(error));
        if (step.risultato) writeFileSync(step.risultato, JSON.stringify({ errore: String(error) }));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, step.attesa ?? 300));
    if (step.schermata) writeFileSync(step.schermata, (await window.webContents.capturePage()).toPNG());
  }
  app.quit();
}

/// Un comando dei menu, girato all'interfaccia.
function send(command: string) {
  window?.webContents.send("menu", command);
}

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "Nuovo progetto…", accelerator: "CmdOrCtrl+N", click: () => send("nuovo-progetto") },
        { label: "Tutti i progetti", accelerator: "CmdOrCtrl+Shift+P", click: () => send("progetti") },
        { type: "separator" },
        { label: "Crea copia di sicurezza…", accelerator: "CmdOrCtrl+Shift+B", click: () => send("copia") },
        { label: "Ripristina da una copia di sicurezza…", click: () => send("ripristina") },
        { type: "separator" },
        { label: "Impostazioni", accelerator: "CmdOrCtrl+,", click: () => send("impostazioni") },
        { type: "separator" },
        { label: "Esci", role: "quit" },
      ],
    },
    {
      label: "Modifica",
      submenu: [
        { label: "Annulla", role: "undo" },
        { label: "Ripeti", role: "redo" },
        { type: "separator" },
        { label: "Taglia", role: "cut" },
        { label: "Copia", role: "copy" },
        { label: "Incolla", role: "paste" },
        { label: "Seleziona tutto", role: "selectAll" },
      ],
    },
    {
      label: "Vista",
      submenu: [
        { label: "Chat con GPT", accelerator: "CmdOrCtrl+J", click: () => send("chat") },
        { type: "separator" },
        { label: "Ingrandisci", role: "zoomIn" },
        { label: "Riduci", role: "zoomOut" },
        { label: "Dimensioni reali", role: "resetZoom" },
        { type: "separator" },
        { label: "Schermo intero", role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ type: "separator" } as const, { label: "Strumenti per sviluppatori", role: "toggleDevTools" } as const]),
      ],
    },
    {
      label: "Aiuto",
      submenu: [
        { label: "Guida di AnoniMaiker", accelerator: "F1", click: () => send("guida") },
        { type: "separator" },
        { label: "Pagina del progetto su GitHub", click: () => void shell.openExternal(projectPage) },
        { label: "Segnala un problema", click: () => void shell.openExternal(issuesPage) },
        { type: "separator" },
        { label: "Controlla aggiornamenti…", click: () => send("aggiornamenti") },
        { label: "Informazioni su AnoniMaiker", click: () => send("informazioni") },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function registerHandlers() {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:paths", () => ({ appData: app.getPath("appData"), resources: process.resourcesPath, packaged: app.isPackaged, appPath: app.getAppPath() }));

  // Le finestre di Apri e Salva.
  ipcMain.handle("dialog:open", async (_event, options: { title?: string; filters?: Electron.FileFilter[]; message?: string }) => {
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, { title: options.title, filters: options.filters, properties: ["openFile"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("dialog:openMany", async (_event, options: { title?: string; filters?: Electron.FileFilter[] }) => {
    if (!window) return [];
    const result = await dialog.showOpenDialog(window, { title: options.title, filters: options.filters, properties: ["openFile", "multiSelections"] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("dialog:save",async (_event, options: { title?: string; defaultPath?: string; filters?: Electron.FileFilter[] }) => {
    if (!window) return null;
    const result = await dialog.showSaveDialog(window, { title: options.title, defaultPath: options.defaultPath, filters: options.filters });
    return result.canceled ? null : (result.filePath ?? null);
  });
  ipcMain.handle("dialog:folder", async (_event, options: { title?: string }) => {
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, { title: options.title, properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // La chiave dei dati, sigillata dal custode di Windows (DPAPI, legata all'utente del PC).
  ipcMain.on("custode:disponibile", (event) => {
    event.returnValue = safeStorage.isEncryptionAvailable();
  });
  ipcMain.on("custode:sigilla", (event, raw: Uint8Array) => {
    try {
      event.returnValue = { ok: true, data: safeStorage.encryptString(Buffer.from(raw).toString("base64")) };
    } catch (error) {
      event.returnValue = { ok: false, error: String(error) };
    }
  });
  ipcMain.on("custode:apri", (event, sealed: Uint8Array) => {
    try {
      event.returnValue = { ok: true, data: Buffer.from(safeStorage.decryptString(Buffer.from(sealed)), "base64") };
    } catch (error) {
      event.returnValue = { ok: false, error: String(error) };
    }
  });

  ipcMain.handle("shell:open", (_event, url: string) => {
    if (/^https?:/.test(url)) return shell.openExternal(url);
  });
  ipcMain.handle("shell:show", (_event, path: string) => shell.showItemInFolder(path));
  ipcMain.handle("shell:openPath", (_event, path: string) => shell.openPath(path));

  // Preferenze leggere dell'interfaccia (come UserDefaults): un file JSON accanto ai dati.
  const prefsPath = () => join(app.getPath("userData"), "preferenze.json");
  ipcMain.on("prefs:read", (event) => {
    try {
      event.returnValue = JSON.parse(readFileSync(prefsPath(), "utf8"));
    } catch {
      event.returnValue = {};
    }
  });
  ipcMain.on("prefs:write", (event, prefs: unknown) => {
    try {
      writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2));
      event.returnValue = true;
    } catch {
      event.returnValue = false;
    }
  });

  // L'installatore di un aggiornamento già verificato: parte da solo e l'app si chiude.
  ipcMain.handle("update:install", (_event, installer: string) => {
    // NSIS di electron-builder: «/S» installa in silenzio, «--force-run» riapre l'app alla fine.
    const child = spawn(installer, ["/S", "--force-run"], { detached: true, stdio: "ignore" });
    child.unref();
    setTimeout(() => app.quit(), 500);
  });

  ipcMain.handle("window:title", (_event, title: string) => window?.setTitle(title));
}
