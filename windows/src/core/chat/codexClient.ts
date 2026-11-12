import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, mkdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir, constants as osConstants } from "node:os";
import { delimiter, join } from "node:path";
import { CancellationError } from "../aggiornamenti";
import { trimWhitespace } from "../crm/crmModel";
import { newUUID } from "../sicurezza/swiftCoding";

// MARK: - GPT con l'abbonamento ChatGPT, attraverso la CLI Codex
//
// L'app non tiene chiavi né password: usa `codex exec`, dove l'utente ha già fatto l'accesso con il suo account ChatGPT.
// Codex parte isolato: senza la configurazione dell'utente, senza sessioni salvate, in sola lettura, senza strumenti,
// senza ricerca sul web e in una cartella vuota. Riceve la conversazione (già anonimizzata) da stdin e restituisce
// eventi JSON, uno per riga; la risposta è nell'evento `item.completed` di tipo `agent_message`.
//
// Su Windows Codex si installa con npm (`npm i -g @openai/codex`) e il programma è `codex.cmd` nella cartella globale di
// npm (`%APPDATA%\npm`). Un `.cmd` si avvia solo attraverso `cmd.exe`: gli argomenti si citano uno per uno (come fa
// cross-spawn) e il testo dell'utente non entra mai nella riga di comando, arriva sempre da stdin.

export type CodexStatus = { kind: "notInstalled" } | { kind: "notLoggedIn" } | { kind: "ready"; detail: string };

export const CodexStatus = {
  notInstalled: { kind: "notInstalled" } as CodexStatus,
  notLoggedIn: { kind: "notLoggedIn" } as CodexStatus,
  ready(detail: string): CodexStatus {
    return { kind: "ready", detail };
  },
};

export type CodexErrorCode = "notInstalled" | "notLoggedIn" | "failed" | "offline" | "emptyReply";

export class CodexError extends Error {
  private constructor(
    readonly code: CodexErrorCode,
    message: string,
    /// Il messaggio di Codex (`failed`).
    readonly detail?: string,
  ) {
    super(message);
    this.name = "CodexError";
  }

  static readonly notInstalled = new CodexError(
    "notInstalled",
    "Il tuo account ChatGPT non è ancora collegato: premi «Collega il tuo account ChatGPT» (Impostazioni › Chat).",
  );
  static readonly notLoggedIn = new CodexError(
    "notLoggedIn",
    "Il tuo account ChatGPT non è collegato: premi «Collega il tuo account ChatGPT» (Impostazioni › Chat).",
  );
  static readonly offline = new CodexError(
    "offline",
    "Nessuna connessione a internet: GPT non è raggiungibile. Controlla la rete e premi «Riprova».",
  );
  static readonly emptyReply = new CodexError("emptyReply", "GPT non ha restituito una risposta.");

  static failed(message: string): CodexError {
    return new CodexError("failed", `GPT non ha risposto: ${message}`, message);
  }

  /// Stesso caso e stessi valori (come `Equatable` in Swift).
  equals(other: CodexError): boolean {
    return this.code === other.code && this.detail === other.detail;
  }
}

export type SetupErrorCode = "needsNode" | "installFailed" | "loginFailed";

/// In Swift `CodexClient.SetupError`.
export class SetupError extends Error {
  private constructor(
    readonly code: SetupErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "SetupError";
  }

  static readonly needsNode = new SetupError(
    "needsNode",
    "Per installare Codex serve Node.js (gratuito): scaricalo da nodejs.org, installalo e riprova.",
  );

  static installFailed(detail: string): SetupError {
    return new SetupError("installFailed", `Installazione di Codex non riuscita: ${detail}`, detail);
  }

  static loginFailed(detail: string): SetupError {
    return new SetupError("loginFailed", `Accesso a ChatGPT non completato: ${detail}`, detail);
  }

  equals(other: SetupError): boolean {
    return this.code === other.code && this.detail === other.detail;
  }
}

/// L'uscita di un processo.
export interface CodexOutput {
  status: number;
  stdout: string;
  stderr: string;
  /// Fermato perché nell'uscita è comparso `stopOn`.
  stopped: boolean;
}

