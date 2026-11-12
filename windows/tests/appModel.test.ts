import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Company } from "../src/core/crm";
import { PlainKeyProtection, setDefaultKeyProtection, fileKeyProtection } from "../src/core/sicurezza";
import { AppModel, type Workspace } from "../src/preload/model";
import type { PlatformAPI } from "../src/preload/platform";
import { FormatTest } from "./formatTestSupport";
import { TestEngine } from "./support/motoreSupport";

/// Il modello dell'app senza Electron: una piattaforma finta (preferenze in memoria, finestre di Salva che rispondono da
/// sole), una cartella dei dati usa e getta (`ANONIMAIKER_DATI`) e, dove serve, il motore vero di `windows/engine`.

const directories: string[] = [];
const models: AppModel[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "anonimaiker-modello-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const model of models.splice(0)) model.dispose();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  delete process.env.ANONIMAIKER_DATI;
  setDefaultKeyProtection(fileKeyProtection);
});

/// La piattaforma finta: registra quello che il modello chiede.
class FakePlatform {
  prefs: Record<string, unknown> = { "aggiornamenti.automatici": false, "guida.vista": true };
  saveAnswers: (string | null)[] = [];
  openAnswers: (string | null)[] = [];
  copied: string[] = [];
  clipboard = "";
  menuListeners = new Set<(command: string) => void>();
  custody = new PlainKeyProtection();

  get api(): PlatformAPI {
    const self = this;
    return {
      version: async () => "0.15.0",
      paths: async () => ({ appData: tmpdir(), resources: tmpdir(), packaged: false, appPath: tmpdir() }),
      chooseFile: async () => self.openAnswers.shift() ?? null,
      chooseFiles: async () => {
        const answer = self.openAnswers.shift();
        return answer ? [answer] : [];
      },
      chooseSaveLocation: async () => self.saveAnswers.shift() ?? null,
      chooseFolder: async () => null,
      keyCustody: {
        isAvailable: () => self.custody.isAvailable(),
        seal: (raw: Uint8Array) => self.custody.seal(raw),
        unseal: (sealed: Uint8Array) => self.custody.unseal(sealed),
      },
      readPreferences: () => structuredClone(self.prefs),
      writePreferences: (prefs: Record<string, unknown>) => {
        self.prefs = structuredClone(prefs);
        return true;
      },
      openExternal: async () => {},
      showInFolder: async () => {},
      openPath: async () => "",
      copy: (text: string) => {
        self.copied.push(text);
        return Promise.resolve();
      },
      paste: async () => self.clipboard,
      installUpdate: async () => {},
      onMenu(listener: (command: string) => void) {
        self.menuListeners.add(listener);
        return () => self.menuListeners.delete(listener);
      },
    } as PlatformAPI;
  }

  sendMenu(command: string): void {
    for (const listener of this.menuListeners) listener(command);
  }
}

/// Un modello avviato su una cartella dei dati nuova (o su quella data).
async function startedModel(options: { platform?: FakePlatform; data?: string; engine?: boolean } = {}): Promise<{ model: AppModel; platform: FakePlatform; data: string }> {
  const platform = options.platform ?? new FakePlatform();
  const data = options.data ?? temporaryDirectory();
  process.env.ANONIMAIKER_DATI = data;
  const model = new AppModel(platform.api, { engine: options.engine ? TestEngine.engine : null });
  models.push(model);
  await model.start();
  return { model, platform, data };
}

