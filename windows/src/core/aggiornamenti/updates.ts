import { closeSync, openSync, readSync } from "node:fs";
import { createHash, createPrivateKey, createPublicKey, sign as signData, verify as verifyData } from "node:crypto";
import { decodeBase64 } from "../sicurezza/swiftCoding";

// MARK: - Aggiornamenti dalle release di GitHub
//
// L'app chiede a GitHub le release del progetto. Nello stesso progetto ci sono quelle del Mac (tag «vX.Y», con il DMG)
// e quelle di Windows (tag «windows-vX.Y», con «AnoniMaiker-Setup-X.Y.exe» e la sua firma «.exe.sig»): qui contano solo
// quelle di Windows. Se c'è una versione più nuova, si scaricano l'installatore e la firma. La firma è Ed25519
// sull'impronta SHA-256 del file, fatta con la chiave privata di chi pubblica (la stessa dei DMG del Mac): l'app ha la
// chiave pubblica e installa solo file firmati con quella. Così un file cambiato, anche su GitHub, non passa.

/// Una release di Windows pubblicata su GitHub.
export interface AppRelease {
  version: string;
  title: string;
  /// Le novità, in Markdown.
  notes: string;
  page: string;
  /// L'installatore (sul Mac: `dmg`).
  installer: string;
  /// La sua dimensione in byte (sul Mac: `dmgSize`).
  installerSize: number;
  signature: string | null;
  published: Date | null;
}

export type UpdateErrorCode = "network" | "noDownload" | "unsigned" | "badSignature";

export class UpdateError extends Error {
  private constructor(
    readonly code: UpdateErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "UpdateError";
  }
  static network(message: string): UpdateError {
    return new UpdateError("network", `Non riesco a controllare gli aggiornamenti: ${message}`, message);
  }
  static noDownload(): UpdateError {
    return new UpdateError("noDownload", "L'ultima versione non ha un installatore da scaricare.");
  }
  static unsigned(): UpdateError {
    return new UpdateError(
      "unsigned",
      "L'ultima versione non è firmata: per sicurezza non si installa da qui. Scaricala dalla pagina del progetto.",
    );
  }
  static badSignature(): UpdateError {
    return new UpdateError("badSignature", "La firma dell'aggiornamento non corrisponde: il file non viene installato.");
  }
}

/// Le parti di una release nella risposta di GitHub.
interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}
interface GitHubRelease {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  html_url: string;
  draft?: boolean | null;
  prerelease?: boolean | null;
  published_at?: string | null;
  assets: GitHubAsset[];
}

// Le chiavi Ed25519 grezze (32 byte) in DER, come le vuole node:crypto.
const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");

export class Updates {
  /// Il progetto su GitHub.
  static readonly repository = "ivanmosetti07/AnoniMaiker";
  static get projectPage(): string {
    return `https://github.com/${Updates.repository}`;
  }
  static get issuesPage(): string {
    return `https://github.com/${Updates.repository}/issues`;
  }
  static get releasesPage(): string {
    return `https://github.com/${Updates.repository}/releases`;
  }

  /// Il prefisso dei tag delle release di Windows («windows-v0.16»).
  static readonly tagPrefix = "windows-";

  /// La chiave pubblica con cui sono firmati gli aggiornamenti (Ed25519, base64): la stessa del Mac.
  static readonly publicKey = "uEtnwSuiBKAh2sxtHb6hXOiTyxm315Pmq53CwfTrIcQ=";

  // MARK: Versioni

  /// «v0.10» è più nuova di «0.9». Si confrontano i numeri; quello che segue un «-» (0.5-beta) conta come più vecchio.
  static isNewer(candidate: string, current: string): boolean {
    const parts = (version: string) => {
      let text = version.replace(/^[ \t]+|[ \t]+$/g, "");
      if (text.startsWith("v") || text.startsWith("V")) text = text.slice(1);
      const dash = text.indexOf("-");
      const pieces = (dash < 0 ? [text] : [text.slice(0, dash), text.slice(dash + 1)]).filter((piece) => piece.length > 0);
      const numbers = (pieces[0] ?? "")
        .split(".")
        .filter((piece) => piece.length > 0)
        .map((piece) => {
          const digits = /^\p{N}*/u.exec(piece)?.[0] ?? "";
          return /^[0-9]+$/.test(digits) ? Number.parseInt(digits, 10) : 0;
        });
      return { numbers, prerelease: pieces.length > 1 };
    };
    const a = parts(candidate);
    const b = parts(current);
    for (let index = 0; index < Math.max(a.numbers.length, b.numbers.length); index += 1) {
      const x = a.numbers[index] ?? 0;
      const y = b.numbers[index] ?? 0;
      if (x !== y) return x > y;
    }
    return !a.prerelease && b.prerelease;
  }

  // MARK: GitHub

