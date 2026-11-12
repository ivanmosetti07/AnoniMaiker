import { webUtils } from "electron";
import type { AnoniMaikerAPI } from "../shared/api";
import { AppModel } from "./model";
import { Platform } from "./platform";

// MARK: - Il preload
//
// Crea il modello dell'app accanto all'interfaccia (con Node: motore, file cifrati) e lo dà a React così com'è, senza
// passare dall'IPC: `window.anonimaiker.model` è l'oggetto vivo. La finestra non ha isolamento del contesto e la pagina
// è solo locale.

// Senza nodeIntegration, Electron toglie dalla pagina i globali di Node quando il preload ha finito; ma il motore
// (onnxruntime-node) e la libreria li usano più tardi, nelle loro callback. Si rimettono dopo il caricamento.
const nodeGlobals = { setImmediate, clearImmediate, Buffer, process, global: globalThis };
process.once("loaded", () => Object.assign(globalThis, nodeGlobals));

const model = new AppModel(Platform);

const api: AnoniMaikerAPI = {
  model,
  platform: Platform,
  /// Il percorso di un file trascinato nella finestra (in Electron 45 `File.path` non c'è più).
  pathForFile: (file: File) => webUtils.getPathForFile(file),
};

window.anonimaiker = api;
window.addEventListener("beforeunload", () => model.dispose());
void model.start();
