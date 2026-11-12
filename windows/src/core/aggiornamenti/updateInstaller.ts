import { closeSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newUUID } from "../sicurezza/swiftCoding";
import { type AppRelease, UpdateError, Updates } from "./updates";

// MARK: - Installare un aggiornamento
//
// 1. Scarica l'installatore e la firma in una cartella temporanea e controlla la firma.
// 2. Restituisce l'installatore verificato: il processo principale lo avvia (NSIS, `/S` = in silenzio, `--force-run`
//    = riapre l'app alla fine) e chiude l'app. I dati non si toccano: stanno in %APPDATA%.
//
// Sul Mac qui c'erano anche l'apertura del DMG, il controllo della firma del codice e lo script che sostituisce l'app:
// su Windows lo fa l'installatore.

export type InstallErrorCode = "download" | "wrongApp" | "failed";

export class InstallError extends Error {
  private constructor(
    readonly code: InstallErrorCode,
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = "InstallError";
  }
  static download(message: string): InstallError {
    return new InstallError("download", `Download non riuscito: ${message}`, message);
  }
  static wrongApp(detail: string): InstallError {
    return new InstallError("wrongApp", `Il file scaricato non è l'aggiornamento atteso (${detail}): non lo installo.`, detail);
  }
  static failed(message: string): InstallError {
    return new InstallError("failed", `Aggiornamento non riuscito: ${message}`, message);
  }
}

/// Un'operazione annullata (come `CancellationError` in Swift).
export class CancellationError extends Error {
  constructor() {
    super("annullato");
    this.name = "CancellationError";
  }
}

export class UpdateInstaller {
  /// Gli argomenti per l'installatore NSIS di electron-builder.
  static readonly installerArguments = ["/S", "--force-run"];

  /// La cartella dei file scaricati per un aggiornamento.
  static workDirectory(): string {
    const directory = join(tmpdir(), `AnoniMaiker-aggiornamento-${newUUID()}`);
    mkdirSync(directory, { recursive: true });
    return directory;
  }

  /// Il nome atteso dell'installatore di una versione («AnoniMaiker-Setup-0.16.exe»).
  static installerName(version: string): string {
    return `AnoniMaiker-Setup-${version}.exe`;
  }

  // MARK: Download e controlli

  /// Scarica l'installatore della release e ne controlla la firma; restituisce il percorso dell'installatore verificato.
  static async download(
    release: AppRelease,
    publicKey: string = Updates.publicKey,
    progress: (fraction: number) => void = () => {},
    signal?: AbortSignal,
  ): Promise<string> {
    if (!release.signature) throw UpdateError.unsigned();
    const name = decodeURIComponent(new URL(release.installer).pathname.split("/").pop() ?? "");
    // L'installatore deve essere quello della versione annunciata (sul Mac: identificativo e versione dentro il DMG).
    if (name.toLowerCase() !== UpdateInstaller.installerName(release.version).toLowerCase()) {
      throw InstallError.wrongApp(`file «${name}» invece di «${UpdateInstaller.installerName(release.version)}»`);
    }
    const directory = UpdateInstaller.workDirectory();
    try {
      const signatureResponse = await UpdateInstaller.request(release.signature, signal);
      const signatureText = await signatureResponse.text();
      const installer = join(directory, name);
      await UpdateInstaller.fetch(release.installer, installer, progress, signal, release.installerSize);
      if (!Updates.verify(installer, signatureText, publicKey)) throw UpdateError.badSignature();
      return installer;
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private static async request(url: string, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, { signal, headers: { "User-Agent": "AnoniMaiker" } });
    } catch (error) {
      if (signal?.aborted) throw new CancellationError();
      throw InstallError.download(error instanceof Error ? error.message : String(error));
    }
    if (response.status !== 200) throw InstallError.download(`risposta ${response.status}`);
    return response;
  }

  /// Un download con l'avanzamento (da 0 a 1); si ferma se `signal` viene annullato.
  static async fetch(
    url: string,
    destination: string,
    progress: (fraction: number) => void,
    signal?: AbortSignal,
    expectedSize = 0,
  ): Promise<void> {
    const response = await UpdateInstaller.request(url, signal);
    const total = Number(response.headers.get("content-length")) || expectedSize;
    const partial = `${destination}.parziale`;
    const handle = openSync(partial, "w");
    let received = 0;
    try {
      if (!response.body) throw InstallError.download("risposta vuota");
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        writeSync(handle, value);
        received += value.length;
        if (total > 0) progress(Math.min(1, received / total));
      }
    } catch (error) {
      closeSync(handle);
      rmSync(partial, { force: true });
      if (signal?.aborted) throw new CancellationError();
      if (error instanceof InstallError) throw error;
      throw InstallError.download(error instanceof Error ? error.message : String(error));
    }
    closeSync(handle);
    progress(1);
    rmSync(destination, { force: true });
    renameSync(partial, destination);
  }
}
