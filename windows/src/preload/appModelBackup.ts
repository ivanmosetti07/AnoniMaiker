import { readFileSync, writeFileSync } from "node:fs";
import type { CRMDatabase } from "../core/crm";
import type { Vault } from "../core/dizionario";
import { Backup, BackupSummary, type BackupContents } from "../core/sicurezza";
import { AppModel } from "./appModel";
import type { FileFilter } from "./platform";

// MARK: - Copia di sicurezza
//
// Tutto (dizionario, CRM, documenti) in un file cifrato con una password: si riapre su un altro computer, anche su un
// Mac. La chiave si ricava dalla password con 600.000 passaggi: prima di partire si lascia ridisegnare l'interfaccia.

declare module "./appModel" {
  interface AppModel {
    startExport(): void;
    /// Sceglie la copia da ripristinare e apre la finestra della password.
    startRestore(): Promise<void>;
    /// Quanto c'è in tutti i progetti insieme (per la copia di sicurezza).
    allProjectsSummary(): Promise<BackupSummary>;
    /// Crea la copia e la salva dove sceglie l'utente. Restituisce true se è stata salvata.
    exportBackup(password: string): Promise<boolean>;
    /// Apre una copia con la password (senza toccare i dati di questo PC).
    openBackup(path: string, password: string): Promise<BackupContents>;
    /// Sostituisce i dati di questo PC con quelli della copia. Restituisce la cartella dove sono finiti quelli di prima.
    restore(contents: BackupContents): Promise<string | null>;
  }
}

/// Il filtro delle finestre di Apri e Salva per le copie («.anonimizzatore»).
export const backupFilter: FileFilter = { name: "Copia di sicurezza di AnoniMaiker", extensions: [Backup.fileExtension] };

/// Lascia all'interfaccia il tempo di mostrare l'attesa prima di un lavoro pesante e sincrono.
const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

const proto = AppModel.prototype;

proto.startExport = function (this: AppModel) {
  this.backupStep = { kind: "export" };
  void this.allProjectsSummary();
};

proto.startRestore = async function (this: AppModel) {
  void this.allProjectsSummary();
  const path = await this.platform.chooseFile({ title: "Scegli una copia di sicurezza di AnoniMaiker", filters: [backupFilter] });
  if (path) this.backupStep = { kind: "restore", path };
};

proto.allProjectsSummary = async function (this: AppModel) {
  const vaults: Vault[] = [];
  const crms: CRMDatabase[] = [];
  for (const project of this.projects) {
    const space = this.projectStore.space(project.id);
    try {
      vaults.push(await space.vault.snapshot());
    } catch {
      // Come `try?`: un progetto illeggibile non si conta.
    }
    try {
      crms.push(await space.crm.snapshot());
    } catch {
      // Come sopra.
    }
  }
  const summary = BackupSummary.ofProjects(this.projects.length, vaults, crms, this.appVersion);
  this.totals = summary;
  return summary;
};

proto.exportBackup = async function (this: AppModel, password: string) {
  const summary = await this.allProjectsSummary();
  await yieldToUI();
  const data = Backup.make(this.folder.allFiles(), summary, password);
  const path = await this.platform.chooseSaveLocation({
    title: "Conserva la copia e la password in due posti diversi.",
    defaultPath: `AnoniMaiker – copia del ${isoDay(new Date())}.${Backup.fileExtension}`,
    filters: [backupFilter],
  });
  if (!path) return false;
  writeFileSync(path, data);
  this.lastBackup = new Date();
  return true;
};

proto.openBackup = async function (this: AppModel, path: string, password: string) {
  await yieldToUI();
  return Backup.open(readFileSync(path), password);
};

proto.restore = async function (this: AppModel, contents: BackupContents) {
  await yieldToUI();
  const aside = this.folder.replaceAll(contents.files);
  await this.openData();
  this.anonymizeSpace.clear();
  this.revealSpace.clear();
  this.chat.task?.abort();
  this.chat.selectedID = null;
  this.chat.pending = [];
  this.companiesPath = [];
  return aside;
};

/// «2026-11-12».
function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