  /// L'ultima release di Windows pubblicata (non le bozze né le pre-release, non quelle del Mac).
  ///
  /// Sul Mac si chiede `releases/latest`; qui no: nello stesso progetto l'ultima può essere quella del Mac, quindi si
  /// legge l'elenco e si sceglie la release «windows-v…» più nuova.
  static async latest(fetchImpl: typeof fetch = fetch): Promise<AppRelease | null> {
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${Updates.repository}/releases?per_page=30`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "AnoniMaiker" },
        signal: AbortSignal.timeout(20_000),
      });
      text = await response.text();
    } catch (error) {
      throw UpdateError.network(error instanceof Error ? error.message : String(error));
    }
    if (response.status === 404) return null;
    if (response.status !== 200) throw UpdateError.network(`GitHub ha risposto ${response.status}.`);
    return Updates.parseList(text);
  }

  /// La release di Windows più nuova di un elenco di GitHub.
  static parseList(data: string): AppRelease | null {
    const list: unknown = JSON.parse(data);
    if (!Array.isArray(list)) throw new Error("risposta di GitHub non valida");
    let best: GitHubRelease | null = null;
    for (const item of list) {
      const release = Updates.decodeRelease(item);
      if (!release || !Updates.isWindowsRelease(release)) continue;
      if (!best || Updates.isNewer(Updates.version(release.tag_name), Updates.version(best.tag_name))) best = release;
    }
    return best ? Updates.release(best) : null;
  }

  /// Una release di GitHub; null se è una bozza, una pre-release o una release del Mac.
  static parse(data: string): AppRelease | null {
    const release = Updates.decodeRelease(JSON.parse(data));
    if (!release) throw new Error("risposta di GitHub non valida");
    return Updates.isWindowsRelease(release) ? Updates.release(release) : null;
  }

  private static isWindowsRelease(release: GitHubRelease): boolean {
    return release.draft !== true && release.prerelease !== true && release.tag_name.toLowerCase().startsWith(Updates.tagPrefix);
  }

  /// «windows-v0.16» → «0.16».
  private static version(tag: string): string {
    let version = tag.toLowerCase().startsWith(Updates.tagPrefix) ? tag.slice(Updates.tagPrefix.length) : tag;
    if (version.startsWith("v") || version.startsWith("V")) version = version.slice(1);
    return version;
  }

  private static release(release: GitHubRelease): AppRelease {
    const installer = release.assets.find((asset) => asset.name.toLowerCase().endsWith(".exe"));
    if (!installer) throw UpdateError.noDownload();
    const signature = release.assets.find((asset) => asset.name === installer.name + ".sig")?.browser_download_url ?? null;
    const published = release.published_at ? new Date(release.published_at) : null;
    return {
      version: Updates.version(release.tag_name),
      title: release.name ?? release.tag_name,
      notes: release.body ?? "",
      page: release.html_url,
      installer: installer.browser_download_url,
      installerSize: installer.size,
      signature,
      published: published && !Number.isNaN(published.getTime()) ? published : null,
    };
  }

  /// Come il `Decodable` del Mac: `tag_name`, `html_url` e `assets` (con nome, dimensione e indirizzo) devono esserci.
  private static decodeRelease(value: unknown): GitHubRelease | null {
    if (typeof value !== "object" || value === null) return null;
    const item = value as Record<string, unknown>;
    if (typeof item.tag_name !== "string" || typeof item.html_url !== "string" || !Array.isArray(item.assets)) return null;
    const assets: GitHubAsset[] = [];
    for (const asset of item.assets as unknown[]) {
      if (typeof asset !== "object" || asset === null) return null;
      const a = asset as Record<string, unknown>;
      if (typeof a.name !== "string" || !Number.isSafeInteger(a.size) || typeof a.browser_download_url !== "string") return null;
      assets.push({ name: a.name, size: a.size as number, browser_download_url: a.browser_download_url });
    }
    const optionalString = (v: unknown) => (typeof v === "string" ? v : null);
    const optionalBool = (v: unknown) => (typeof v === "boolean" ? v : null);
    return {
      tag_name: item.tag_name,
      name: optionalString(item.name),
      body: optionalString(item.body),
      html_url: item.html_url,
      draft: optionalBool(item.draft),
      prerelease: optionalBool(item.prerelease),
      published_at: optionalString(item.published_at),
      assets,
    };
  }

  // MARK: Firma

  /// L'impronta SHA-256 di un file, letta a pezzi (un installatore pesa centinaia di MB).
  static digest(file: string): Buffer {
    const hasher = createHash("sha256");
    const chunk = Buffer.alloc(8 << 20);
    const handle = openSync(file, "r");
    try {
      for (;;) {
        const read = readSync(handle, chunk, 0, chunk.length, null);
        if (read === 0) break;
        hasher.update(chunk.subarray(0, read));
      }
    } finally {
      closeSync(handle);
    }
    return hasher.digest();
  }

  /// La firma (base64) di un file con la chiave privata (base64, i 32 byte grezzi come `rawRepresentation` di CryptoKit).
  static sign(file: string, privateKey: string): string {
    const raw = decodeBase64(privateKey.trim());
    if (!raw || raw.length !== 32) throw new Error("Chiave privata non valida.");
    const key = createPrivateKey({ key: Buffer.concat([pkcs8Prefix, raw]), format: "der", type: "pkcs8" });
    return signData(null, Updates.digest(file), key).toString("base64");
  }

  /// Il file è firmato con la chiave pubblica indicata?
  static verify(file: string, signature: string, publicKey: string = Updates.publicKey): boolean {
    try {
      const raw = decodeBase64(publicKey.trim());
      const signatureData = decodeBase64(signature.trim());
      if (!raw || raw.length !== 32 || !signatureData) return false;
      const key = createPublicKey({ key: Buffer.concat([spkiPrefix, raw]), format: "der", type: "spki" });
      return verifyData(null, Updates.digest(file), key, signatureData);
    } catch {
      return false;
    }
  }
}