/// Aspetta che il lavoro iniziato da un comando sincrono (come «Apri») finisca.
async function settled(space: Workspace): Promise<void> {
  for (let i = 0; i < 600 && space.isRunning; i++) await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("AppModel", () => {
  it("startsWithTheWindowsCustodyAndNoProjects", async () => {
    const { model, data } = await startedModel();
    expect(model.isVaultReady).toBe(true);
    expect(model.vaultState).toEqual({ kind: "ready", protection: "windowsDPAPI" });
    expect(model.engineState).toEqual({ kind: "missing" });
    expect(model.appVersion).toBe("0.15.0");
    expect(model.projects).toEqual([]);
    expect(model.hasProject).toBe(false);
    expect(model.showsGuide).toBe(false);
    // La cartella dei dati è quella di `ANONIMAIKER_DATI`.
    expect(model.folder.directory).toBe(data);
  });

  it("createsAndReopensAProject", async () => {
    const { model, platform, data } = await startedModel();
    let notifications = 0;
    model.subscribe(() => notifications++);
    await model.createProject("  Cliente Rossi  ");
    expect(model.projects.map((project) => project.name)).toEqual(["Cliente Rossi"]);
    expect(model.currentProject?.name).toBe("Cliente Rossi");
    expect(model.section).toBe("anonymize");
    expect(platform.prefs["progetto.corrente"]).toBe(model.currentProjectID);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notifications).toBeGreaterThan(0);

    await model.renameProject(model.currentProjectID!, "Edilnord");
    expect(model.currentProject?.name).toBe("Edilnord");

    // Un'altra apertura dell'app torna al progetto aperto.
    const again = await startedModel({ platform, data });
    expect(again.model.currentProject?.name).toBe("Edilnord");

    await again.model.showProjects();
    expect(again.model.hasProject).toBe(false);
    expect(platform.prefs["progetto.corrente"]).toBeUndefined();
    await again.model.selectProject(again.model.projects[0].id);
    expect(again.model.hasProject).toBe(true);
    await again.model.deleteProject(again.model.projects[0].id);
    expect(again.model.projects).toEqual([]);
    expect(again.model.hasProject).toBe(false);
  });

  it("addsEditsAndDeletesACompany", async () => {
    const { model } = await startedModel();
    await model.createProject("CRM");
    const company = Company.create("Edilnord S.r.l.", "client");
    await model.saveCompany(company);
    expect(model.crm.companies.map((item) => item.name)).toEqual(["Edilnord S.r.l."]);

    await model.saveCompany({ ...model.crm.companies[0], name: "Edilnord S.p.A.", vatNumber: "IT01234567890" });
    expect(model.crm.companies).toHaveLength(1);
    expect(model.crm.companies[0].name).toBe("Edilnord S.p.A.");
    expect(model.companyChoices.map((item) => item.name)).toEqual(["Edilnord S.p.A."]);

    model.openCompany(company.id);
    expect(model.section).toBe("companies");
    expect(model.companiesPath).toEqual([{ kind: "company", id: company.id }]);

    // Si salva cifrato: una nuova lettura del CRM lo ritrova.
    expect((await model.crmStore.snapshot()).companies[0].vatNumber).toBe("IT01234567890");

    await model.deleteCompany(company.id);
    expect(model.crm.companies).toEqual([]);
    expect(model.companiesPath).toEqual([]);
  });

  it("keepsTheSettingsAndTheLastBackup", async () => {
    const { model, platform, data } = await startedModel();
    model.updateSettings((settings) => {
      settings.exceptions.push("Milano");
      settings.hidden.delete("EMAIL");
    });
    expect(model.settings.exceptions).toContain("Milano");
    expect(platform.prefs["impostazioni.anonimizzazione"]).toBeTruthy();
    model.updates.automatic = false;
    model.lastBackup = new Date("2026-11-01T10:00:00Z");

    const again = await startedModel({ platform, data });
    expect(again.model.settings.exceptions).toContain("Milano");
    expect(again.model.settings.hidden.has("EMAIL")).toBe(false);
    expect(again.model.lastBackup?.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(again.model.updates.automatic).toBe(false);
  });

  it("mapsTheMenuCommands", async () => {
    const { model, platform } = await startedModel();
    platform.sendMenu("impostazioni");
    expect(model.showsSettings).toBe(true);
    platform.sendMenu("informazioni");
    expect(model.showsAbout).toBe(true);
    platform.sendMenu("guida");
    expect(model.showsGuide).toBe(true);
    platform.sendMenu("copia");
    expect(model.backupStep).toEqual({ kind: "export" });
    await model.createProject("Menu");
    platform.sendMenu("chat");
    expect(model.showsChat).toBe(true);
    platform.sendMenu("nuovo-progetto");
    expect(model.requestsNewProject).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(model.hasProject).toBe(false);
  });

  it("exportsAndRestoresABackup", async () => {
    const { model, platform } = await startedModel();
    await model.createProject("Da salvare");
    await model.saveCompany(Company.create("Edilnord S.r.l.", "client"));
    const summary = await model.allProjectsSummary();
    expect(summary.projects).toBe(1);
    expect(summary.companies).toBe(1);

    const copy = join(temporaryDirectory(), "copia.anonimizzatore");
    platform.saveAnswers.push(copy);
    expect(await model.exportBackup("una password lunga é")).toBe(true);
    expect(existsSync(copy)).toBe(true);
    expect(model.lastBackup).not.toBeNull();

    // Annullare la finestra di Salva non salva niente.
    platform.saveAnswers.push(null);
    expect(await model.exportBackup("una password lunga é")).toBe(false);

    await model.deleteProject(model.projects[0].id);
    expect(model.projects).toEqual([]);

    platform.openAnswers.push(copy);
    await model.startRestore();
    expect(model.backupStep).toEqual({ kind: "restore", path: copy });
    await expect(model.openBackup(copy, "password sbagliata")).rejects.toThrow();
    const contents = await model.openBackup(copy, "una password lunga é");
    expect(contents.summary.companies).toBe(1);
    const aside = await model.restore(contents);
    expect(aside).not.toBeNull();
    expect(model.projects.map((project) => project.name)).toEqual(["Da salvare"]);
    expect(model.currentProject?.name).toBe("Da salvare");
    expect(model.crm.companies.map((company) => company.name)).toEqual(["Edilnord S.r.l."]);
  });

  it("preparesChatAttachments", async () => {
    const { model } = await startedModel();
    await model.createProject("Chat");
    const company = Company.create("Edilnord S.r.l.", "client");
    await model.saveCompany(company);
    const file = join(temporaryDirectory(), "Note.md");
    writeFileSync(file, "# Note\nChiamare Mario.");
    model.attach([file, join(temporaryDirectory(), "vecchio.doc")]);
    model.attachDossier(company.id);
    expect(model.chat.pending.map((item) => item.name)).toEqual(["Note.md", "Scheda di Edilnord S.r.l."]);
    expect(model.chat.error).toContain(".doc");
    model.chat.draft = "Riassumi";
    expect(model.chat.hasDraft).toBe(true);
    // Senza motore la chat non parte: niente esce dal PC senza essere anonimizzato.
    expect(model.canSendChat).toBe(false);
    model.removePending(model.chat.pending[0].id);
    expect(model.chat.pending).toHaveLength(1);
  });

  describe.skipIf(!TestEngine.isAvailable)("con il motore", () => {
    it("anonymizesAndRevealsText", async () => {
      const { model, platform } = await startedModel({ engine: true });
      expect(model.engineState).toEqual({ kind: "ready" });
      await model.createProject("Prove");
      const original = "Scrivere a mario.rossi@edilnord.it o chiamare il 333 123 4567 per l'IBAN IT60X0542811101000000123456.";
      const space = model.anonymizeSpace;
      let notifications = 0;
      space.subscribe(() => notifications++);
      space.input = original;
      expect(model.canRun(space)).toBe(true);
      await model.run(space);
      expect(space.isRunning).toBe(false);
      expect(space.output).toContain("[EMAIL_1]");
      expect(space.output).toContain("[IBAN_1]");
      expect(space.output).not.toContain("mario.rossi@edilnord.it");
      expect(space.outcome?.kind).toBe("anonymized");
      expect(space.highlights.length).toBeGreaterThanOrEqual(2);
      expect(space.isStale).toBe(false);
      expect(model.vault.count).toBeGreaterThanOrEqual(2);
      expect(notifications).toBeGreaterThan(0);

      model.copy(space);
      expect(platform.copied).toEqual([space.output]);

      const reveal = model.revealSpace;
      reveal.input = space.output;
      await model.run(reveal);
      expect(reveal.output).toBe(original);
      expect(reveal.outcome?.kind).toBe("revealed");

      // «Salva nel progetto»: il testo entra nei documenti.
      await model.saveToProject(space);
      expect(space.projectNote).toContain("Salvato nei documenti del progetto");
      expect(model.crm.documents.map((document) => document.title)).toEqual([original.slice(0, 60)]);

      // Salvare il risultato in un file.
      const saved = join(temporaryDirectory(), "risultato.txt");
      platform.saveAnswers.push(saved);
      await model.save(space);
      expect(readFileSync(saved, "utf8")).toBe(space.output);

      space.input = original + " Altro.";
      expect(space.isStale).toBe(true);
      space.clear();
      expect(space.isEmpty).toBe(true);
    });

    it("opensCSVAndWordFilesIntoAWorkspace", async () => {
      const { model } = await startedModel({ engine: true });
      await model.createProject("File");
      const folder = temporaryDirectory();

      const csv = join(folder, "Contatti.csv");
      writeFileSync(csv, "Nome;Email\nMario;mario.rossi@edilnord.it\n");
      const space = model.anonymizeSpace;
      await model.open(csv, space);
      await settled(space);
      expect(space.source?.name).toBe("Contatti.csv");
      expect(space.isFile).toBe(true);
      expect(space.outputData).not.toBeNull();
      expect(space.output).toContain("[EMAIL_1]");
      expect(new TextDecoder().decode(space.outputData!)).toContain("[EMAIL_1]");
      // Il file anonimizzato entra nei documenti del progetto.
      expect(space.projectNote).toContain("Salvato nei documenti del progetto");
      expect(model.crm.documents.map((document) => document.title)).toEqual(["Contatti"]);

      const docx = join(folder, "Lettera.docx");
      writeFileSync(docx, wordDocument());
      await model.open(docx, space);
      await settled(space);
      expect(space.source?.format).toBe("docx");
      expect(space.output).toContain("[EMAIL_");
      expect(space.output).not.toContain("anna@neri.it");
      expect(model.crm.documents).toHaveLength(2);

      // Riconvertire il file anonimizzato.
      const anonymized = join(folder, "Lettera (anonimizzato).docx");
      writeFileSync(anonymized, space.outputData!);
      const reveal = model.revealSpace;
      await model.open(anonymized, reveal);
      await settled(reveal);
      expect(reveal.output).toContain("anna@neri.it");
      expect(reveal.highlights.length).toBeGreaterThan(0);

      // Un formato che non si legge.
      await model.open(join(folder, "vecchio.doc"), space);
      expect(model.alert).toContain(".doc");
    });
  });
});

function wordDocument(): Uint8Array {
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const body = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${w}"><w:body>
<w:p><w:r><w:t xml:space="preserve">Gentile cliente, scriva a anna@neri.it entro venerdì.</w:t></w:r></w:p>
</w:body></w:document>`;
  return FormatTest.office([
    ["[Content_Types].xml", FormatTest.contentTypes],
    ["_rels/.rels", FormatTest.rootRels],
    ["word/document.xml", body],
  ]);
}
