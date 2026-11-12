import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DocumentFormat } from "../core/documenti";
import type { FileFilter, PlatformAPI } from "./platform";

// MARK: - Le finestre di Apri e Salva
//
// Quelle di Windows, chieste al processo principale; i file si leggono e si scrivono qui con Node.

export const FilePanels = {
  /// Testo, Markdown, CSV, Excel, Word e PDF.
  get documentFilters(): FileFilter[] {
    return [{ name: "Testo, Markdown, CSV, Excel, Word o PDF", extensions: [...DocumentFormat.extensions] }];
  },

  chooseDocument(platform: PlatformAPI): Promise<string | null> {
    return platform.chooseFile({ title: "Scegli un file: testo, Markdown, CSV, Excel, Word o PDF", filters: FilePanels.documentFilters });
  },

  /// Chiede dove salvare e scrive il file. Restituisce il percorso, o null se si annulla.
  async save(platform: PlatformAPI, data: Uint8Array, suggestedName: string, directory: string | null): Promise<string | null> {
    const path = await platform.chooseSaveLocation({ defaultPath: directory ? join(directory, suggestedName) : suggestedName });
    if (!path) return null;
    writeFileSync(path, data);
    return path;
  },
};
