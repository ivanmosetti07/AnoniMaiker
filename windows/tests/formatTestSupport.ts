import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Anonymizer, RegexFinder } from "../src/core/anonimizzazione";
import { VaultStore } from "../src/core/dizionario";
import { ZipArchive, ZipEntry, entryNamed } from "../src/core/documenti";
import { fileKeyProtection } from "../src/core/sicurezza";

/** Per le prove dei formati: un anonimizzatore con la sola rete regex (niente modello) e un dizionario usa e getta. */
export const FormatTest = {
  anonymizer(): { anonymizer: Anonymizer; directory: string; cleanup: () => void } {
    const directory = mkdtempSync(join(tmpdir(), "anonimizzatore-prove-"));
    const anonymizer = new Anonymizer(new RegexFinder(), VaultStore.at(directory, fileKeyProtection));
    return { anonymizer, directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
  },

  /** Un archivio Office fatto a mano: percorso → contenuto XML. */
  office(parts: readonly [string, string][]): Uint8Array {
    return ZipArchive.write(parts.map(([name, xml]) => new ZipEntry(name, new TextEncoder().encode(xml))));
  },

  part(data: Uint8Array, name: string): string {
    const entry = entryNamed(ZipArchive.read(data), name);
    return entry ? new TextDecoder().decode(entry.data) : "";
  },

  /** `unzip -t` sull'archivio: «true» se lo strumento di sistema lo trova valido (o se lo strumento non c'è). */
  unzipTest(data: Uint8Array): boolean {
    const directory = mkdtempSync(join(tmpdir(), "anonimaiker-zip-"));
    try {
      const path = join(directory, "prova.zip");
      writeFileSync(path, data);
      try {
        execFileSync("unzip", ["-tq", path], { stdio: "pipe" });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        return false;
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },

  contentTypes:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  rootRels: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
  core: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Clienti Edilnord</dc:title><dc:creator>Ivan Prova</dc:creator><cp:lastModifiedBy>Ivan Prova</cp:lastModifiedBy></cp:coreProperties>',
};
