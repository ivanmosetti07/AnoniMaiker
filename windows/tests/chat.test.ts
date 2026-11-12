import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { CancellationError } from "../src/core/aggiornamenti";
import {
  ChatAttachment, ChatConversation, ChatInput, ChatMessage, ChatShield, ChatStore, CodexClient, CodexError, chatMessage, spawnCommand,
} from "../src/core/chat";
import { Vault } from "../src/core/dizionario";
import { SecureFolder, fileKeyProtection } from "../src/core/sicurezza";
import { FormatTest } from "./formatTestSupport";

/// La chat con GPT: cosa parte (solo segnaposto), come si leggono le risposte di Codex, come tornano i dati veri.

const directories: string[] = [];
function temporaryDirectory(prefix: string): string {
  const directory = join(tmpdir(), `${prefix}-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  directories.push(directory);
  return directory;
}
afterEach(() => {
  CodexClient.executableOverride = null;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/// Un Codex finto: uno script di Node (su Windows con il suo `.cmd`, come quello che installa npm).
function fakeCodex(body: string): string {
  const directory = temporaryDirectory("codex-finto");
  const script = join(directory, "codex.js");
  writeFileSync(script, `#!/usr/bin/env node\n${body}\n`);
  if (process.platform === "win32") {
    const launcher = join(directory, "codex.cmd");
    writeFileSync(launcher, `@"${process.execPath}" "%~dp0codex.js" %*\r\n`);
    return launcher;
  }
  chmodSync(script, 0o755);
  return script;
}

describe("ChatTests", () => {
  test("codexEventsGiveTheLastAnswer", () => {
    const output = [
      `{"type":"thread.started","thread_id":"x"}`,
      `{"type":"turn.started"}`,
      `{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Skill descriptions were shortened"}}`,
      `{"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"penso"}}`,
      `{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Gentile [FULLNAME_1],"}}`,
      `{"type":"turn.completed","usage":{"input_tokens":10}}`,
    ].join("\n");
    const events = CodexClient.parse(output);
    expect(events.reply).toBe("Gentile [FULLNAME_1],");
    expect(events.error).toBeNull();
  });

  test("codexErrorsAreRecognized", () => {
    const failed = `{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized"}}`;
    const events = CodexClient.parse(failed + "\nnon json\n");
    expect(events.reply).toBeNull();
    expect(CodexClient.classify(events.error ?? "", 1).equals(CodexError.notLoggedIn)).toBe(true);
    expect(CodexClient.classify("", 2).equals(CodexError.failed("Codex si è fermato (codice 2)."))).toBe(true);
    expect(CodexClient.classify("", 0).equals(CodexError.emptyReply)).toBe(true);
  });

  /// Senza rete Codex aspetta all'infinito: appena lo dice, si ferma e la chat spiega perché.
  test("codexIsStoppedWhenOffline", async () => {
    const script = fakeCodex([
      `console.log('{"type":"error","message":"Reconnecting... 5/5 (stream disconnected before completion)"}');`,
      `console.log('{"type":"error","message":"Reconnecting... waiting for network (Connection failed: error sending request)"}');`,
      `setTimeout(() => {}, 30000);`,
    ].join("\n"));
    const start = Date.now();
    const output = await CodexClient.run(script, [], { stopOn: CodexClient.offlineSignal });
    expect(output.stopped).toBe(true);
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(CodexError.offline.message).toContain("Nessuna connessione");
  });

  test("loginPageIsFoundInCodexOutput", () => {
    const output = "Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\nhttps://auth.openai.com/oauth/authorize?response_type=code&client_id=abc&state=xyz\n";
    // Il server locale (http) non conta: serve la pagina di accesso di OpenAI.
    expect(CodexClient.loginURL(output)).toBe("https://auth.openai.com/oauth/authorize?response_type=code&client_id=abc&state=xyz");
    expect(CodexClient.loginURL("Successfully logged in")).toBeNull();
  });

  /// Si scelgono solo terra, luna e sol dalla versione 6; i livelli di ragionamento sono quelli del modello.
  test("onlyAllowedModelsAreOffered", () => {
    const catalog = `{"models":[
      {"slug":"gpt-6-astra","display_name":"GPT-6-Astra","visibility":"list","priority":2,"supported_reasoning_levels":[{"effort":"low"}]},
      {"slug":"gpt-6-sol","display_name":"GPT-6-Sol","description":"Il più capace","visibility":"list","priority":3,
       "default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"low"},{"effort":"medium"},{"effort":"ultra"}]},
      {"slug":"gpt-6-luna","display_name":"GPT-6-Luna","visibility":"list","priority":4,"supported_reasoning_levels":[{"effort":"low"}]},
      {"slug":"gpt-7-terra","display_name":"GPT-7-Terra","visibility":"list","priority":9},
      {"slug":"gpt-6.1-terra","visibility":"hide","priority":1},
      {"slug":"gpt-5.6-sol","display_name":"GPT-5.6-Sol","visibility":"list","priority":5},
      {"slug":"gpt-5.6-terra","display_name":"GPT-5.6-Terra","visibility":"list","priority":8},
      {"slug":"codex-auto-review","visibility":"hide","priority":43}
    ]}`;
    const models = CodexClient.parseModels(catalog);
    expect(models.map((m) => m.slug)).toEqual(["gpt-7-terra", "gpt-6-sol", "gpt-6-luna"]);
    const sol = models[1];
    expect(sol.name === "GPT-6-Sol" && sol.summary === "Il più capace").toBe(true);
    expect(sol.efforts).toEqual(["low", "medium", "ultra"]);
    expect(sol.defaultEffort).toBe("medium");
    expect(CodexClient.effortTitle("xhigh")).toBe("Molto accurato");
    expect(CodexClient.parseModels("non json")).toEqual([]);
    // Un livello strano non arriva mai nella riga di comando.
    expect(new CodexClient(null, `high"; rm`).arguments().some((a) => a.includes("rm"))).toBe(false);
  });

  test("codexRunsIsolated", () => {
    const args = new CodexClient(" ", "high").arguments();
    expect(args.slice(0, 6)).toEqual(["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-s", "read-only"]);
    expect(args.includes("shell_tool") && args.includes(`web_search="disabled"`)).toBe(true);
    expect(args).toContain(`model_reasoning_effort="high"`);
    expect(args).not.toContain("-m");
    expect(args[args.length - 1]).toBe("-");
  });

  /// Domanda e allegati partono anonimizzati; la stessa email scritta in maiuscolo ha lo stesso segnaposto.
  test("onlyPlaceholdersLeaveTheMac", async () => {
    const { anonymizer, cleanup } = FormatTest.anonymizer();
    try {
      const csv = new TextEncoder().encode("Ruolo;Email;IBAN\nCliente;mario.rossi@example.com;IT60X0542811101000000123456\n");
      const message = await chatMessage(anonymizer, "Scrivi a MARIO.ROSSI@EXAMPLE.COM per l'IBAN IT60 X054 2811 1010 0000 0123 456", {
        inputs: [ChatInput.file("clienti mario.rossi@example.com.csv", csv, "csv", "csv"), ChatInput.text("Scheda", "Email: mario.rossi@example.com")],
      });
      const transcript = ChatShield.transcript([], message);
      expect(transcript.toLowerCase()).not.toContain("mario.rossi");
      expect(transcript).not.toContain("IT60");
      expect(transcript.includes("[EMAIL_1]") && !transcript.includes("[EMAIL_2]")).toBe(true);
      expect(message.attachments.length).toBe(2);
      expect(message.attachments[0].sentName).toBe("clienti [EMAIL_1].csv");
      expect(message.text.startsWith("Scrivi a MARIO.ROSSI")).toBe(true);
      expect(message.summary).not.toBe("");

      // La risposta torna con i dati veri (nella prima grafia del dizionario).
      const vault = await anonymizer.store.snapshot();
      const reply = ChatShield.reveal("Ho scritto a [EMAIL_1]. Per [FULLNAME_9] non so.", vault);
      expect(reply.text.toLowerCase()).toContain("mario.rossi@example.com");
      expect(reply.unknown).toEqual(["[FULLNAME_9]"]);
      expect(reply.sent).toContain("[EMAIL_1]");
    } finally {
      cleanup();
    }
  });

  test("historyIsSentAnonymized", () => {
    const question = ChatMessage.create("user", "Ciao Mario Rossi", "Ciao [FULLNAME_1]");
    const answer = ChatMessage.create("assistant", "Ciao Mario Rossi!", "Ciao [FULLNAME_1]!");
    const next = ChatMessage.create("user", "E poi?", "E poi?", {
      attachments: [ChatAttachment.create("Mario.txt", "[FULLNAME_1].txt", "x", "")],
    });
    const transcript = ChatShield.transcript([question, answer], next);
    expect(transcript).not.toContain("Mario");
    expect(transcript).toContain("Utente: Ciao [FULLNAME_1]\n\nAssistente: Ciao [FULLNAME_1]!");
    expect(transcript).toContain("Allegato «[FULLNAME_1].txt»:\n<<<\nx\n>>>");
    expect(transcript.endsWith("senza usare strumenti né modificare file.")).toBe(true);
  });

  test("partialPlaceholdersAreHidden", () => {
    const vault = new Vault();
    vault.placeholder("FULLNAME", "Mario Rossi");
    expect(ChatShield.revealPartial("Gentile [FULLNAME_1], la [EMA", vault)).toBe("Gentile Mario Rossi, la ");
  });

  test("noDoubleDotAfterLegalForms", () => {
    const vault = new Vault();
    vault.placeholder("ORG", "Edilnord S.r.l.");
    expect(ChatShield.reveal("Intestato a [ORG_1]. Poi [ORG_1], fine.", vault).text).toBe("Intestato a Edilnord S.r.l. Poi Edilnord S.r.l., fine.");
  });

  test("conversationsAreStoredEncrypted", async () => {
    const directory = temporaryDirectory("anonimizzatore-chat");
    const folder = new SecureFolder(directory, fileKeyProtection);
    const client = randomUUID().toUpperCase();
    const conversation = ChatConversation.create({ clientID: client });
    conversation.messages = [ChatMessage.create("user", "Contratto di Mario Rossi", "Contratto di [FULLNAME_1]")];
    await new ChatStore(folder).save(conversation);

    const raw = readFileSync(join(directory, "chat.sigillato"));
    expect(raw.toString("utf8")).not.toContain("Mario");
    const store = new ChatStore(new SecureFolder(directory, fileKeyProtection));
    const reopened = await store.open();
    expect(reopened).toEqual([conversation]);
    expect(ChatConversation.displayTitle(reopened[0])).toBe("Contratto di Mario Rossi");
    expect((await store.unlink(client))[0].clientID).toBeNull();
    expect(await store.delete(conversation.id)).toEqual([]);
  });

  // In più rispetto a Swift: una richiesta intera con un Codex finto. La conversazione arriva da stdin (mai nella riga
  // di comando), gli argomenti arrivano intatti, la risposta è l'ultimo `agent_message`.
  test("sendUsesStdinAndReadsTheReply", async () => {
    CodexClient.executableOverride = fakeCodex([
      `let input = "";`,
      `process.stdin.on("data", (d) => (input += d));`,
      `process.stdin.on("end", () => {`,
      `  const args = process.argv.slice(2);`,
      `  const text = JSON.stringify({ args, input, cwdEmpty: require("fs").readdirSync(process.cwd()).length === 0 });`,
      `  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }));`,
      `});`,
    ].join("\n"));
    const transcript = `Richiesta: «Ciao [FULLNAME_1]» & 100% "virgolette" | ^ <>\nseconda riga`;
    const reply = JSON.parse(await new CodexClient("gpt-6-sol", "high").send(transcript)) as { args: string[]; input: string; cwdEmpty: boolean };
    expect(reply.input).toBe(transcript);
    expect(reply.args).toEqual(new CodexClient("gpt-6-sol", "high").arguments());
    expect(reply.cwdEmpty).toBe(true);
  });

  test("errorsAndCancellation", async () => {
    // Un Codex che non risponde: si ferma con il codice e l'errore che ha scritto.
    CodexClient.executableOverride = fakeCodex(`console.error("boom"); process.exit(3);`);
    await expect(new CodexClient().send("x")).rejects.toSatisfy((e: unknown) => e instanceof CodexError && e.equals(CodexError.failed("boom")));
    // Annullare ferma il processo.
    CodexClient.executableOverride = fakeCodex(`setTimeout(() => {}, 30000);`);
    const controller = new AbortController();
    const pending = new CodexClient().send("x", controller.signal);
    setTimeout(() => controller.abort(), 200);
    await expect(pending).rejects.toBeInstanceOf(CancellationError);
    // Senza Codex.
    CodexClient.executableOverride = join(tmpdir(), `non-esiste-${randomUUID()}`);
    expect((await CodexClient.status()).kind).toBe("notInstalled");
    await expect(new CodexClient().send("x")).rejects.toBe(CodexError.notInstalled);
  });

  test("statusAndModelsFromCodex", async () => {
    CodexClient.executableOverride = fakeCodex([
      `const args = process.argv.slice(2).join(" ");`,
      `if (args === "login status") console.error("Logged in using ChatGPT");`,
      `else if (args === "debug models") console.log(JSON.stringify({ models: [{ slug: "gpt-6-sol", display_name: "GPT-6-Sol" }] }));`,
      `else process.exit(1);`,
    ].join("\n"));
    expect(await CodexClient.status()).toEqual({ kind: "ready", detail: "Logged in using ChatGPT" });
    expect((await CodexClient.models()).map((m) => m.name)).toEqual(["GPT-6-Sol"]);
  });

  // Come si avvia un `.cmd` su Windows (la prova gira ovunque: costruisce solo la riga di comando).
  test("windowsCmdQuoting", () => {
    const plain = spawnCommand("/usr/local/bin/codex", ["exec", "-"], "darwin");
    expect(plain).toEqual({ file: "/usr/local/bin/codex", args: ["exec", "-"], verbatim: false });
    const exe = spawnCommand("C:\\Programmi\\codex.exe", ["exec"], "win32");
    expect(exe.verbatim).toBe(false);
    const cmd = spawnCommand("C:\\Users\\Mario Rossi\\AppData\\Roaming\\npm\\codex.cmd", ["-c", `web_search="disabled"`, "a&b"], "win32");
    expect(cmd.verbatim).toBe(true);
    expect(cmd.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    // Spazi e caratteri speciali protetti da «^» (due volte negli argomenti, per lo shim di npm).
    expect(cmd.args[3]).toBe(
      `"C:\\Users\\Mario^ Rossi\\AppData\\Roaming\\npm\\codex.cmd ^^^"-c^^^" ^^^"web_search=\\^^^"disabled\\^^^"^^^" ^^^"a^^^&b^^^""`,
    );
    expect(() => spawnCommand("codex.cmd", ["a\nb"], "win32")).toThrow();
  });
});
