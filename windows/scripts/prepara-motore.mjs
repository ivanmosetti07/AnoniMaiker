// Mette il motore ONNX (modello, tokenizer ed etichette) in windows/engine/, da dove l'installatore lo copia nell'app.
// Una volta sola, o per aggiornarlo. Lo scarica dalla release «motore-onnx-1» del progetto su GitHub (circa 600 MB) e
// ne controlla l'impronta SHA-256.
//
// Uso: npm run motore            (scarica)
//      npm run motore -- <zip>   (da un file già scaricato)
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const MOTORE_URL = "https://github.com/ivanmosetti07/AnoniMaiker/releases/download/motore-onnx-1/motore-onnx.zip";
const MOTORE_SHA256 = "37d902a1178d952c36578972a2ebc9477c3633eb53994c995c1faf6fbfa1a5d6";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "engine");
const files = ["model.onnx", "tokenizer.json", "config.json"];

if (files.every((name) => existsSync(join(dest, name))) && !process.argv[2]) {
  console.log("✅ Il motore c'è già in engine/.");
  process.exit(0);
}

let zip = process.argv[2];
if (!zip) {
  zip = join(root, "engine.zip");
  console.log("▶︎ Scarico il motore (circa 600 MB)…");
  const response = await fetch(MOTORE_URL);
  if (!response.ok || !response.body) throw new Error(`Download non riuscito: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zip));
}

const data = readFileSync(zip);
const digest = createHash("sha256").update(data).digest("hex");
if (digest !== MOTORE_SHA256) {
  if (!process.argv[2]) rmSync(zip, { force: true });
  console.error("L'impronta del motore scaricato non corrisponde: file scartato.");
  process.exit(1);
}
const entries = unzipSync(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
const tmp = `${dest}.tmp`;
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
for (const name of files) {
  const entry = entries[name] ?? Object.entries(entries).find(([path]) => path.endsWith(`/${name}`))?.[1];
  if (!entry) throw new Error(`Nel motore manca ${name}`);
  writeFileSync(join(tmp, name), entry);
}
if (!process.argv[2]) rmSync(zip, { force: true });
rmSync(dest, { recursive: true, force: true });
renameSync(tmp, dest);
const size = files.reduce((sum, name) => sum + statSync(join(dest, name)).size, 0);
console.log(`✅ Motore pronto in engine/ (${Math.round(size / 1e6)} MB).`);
