import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppRelease, InstallError, UpdateError, UpdateInstaller, Updates } from "../src/core/aggiornamenti";

/// Gli aggiornamenti: versioni, release di GitHub (solo quelle di Windows), firma degli installatori.

const files: string[] = [];
afterEach(() => {
  for (const file of files.splice(0)) rmSync(file, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

/// Una coppia di chiavi Ed25519 in base64 grezzo (32 byte), come `Curve25519.Signing.PrivateKey().rawRepresentation`.
function newKey(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync("ed25519");
  const privateDer = pair.privateKey.export({ format: "der", type: "pkcs8" });
  const publicDer = pair.publicKey.export({ format: "der", type: "spki" });
  return { privateKey: privateDer.subarray(-32).toString("base64"), publicKey: publicDer.subarray(-32).toString("base64") };
}

const release = (tag: string, assets: string[], extra = "") => `
  {"tag_name":"${tag}","name":"AnoniMaiker ${tag}","body":"Novità","html_url":"https://github.com/x/y/releases/tag/${tag}",
   "draft":false,"prerelease":false,"published_at":"2026-10-20T10:00:00Z"${extra},
   "assets":[${assets.map((name) => `{"name":"${name}","size":123,"browser_download_url":"https://example.com/${name}"}`).join(",")}]}`;

describe("UpdatesTests", () => {
  it("versions compare as numbers", () => {
    expect(Updates.isNewer("0.10", "0.9")).toBe(true);
    expect(Updates.isNewer("v1.0", "0.9.9")).toBe(true);
    expect(Updates.isNewer("0.5.1", "0.5")).toBe(true);
    expect(Updates.isNewer("0.5", "0.5.0")).toBe(false);
    expect(Updates.isNewer("0.4", "0.5")).toBe(false);
    expect(Updates.isNewer("0.6-beta", "0.6")).toBe(false);
    expect(Updates.isNewer("0.6", "0.6-beta")).toBe(true);
  });

  it("github release is read", () => {
    const json = release("windows-v0.6", ["AnoniMaiker-Setup-0.6.exe", "AnoniMaiker-Setup-0.6.exe.sig", "AnoniMaiker-Setup-0.6.exe.blockmap"]);
    const parsed = Updates.parse(json)!;
    expect(parsed.version).toBe("0.6");
    expect(parsed.installer.split("/").pop()).toBe("AnoniMaiker-Setup-0.6.exe");
    expect(parsed.signature?.split("/").pop()).toBe("AnoniMaiker-Setup-0.6.exe.sig");
    expect(parsed.installerSize).toBe(123);
    expect(parsed.published).not.toBeNull();

    expect(Updates.parse(json.replace('"prerelease":false', '"prerelease":true'))).toBeNull();
    const noInstaller = `{"tag_name":"windows-v1","html_url":"https://github.com","assets":[]}`;
    expect(() => Updates.parse(noInstaller)).toThrow(UpdateError.noDownload().message);
  });

  /// Nello stesso progetto ci sono le release del Mac: Windows le ignora.
  it("mac releases are ignored", () => {
    expect(Updates.parse(release("v0.6", ["AnoniMaiker-0.6.dmg", "AnoniMaiker-0.6.dmg.sig"]))).toBeNull();
    const list = `[${[
      release("v0.17", ["AnoniMaiker-0.17.dmg", "AnoniMaiker-0.17.dmg.sig"]),
      release("windows-v0.16", ["AnoniMaiker-Setup-0.16.exe", "AnoniMaiker-Setup-0.16.exe.sig"]),
      release("windows-v0.18", ["AnoniMaiker-Setup-0.18.exe"]).replace('"draft":false', '"draft":true'),
      release("windows-v0.15", ["AnoniMaiker-Setup-0.15.exe", "AnoniMaiker-Setup-0.15.exe.sig"]),
    ].join(",")}]`;
    const latest = Updates.parseList(list)!;
    expect(latest.version).toBe("0.16");
    expect(latest.signature?.endsWith("AnoniMaiker-Setup-0.16.exe.sig")).toBe(true);
    expect(Updates.parseList(`[${release("v0.17", ["AnoniMaiker-0.17.dmg"])}]`)).toBeNull();
  });

  it("latest asks GitHub for the list", async () => {
    const fetchMock = vi.fn(async () => new Response(`[${release("windows-v0.20", ["AnoniMaiker-Setup-0.20.exe"])}]`, { status: 200 }));
    const latest = await Updates.latest(fetchMock as unknown as typeof fetch);
    expect(latest?.version).toBe("0.20");
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://api.github.com/repos/ivanmosetti07/AnoniMaiker/releases?per_page=30");
    expect(await Updates.latest((async () => new Response("", { status: 404 })) as unknown as typeof fetch)).toBeNull();
    await expect(Updates.latest((async () => new Response("", { status: 500 })) as unknown as typeof fetch)).rejects.toThrow(
      UpdateError.network("GitHub ha risposto 500.").message,
    );
  });

  it("only files signed with the key pass", () => {
    const file = join(tmpdir(), `aggiornamento-${randomUUID()}.exe`);
    files.push(file);
    writeFileSync(file, Buffer.alloc(20 << 20, 7));
    const key = newKey();
    const signature = Updates.sign(file, key.privateKey);
    expect(Updates.verify(file, signature, key.publicKey)).toBe(true);
    // Un'altra chiave (anche quella dell'app) o un file cambiato non passano.
    expect(Updates.verify(file, signature)).toBe(false);
    expect(Updates.verify(file, signature, newKey().publicKey)).toBe(false);
    writeFileSync(file, Buffer.alloc(1, 8));
    expect(Updates.verify(file, signature, key.publicKey)).toBe(false);
    expect(Updates.verify(file, "non base64", key.publicKey)).toBe(false);
  });

  it("app key is valid", () => {
    expect(Buffer.from(Updates.publicKey, "base64").length).toBe(32);
    // Una firma qualunque non passa, ma la chiave si carica (verify non lancia).
    const file = join(tmpdir(), `aggiornamento-${randomUUID()}.exe`);
    files.push(file);
    writeFileSync(file, "x");
    expect(Updates.verify(file, Buffer.alloc(64).toString("base64"))).toBe(false);
  });

  /// `fixtures/firma/` contiene un file firmato da `swift run firma-rilascio firma` (CryptoKit) con una chiave di prova.
  it.runIf(existsSync(join(__dirname, "fixtures", "firma", "file.bin")))("a signature made on the Mac is accepted", () => {
    const folder = join(__dirname, "fixtures", "firma");
    const publicKey = readFileSync(join(folder, "pubblica.txt"), "utf8").trim();
    const file = join(folder, "file.bin");
    expect(Updates.verify(file, readFileSync(join(folder, "file.bin.sig"), "utf8"), publicKey)).toBe(true);
    expect(Updates.verify(file, readFileSync(join(folder, "file.bin.sig"), "utf8"))).toBe(false);
  });

  // `translocatedAppsCannotBeReplaced` è solo del Mac (App Translocation): su Windows sostituisce l'app l'installatore.
});

describe("UpdateInstaller", () => {
  const sample = (overrides: Partial<AppRelease> = {}): AppRelease => ({
    version: "0.16",
    title: "AnoniMaiker 0.16",
    notes: "",
    page: "https://github.com/x/y/releases/tag/windows-v0.16",
    installer: "https://example.com/AnoniMaiker-Setup-0.16.exe",
    installerSize: 0,
    signature: "https://example.com/AnoniMaiker-Setup-0.16.exe.sig",
    published: null,
    ...overrides,
  });

  function stubDownloads(installer: Buffer, signature: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.endsWith(".sig") ? new Response(signature) : new Response(new Uint8Array(installer), { headers: { "content-length": String(installer.length) } }))),
    );
  }

  it("downloads, verifies and hands back the installer", async () => {
    const key = newKey();
    const content = Buffer.alloc(3 << 20, 42);
    const temporary = join(tmpdir(), `firma-${randomUUID()}.exe`);
    files.push(temporary);
    writeFileSync(temporary, content);
    stubDownloads(content, Updates.sign(temporary, key.privateKey));
    const progress: number[] = [];
    const installer = await UpdateInstaller.download(sample(), key.publicKey, (value) => progress.push(value));
    files.push(join(installer, ".."));
    expect(installer.endsWith("AnoniMaiker-Setup-0.16.exe")).toBe(true);
    expect(readFileSync(installer)).toEqual(content);
    expect(progress.at(-1)).toBe(1);
    expect(UpdateInstaller.installerArguments).toEqual(["/S", "--force-run"]);
  });

  it("refuses a wrong signature, an unsigned release and the wrong file", async () => {
    stubDownloads(Buffer.from("installatore"), Buffer.alloc(64).toString("base64"));
    await expect(UpdateInstaller.download(sample(), newKey().publicKey)).rejects.toThrow(UpdateError.badSignature().message);
    await expect(UpdateInstaller.download(sample({ signature: null }))).rejects.toThrow(UpdateError.unsigned().message);
    await expect(UpdateInstaller.download(sample({ installer: "https://example.com/AnoniMaiker-Setup-0.15.exe" }))).rejects.toThrow(InstallError);
  });
});