export interface RunOptions {
  /// Il testo da mandare su stdin (null: niente stdin).
  input?: string | Uint8Array | null;
  /// Se compare nell'uscita, il processo si ferma (`CodexOutput.stopped`).
  stopOn?: string | null;
  /// Ogni pezzo di uscita, appena arriva (stdout e stderr).
  onOutput?: (text: string) => void;
  /// Annulla: il processo si ferma e la promessa fallisce con `CancellationError`.
  signal?: AbortSignal;
}

const isWindows = process.platform === "win32";

/// Le funzioni di Codex da spegnere: la chat deve solo rispondere, mai agire sul PC.
const disabledFeatures = [
  "shell_tool", "unified_exec", "apps", "memories", "plugins", "remote_plugin", "skill_search", "tool_suggest", "browser_use",
  "browser_use_external", "computer_use", "in_app_browser", "image_generation", "view_image", "multi_agent", "goals", "hooks",
  "sleep_tool",
];

export class CodexClient {
  static readonly disabledFeatures = disabledFeatures;
  /// Cosa scrive Codex quando non c'è rete e aspetta che torni.
  static readonly offlineSignal = "waiting for network";

  /// Il programma Codex da usare al posto di quello cercato (per le prove, con un Codex finto). null: si cerca.
  static executableOverride: string | null = null;
  /// I programmi di installazione (npm, brew) da usare al posto di quelli cercati (per le prove).
  static toolOverrides: Record<string, string | null> = {};

  readonly model: string | null;
  readonly effort: string | null;

