import { UpdateInstaller, Updates, type AppRelease } from "../core/aggiornamenti";
import { AppModel, appLog, describe } from "./appModel";

// MARK: - Aggiornamenti
//
// All'avvio (e poi una volta al giorno) l'app chiede a GitHub l'ultima release di Windows. Se è più nuova mostra le
// novità; con un clic scarica l'installatore, ne controlla la firma e lo avvia: l'app si chiude e l'installatore la
// riapre aggiornata. I dati non si toccano.

declare module "./appModel" {
  interface AppModel {
    /// Il controllo automatico: subito se l'ultimo ha più di un giorno, poi ogni giorno.
    startUpdateChecks(): void;
    /// Chiede a GitHub l'ultima versione. Dal menu mostra sempre l'esito; in automatico solo se c'è una novità.
    checkForUpdates(userInitiated: boolean): Promise<void>;
    skip(release: AppRelease): void;
    /// Scarica, controlla e avvia l'installatore; poi l'app si chiude e si riapre aggiornata.
    install(release: AppRelease): Promise<void>;
    cancelUpdate(): void;
    openReleasePage(release: AppRelease | null): void;
  }
}

const proto = AppModel.prototype;

proto.startUpdateChecks = function (this: AppModel) {
  // Per le prove, `ANONIMAIKER_AGGIORNA_SUBITO=1` nell'ambiente controlla e installa subito, come «Installa e riavvia».
  if (process.env.ANONIMAIKER_AGGIORNA_SUBITO === "1") {
    void (async () => {
      await this.checkForUpdates(true);
      const phase = this.updates.phase;
      if (phase.kind === "available") await this.install(phase.release);
    })();
    return;
  }
  const check = () => {
    const last = this.updates.lastCheck?.getTime() ?? 0;
    if (this.updates.automatic && Date.now() - last > 24 * 3600 * 1000) void this.checkForUpdates(false);
  };
  check();
  this.timers.push(setInterval(check, 3 * 3600 * 1000));
};

proto.checkForUpdates = async function (this: AppModel, userInitiated: boolean) {
  const updates = this.updates;
  if (updates.isBusy) {
    if (userInitiated) updates.isPresented = true;
    return;
  }
  if (userInitiated) {
    updates.phase = { kind: "checking" };
    updates.isPresented = true;
  }
  try {
    const release = await Updates.latest();
    updates.lastCheck = new Date();
    if (release && Updates.isNewer(release.version, this.appVersion)) {
      if (userInitiated || release.version !== updates.skippedVersion) {
        updates.phase = { kind: "available", release };
        updates.isPresented = true;
        appLog.notice(`Aggiornamento disponibile: ${release.version}`);
      } else {
        updates.phase = { kind: "idle" };
      }
    } else {
      updates.phase = userInitiated ? { kind: "upToDate" } : { kind: "idle" };
    }
  } catch (error) {
    appLog.error(`Controllo aggiornamenti: ${describe(error)}`);
    updates.phase = userInitiated ? { kind: "failed", message: describe(error), release: null } : { kind: "idle" };
  }
};

proto.skip = function (this: AppModel, release: AppRelease) {
  this.updates.skippedVersion = release.version;
  this.updates.phase = { kind: "idle" };
  this.updates.isPresented = false;
};

proto.install = async function (this: AppModel, release: AppRelease) {
  const updates = this.updates;
  if (updates.isBusy) return;
  const controller = new AbortController();
  updates.task = controller;
  updates.phase = { kind: "downloading", release, progress: 0 };
  try {
    // Il download controlla anche la firma dell'installatore.
    const installer = await UpdateInstaller.download(release, Updates.publicKey, (value) => {
      if (updates.phase.kind === "downloading") updates.phase = { kind: "downloading", release, progress: value };
    }, controller.signal);
    appLog.notice(`Installo la versione ${release.version} e riavvio`);
    updates.phase = { kind: "installing", release, step: "Chiudo AnoniMaiker: si riapre da sola aggiornata tra qualche secondo." };
    // Prima si chiudono le finestre sopra la principale; poi l'installatore parte e l'app si chiude.
    updates.isPresented = false;
    this.backupStep = null;
    this.showsGuide = false;
    this.showsSettings = false;
    this.showsAbout = false;
    await this.platform.installUpdate(installer);
  } catch (error) {
    if (controller.signal.aborted) {
      updates.phase = { kind: "available", release };
    } else {
      appLog.error(`Aggiornamento non riuscito: ${describe(error)}`);
      updates.phase = { kind: "failed", message: describe(error), release };
    }
  } finally {
    if (updates.task === controller) updates.task = null;
  }
};

proto.cancelUpdate = function (this: AppModel) {
  this.updates.task?.abort();
};

proto.openReleasePage = function (this: AppModel, release: AppRelease | null) {
  void this.platform.openExternal(release?.page ?? Updates.releasesPage);
};