  constructor(model: string | null = null, effort: string | null = null) {
    this.model = model !== null && model.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, "").length > 0 ? model : null;
    this.effort = effort;
  }

  /// Quanto ragiona il modello (i livelli che il modello accetta stanno nel catalogo): più ragiona, più è lento.
  static effortTitle(effort: string): string {
    switch (effort) {
      case "minimal":
        return "Minimo";
      case "low":
        return "Veloce";
      case "medium":
        return "Normale";
      case "high":
        return "Accurato";
      case "xhigh":
        return "Molto accurato";
      case "max":
        return "Massimo";
      case "ultra":
        return "Ultra";
      default:
        return effort;
    }
  }

  // MARK: Dove sta Codex

  /// Un'app aperta dal menu Start (o dal Finder sul Mac) può non avere il PATH del terminale: si cercano anche le
  /// cartelle d'installazione più comuni.
  static get searchPath(): string[] {
    const env = process.env;
    const home = homedir();
    const inherited = (pathVariable(env) ?? "").split(delimiter);
    let common: string[];
    if (isWindows) {
      const appData = env.APPDATA ?? join(home, "AppData", "Roaming");
      const localAppData = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
      const programFiles = env.ProgramFiles ?? "C:\\Program Files";
      common = [
        join(appData, "npm"),
        ...(env.npm_config_prefix ? [env.npm_config_prefix] : []),
        join(programFiles, "nodejs"),
        join(localAppData, "Programs", "nodejs"),
        join(localAppData, "Volta", "bin"),
        join(appData, "nvm"),
        join(home, ".bun", "bin"),
        join(home, ".local", "bin"),
        join(localAppData, "Microsoft", "WindowsApps"),
      ];
    } else {
      common = ["/opt/homebrew/bin", "/usr/local/bin", home + "/.npm-global/bin", home + "/.local/bin", home + "/.volta/bin",
        home + "/.bun/bin", "/usr/bin", "/bin"];
    }
    const seen = new Set<string>();
    return [...common, ...inherited].filter((directory) => {
      const key = isWindows ? directory.toLowerCase() : directory;
      if (directory.length === 0 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /// Il primo programma con quel nome nelle cartelle di `searchPath` (su Windows con le estensioni dei programmi).
  static tool(name: string): string | null {
    if (name in CodexClient.toolOverrides) return CodexClient.toolOverrides[name] ?? null;
    const names = isWindows ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`] : [name];
    for (const directory of CodexClient.searchPath) {
      for (const file of names) {
        const path = join(directory, file);
        if (isExecutableFile(path)) return path;
      }
    }
    return null;
  }

  static executable(): string | null {
    if (CodexClient.executableOverride !== null) {
      return isExecutableFile(CodexClient.executableOverride) ? CodexClient.executableOverride : null;
    }
    return CodexClient.tool("codex");
  }

  /// Codex è installato e ha fatto l'accesso?
  static async status(signal?: AbortSignal): Promise<CodexStatus> {
    const codex = CodexClient.executable();
    if (codex === null) return CodexStatus.notInstalled;
    let output: CodexOutput;
    try {
      output = await CodexClient.run(codex, ["login", "status"], { signal });
    } catch (error) {
      if (error instanceof CancellationError) throw error;
      return CodexStatus.notLoggedIn;
    }
    const text = trimWhitespace(output.stdout + "\n" + output.stderr);
    const lower = text.toLowerCase();
    if (output.status !== 0 || !lower.includes("logged in") || lower.includes("not logged in")) return CodexStatus.notLoggedIn;
    const lines = text.split(/\r\n|[\n\r\v\f\u0085\u2028\u2029]/u);
    return CodexStatus.ready(lines[lines.length - 1] ?? text);
  }

  // MARK: Collegare il proprio account

  /// Installa Codex con npm (o Homebrew sul Mac). Ognuno lo installa sul proprio PC, una volta sola.
  static async install(signal?: AbortSignal): Promise<void> {
    let attempt: [string, string[]];
    const npm = CodexClient.tool("npm");
    const brew = isWindows ? null : CodexClient.tool("brew");
    if (npm !== null) {
      attempt = [npm, ["install", "-g", "@openai/codex"]];
    } else if (brew !== null) {
      attempt = [brew, ["install", "codex"]];
    } else {
      throw SetupError.needsNode;
    }
    const output = await CodexClient.run(attempt[0], attempt[1], { signal });
    if (output.status !== 0 || CodexClient.executable() === null) {
      const detail = trimWhitespace(output.stderr + "\n" + output.stdout);
      if (detail.includes("EACCES") || (isWindows && detail.includes("EPERM"))) {
        throw SetupError.installFailed(
          isWindows
            ? "npm non ha i permessi per installare programmi. Installa Node.js da nodejs.org e riprova."
            : "npm non ha i permessi per installare programmi. Installa Node.js da nodejs.org (o usa Homebrew) e riprova.",
        );
      }
      throw SetupError.installFailed(detail.slice(-300));
    }
  }

  /// L'indirizzo di accesso che Codex stampa (per aprirlo se il browser non parte da solo).
  static loginURL(text: string): string | null {
    const match = /https:\/\/[^\s"'<>]+/u.exec(text);
    if (!match) return null;
    // Come `URL(string:)`: un indirizzo che non si legge non vale.
    return URL.canParse(match[0]) ? match[0] : null;
  }

  /// Collega l'account ChatGPT di chi usa questo PC: Codex apre il browser sulla pagina di accesso di OpenAI e aspetta.
  /// `onURL` riceve l'indirizzo della pagina, da offrire se il browser non si apre.
  static async login(onURL: (url: string) => void, signal?: AbortSignal): Promise<void> {
    const codex = CodexClient.executable();
    if (codex === null) throw CodexError.notInstalled;
    let seen = false;
    let collected = "";
    const offer = (text: string) => {
      const url = CodexClient.loginURL(text);
      if (url !== null && !seen) {
        seen = true;
        onURL(url);
      }
    };
    const output = await CodexClient.run(codex, ["login"], {
      signal,
      onOutput: (text) => {
        // L'indirizzo può arrivare spezzato in due pezzi: si offre solo quando è finito (seguito da uno spazio o a capo).
        collected += text;
        const complete = /https:\/\/[^\s"'<>]+(?=[\s"'<>])/u.exec(collected);
        if (complete) offer(complete[0]);
      },
    });
    offer(collected);
    if (output.status !== 0 || (await CodexClient.status(signal)).kind === "notLoggedIn") {
      const detail = trimWhitespace(output.stderr + "\n" + output.stdout);
      throw SetupError.loginFailed(detail.length === 0 ? "accesso annullato." : detail.slice(-300));
    }
  }

  /// Scollega l'account ChatGPT da Codex su questo PC.
  static async logout(signal?: AbortSignal): Promise<void> {
    const codex = CodexClient.executable();
    if (codex === null) return;
    await CodexClient.run(codex, ["logout"], { signal });
  }

  // MARK: I modelli

  /// I modelli che si possono scegliere, dal catalogo di Codex: solo le famiglie terra, luna e sol dalla versione 6 in
  /// poi (i nuovi compaiono da soli). Dal più recente; a parità di versione nell'ordine del catalogo.
  static async models(signal?: AbortSignal): Promise<CodexModel[]> {
    const codex = CodexClient.executable();
    if (codex === null) return [];
    try {
      const output = await CodexClient.run(codex, ["debug", "models"], { signal });
      return output.status === 0 ? CodexClient.parseModels(output.stdout) : [];
    } catch (error) {
      if (error instanceof CancellationError) throw error;
      return [];
    }
  }

  static parseModels(data: string | Uint8Array): CodexModel[] {
    let catalog: unknown;
    try {
      catalog = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
    } catch {
      return [];
    }
    const entries = readCatalog(catalog);
    if (entries === null) return [];
    const models: CodexModel[] = [];
    for (const entry of entries) {
      if (entry.visibility === "hide") continue;
      const version = CodexModel.version(entry.slug);
      if (version === null || version.major < CodexModel.minimumVersion) continue;
      models.push({
        slug: entry.slug,
        name: entry.display_name ?? entry.slug,
        summary: entry.description ?? "",
        efforts: entry.supported_reasoning_levels?.map((level) => level.effort) ?? [],
        defaultEffort: entry.default_reasoning_level ?? null,
        major: version.major,
        minor: version.minor,
        priority: entry.priority ?? Number.MAX_SAFE_INTEGER,
      });
    }
    return models.sort((a, b) =>
      a.major !== b.major ? b.major - a.major : a.minor !== b.minor ? b.minor - a.minor : a.priority - b.priority,
    );
  }

  // MARK: Una richiesta

  arguments(): string[] {
    const args = ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-s", "read-only", "--color", "never", "--json"];
    for (const feature of disabledFeatures) args.push("--disable", feature);
    args.push("-c", `web_search="disabled"`);
    if (this.model !== null) args.push("-m", this.model);
    if (this.effort !== null && this.effort.length > 0 && /^\p{L}+$/u.test(this.effort)) {
      args.push("-c", `model_reasoning_effort="${this.effort}"`);
    }
    args.push("-");
    return args;
  }

  /// Manda il testo (già anonimizzato) e restituisce la risposta di GPT così com'è.
  async send(transcript: string, signal?: AbortSignal): Promise<string> {
    const codex = CodexClient.executable();
    if (codex === null) throw CodexError.notInstalled;
    // Senza rete Codex riprova all'infinito («waiting for network»): lo si ferma e si dice perché.
    const output = await CodexClient.run(codex, this.arguments(), { input: transcript, stopOn: CodexClient.offlineSignal, signal });
    if (output.stopped) throw CodexError.offline;
    const events = CodexClient.parse(output.stdout);
    if (events.reply !== null) return events.reply;
    const message = events.error ?? trimWhitespace(output.stderr);
    throw CodexClient.classify(message, output.status);
  }

  static classify(message: string, status: number): CodexError {
    const lower = message.toLowerCase();
    // «non è riconosciuto come comando» è il messaggio di cmd.exe in italiano.
    if (lower.includes("command not found") || lower.includes("no such file") || lower.includes("is not recognized") ||
      lower.includes("non è riconosciuto")) {
      return CodexError.notInstalled;
    }
    if (lower.includes("login") || lower.includes("401") || lower.includes("unauthorized") || lower.includes("not logged in")) {
      return CodexError.notLoggedIn;
    }
    if (message.length === 0) return status === 0 ? CodexError.emptyReply : CodexError.failed(`Codex si è fermato (codice ${status}).`);
    return CodexError.failed(message.slice(-400));
  }

  /// Gli eventi JSON di `codex exec --json`: la risposta (l'ultimo `agent_message`) o l'errore.
  static parse(output: string): { reply: string | null; error: string | null } {
    const replies: string[] = [];
    let error: string | null = null;
    for (const line of output.split(/[\n\r\v\f\u0085\u2028\u2029]+/u)) {
      if (line.length === 0) continue;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isObject(event) || typeof event.type !== "string") continue;
      switch (event.type) {
        case "item.completed": {
          // Gli elementi di tipo «error» qui sono solo avvisi di Codex (per esempio sulle skill): si ignorano.
          const item = event.item;
          if (isObject(item) && item.type === "agent_message" && typeof item.text === "string" && trimWhitespace(item.text).length > 0) {
            replies.push(item.text);
          }
          break;
        }
        case "turn.failed": {
          const message = isObject(event.error) ? event.error.message : undefined;
          if (typeof message === "string") error = message;
          break;
        }
        case "error":
          if (typeof event.message === "string") error = event.message;
          break;
      }
    }
    return { reply: replies.length > 0 ? replies[replies.length - 1] : null, error: replies.length === 0 ? error : null };
  }

  // MARK: Il processo

  /// Avvia un programma in una cartella vuota e aspetta che finisca; se `signal` viene annullato, lo ferma. Se
  /// nell'uscita compare `stopOn`, lo ferma e lo dice in `CodexOutput.stopped`.
  static run(executable: string, args: readonly string[], options: RunOptions = {}): Promise<CodexOutput> {
    const { input = null, stopOn = null, onOutput, signal } = options;
    if (signal?.aborted) return Promise.reject(new CancellationError());
    const directory = join(tmpdir(), `chat-${newUUID()}`);
    mkdirSync(directory, { recursive: true });
    const cleanup = () => rmSync(directory, { recursive: true, force: true });

    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
    env.PATH = CodexClient.searchPath.join(delimiter);
    env.NO_COLOR = "1";

    const command = spawnCommand(executable, args);
    return new Promise<CodexOutput>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(command.file, command.args, {
          cwd: directory,
          env,
          stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"],
          windowsHide: true,
          windowsVerbatimArguments: command.verbatim,
        });
      } catch {
        cleanup();
        reject(CodexError.notInstalled);
        return;
      }
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let stdoutText = "";
      let stopped = false;
      let failed = false;

      const onAbort = () => terminate(child);
      signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout?.on("data", (chunk: Buffer) => {
        out.push(chunk);
        const text = chunk.toString("utf8");
        onOutput?.(text);
        if (stopOn !== null && !stopped) {
          stdoutText += text;
          if (stdoutText.includes(stopOn)) {
            stopped = true;
            terminate(child);
          }
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        err.push(chunk);
        onOutput?.(chunk.toString("utf8"));
      });
      child.on("error", () => {
        // Il programma non parte (non c'è, o non si può eseguire).
        failed = true;
        signal?.removeEventListener("abort", onAbort);
        cleanup();
        reject(CodexError.notInstalled);
      });
      child.on("exit", () => {
        // Fermato da noi: un processo figlio rimasto acceso non deve tenere aperte le uscite (e la promessa).
        if (stopped || signal?.aborted) {
          child.stdout?.destroy();
          child.stderr?.destroy();
        }
      });
      child.on("close", (code, killedBy) => {
        if (failed) return;
        signal?.removeEventListener("abort", onAbort);
        cleanup();
        if (signal?.aborted) {
          reject(new CancellationError());
          return;
        }
        const status = code ?? (killedBy ? (osConstants.signals[killedBy] ?? 1) : 1);
        resolve({ status, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), stopped });
      });
      if (input !== null && child.stdin) {
        // Come `try?` sul Mac: un programma che chiude stdin prima del tempo non è un errore qui.
        child.stdin.on("error", () => undefined);
        child.stdin.end(typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input));
      }
    });
  }
}

/// Un modello di GPT che si può scegliere per la chat.
export interface CodexModel {
  /// Il nome per Codex («gpt-6-sol»); è anche l'identificativo.
  readonly slug: string;
  /// Il nome da mostrare («GPT-6-Sol»).
  readonly name: string;
  readonly summary: string;
  /// I livelli di ragionamento che accetta («low», «medium», …).
  readonly efforts: string[];
  readonly defaultEffort: string | null;
  readonly major: number;
  readonly minor: number;
  readonly priority: number;
}

export const CodexModel = {
  /// Solo queste famiglie, dalla versione 6.
  families: ["terra", "luna", "sol"] as const,
  minimumVersion: 6,

  /// Un nome di modello che si può usare (terra, luna o sol dalla versione 6).
  isAllowed(slug: string): boolean {
    return (CodexModel.version(slug)?.major ?? 0) >= CodexModel.minimumVersion;
  },

  /// «gpt-6-sol» → (6, 0, «sol»); «gpt-5.6-terra» → (5, 6, «terra»); null per le altre famiglie.
  version(slug: string): { major: number; minor: number; family: string } | null {
    const match = new RegExp(`^gpt-(\\d+)(?:\\.(\\d+))?-(${CodexModel.families.join("|")})$`, "i").exec(slug);
    if (!match) return null;
    const major = Number.parseInt(match[1], 10) || 0;
    const minor = match[2] === undefined ? 0 : Number.parseInt(match[2], 10) || 0;
    return { major, minor, family: match[3].toLowerCase() };
  },
};

// MARK: - Dettagli

interface CatalogEntry {
  slug: string;
  display_name?: string;
  description?: string;
  visibility?: string;
  default_reasoning_level?: string;
  supported_reasoning_levels?: { effort: string }[];
  priority?: number;
}

/// Il catalogo come lo legge `JSONDecoder`: un campo del tipo sbagliato fa fallire tutto.
function readCatalog(json: unknown): CatalogEntry[] | null {
  if (!isObject(json) || !Array.isArray(json.models)) return null;
  const entries: CatalogEntry[] = [];
  const optionalString = (value: unknown) => value === undefined || value === null || typeof value === "string";
  for (const raw of json.models) {
    if (!isObject(raw) || typeof raw.slug !== "string") return null;
    if (!optionalString(raw.display_name) || !optionalString(raw.description) || !optionalString(raw.visibility) ||
      !optionalString(raw.default_reasoning_level)) return null;
    if (raw.priority !== undefined && raw.priority !== null && !(typeof raw.priority === "number" && Number.isInteger(raw.priority))) return null;
    let levels: { effort: string }[] | undefined;
    if (raw.supported_reasoning_levels !== undefined && raw.supported_reasoning_levels !== null) {
      if (!Array.isArray(raw.supported_reasoning_levels)) return null;
      levels = [];
      for (const level of raw.supported_reasoning_levels) {
        if (!isObject(level) || typeof level.effort !== "string") return null;
        levels.push({ effort: level.effort });
      }
    }
    entries.push({
      slug: raw.slug,
      display_name: (raw.display_name as string | null) ?? undefined,
      description: (raw.description as string | null) ?? undefined,
      visibility: (raw.visibility as string | null) ?? undefined,
      default_reasoning_level: (raw.default_reasoning_level as string | null) ?? undefined,
      supported_reasoning_levels: levels,
      priority: (raw.priority as number | null) ?? undefined,
    });
  }
  return entries;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathVariable(env: NodeJS.ProcessEnv): string | undefined {
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  return key === undefined ? undefined : env[key];
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    // Su Windows conta l'estensione (già scelta da chi chiama); altrove il permesso di esecuzione.
    if (!isWindows) accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/// Come avviare un programma. Su Windows un `.cmd`/`.bat` passa da `cmd.exe /d /s /c` con ogni argomento citato
/// e protetto (le regole di cross-spawn: virgolette e barre rovesciate per il programma, «^» davanti ai caratteri
/// speciali di cmd, due volte perché lo «shim» di npm rilegge gli argomenti con `%*`).
export function spawnCommand(executable: string, args: readonly string[], platform: NodeJS.Platform = process.platform): {
  file: string;
  args: string[];
  verbatim: boolean;
} {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(executable)) return { file: executable, args: [...args], verbatim: false };
  const line = [escapeCommand(executable), ...args.map((arg) => escapeArgument(arg, true))].join(" ");
  return { file: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
}

const cmdMeta = /([()\][%!^"`<>&|;, *?])/g;

function escapeCommand(command: string): string {
  return command.replace(cmdMeta, "^$1");
}

function escapeArgument(argument: string, doubleEscape: boolean): string {
  if (/[\r\n]/.test(argument)) throw CodexError.failed("argomento non valido per cmd.exe");
  let arg = argument.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  arg = arg.replace(/(?=(\\+?)?)\1$/, "$1$1");
  arg = `"${arg}"`;
  arg = arg.replace(cmdMeta, "^$1");
  if (doubleEscape) arg = arg.replace(cmdMeta, "^$1");
  return arg;
}

/// Ferma il processo; su Windows tutto l'albero (cmd.exe → node → codex), altrimenti resterebbe Codex acceso.
function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows && child.pid !== undefined) {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
  } else {
    child.kill("SIGTERM");
  }
}
