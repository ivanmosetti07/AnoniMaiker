import Foundation
import Testing
@testable import AnonymizerKit

/// La chat con GPT: cosa parte (solo segnaposto), come si leggono le risposte di Codex, come tornano i dati veri.
@Suite struct ChatTests {
    @Test func codexEventsGiveTheLastAnswer() {
        let output = """
        {"type":"thread.started","thread_id":"x"}
        {"type":"turn.started"}
        {"type":"item.completed","item":{"id":"item_0","type":"error","message":"Skill descriptions were shortened"}}
        {"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"penso"}}
        {"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Gentile [FULLNAME_1],"}}
        {"type":"turn.completed","usage":{"input_tokens":10}}
        """
        let events = CodexClient.parse(output)
        #expect(events.reply == "Gentile [FULLNAME_1],")
        #expect(events.error == nil)
    }

    @Test func codexErrorsAreRecognized() {
        let failed = #"{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized"}}"#
        let events = CodexClient.parse(failed + "\nnon json\n")
        #expect(events.reply == nil)
        #expect(CodexClient.classify(events.error ?? "", status: 1) == .notLoggedIn)
        #expect(CodexClient.classify("", status: 2) == .failed("Codex si è fermato (codice 2)."))
        #expect(CodexClient.classify("", status: 0) == .emptyReply)
    }

    /// Senza rete Codex aspetta all'infinito: appena lo dice, si ferma e la chat spiega perché.
    @Test func codexIsStoppedWhenOffline() async throws {
        let script = FileManager.default.temporaryDirectory.appending(path: "codex-offline-\(UUID().uuidString).sh")
        defer { try? FileManager.default.removeItem(at: script) }
        try """
        #!/bin/sh
        echo '{"type":"error","message":"Reconnecting... 5/5 (stream disconnected before completion)"}'
        echo '{"type":"error","message":"Reconnecting... waiting for network (Connection failed: error sending request)"}'
        sleep 30
        """.write(to: script, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)
        let start = Date.now
        let output = try await CodexClient.run(script, arguments: [], input: nil, stopOn: CodexClient.offlineSignal)
        #expect(output.stopped)
        #expect(Date.now.timeIntervalSince(start) < 10)
        #expect(CodexClient.CodexError.offline.errorDescription?.contains("Nessuna connessione") == true)
    }

    @Test func loginPageIsFoundInCodexOutput() {
        let output = "Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\nhttps://auth.openai.com/oauth/authorize?response_type=code&client_id=abc&state=xyz\n"
        // Il server locale (http) non conta: serve la pagina di accesso di OpenAI.
        #expect(CodexClient.loginURL(in: output)?.absoluteString == "https://auth.openai.com/oauth/authorize?response_type=code&client_id=abc&state=xyz")
        #expect(CodexClient.loginURL(in: "Successfully logged in") == nil)
    }

    /// Si scelgono solo terra, luna e sol dalla versione 6; i livelli di ragionamento sono quelli del modello.
    @Test func onlyAllowedModelsAreOffered() {
        let catalog = """
        {"models":[
          {"slug":"gpt-6-astra","display_name":"GPT-6-Astra","visibility":"list","priority":2,"supported_reasoning_levels":[{"effort":"low"}]},
          {"slug":"gpt-6-sol","display_name":"GPT-6-Sol","description":"Il più capace","visibility":"list","priority":3,
           "default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"low"},{"effort":"medium"},{"effort":"ultra"}]},
          {"slug":"gpt-6-luna","display_name":"GPT-6-Luna","visibility":"list","priority":4,"supported_reasoning_levels":[{"effort":"low"}]},
          {"slug":"gpt-7-terra","display_name":"GPT-7-Terra","visibility":"list","priority":9},
          {"slug":"gpt-6.1-terra","visibility":"hide","priority":1},
          {"slug":"gpt-5.6-sol","display_name":"GPT-5.6-Sol","visibility":"list","priority":5},
          {"slug":"gpt-5.6-terra","display_name":"GPT-5.6-Terra","visibility":"list","priority":8},
          {"slug":"codex-auto-review","visibility":"hide","priority":43}
        ]}
        """
        let models = CodexClient.parseModels(Data(catalog.utf8))
        #expect(models.map(\.slug) == ["gpt-7-terra", "gpt-6-sol", "gpt-6-luna"])
        let sol = models[1]
        #expect(sol.name == "GPT-6-Sol" && sol.summary == "Il più capace")
        #expect(sol.efforts == ["low", "medium", "ultra"] && sol.defaultEffort == "medium")
        #expect(CodexClient.effortTitle("xhigh") == "Molto accurato")
        #expect(CodexClient.parseModels(Data("non json".utf8)).isEmpty)
        // Un livello strano non arriva mai nella riga di comando.
        #expect(!CodexClient(effort: "high\"; rm").arguments().contains { $0.contains("rm") })
    }

    @Test func codexRunsIsolated() {
        let arguments = CodexClient(model: " ", effort: "high").arguments()
        #expect(arguments.starts(with: ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-s", "read-only"]))
        #expect(arguments.contains("shell_tool") && arguments.contains(#"web_search="disabled""#))
        #expect(arguments.contains(#"model_reasoning_effort="high""#))
        #expect(!arguments.contains("-m"))
        #expect(arguments.last == "-")
    }

    /// Domanda e allegati partono anonimizzati; la stessa email scritta in maiuscolo ha lo stesso segnaposto.
    @Test func onlyPlaceholdersLeaveTheMac() async throws {
        let (anonymizer, directory) = FormatTest.anonymizer()
        defer { try? FileManager.default.removeItem(at: directory) }
        let csv = Data("Ruolo;Email;IBAN\nCliente;mario.rossi@example.com;IT60X0542811101000000123456\n".utf8)
        let message = try await anonymizer.chatMessage(
            "Scrivi a MARIO.ROSSI@EXAMPLE.COM per l'IBAN IT60 X054 2811 1010 0000 0123 456",
            inputs: [.file(name: "clienti mario.rossi@example.com.csv", data: csv, format: .csv, fileExtension: "csv"),
                     .text(name: "Scheda", text: "Email: mario.rossi@example.com")])
        let transcript = ChatShield.transcript(history: [], next: message)
        #expect(!transcript.localizedCaseInsensitiveContains("mario.rossi"))
        #expect(!transcript.contains("IT60"))
        #expect(transcript.contains("[EMAIL_1]") && !transcript.contains("[EMAIL_2]"))
        #expect(message.attachments.count == 2)
        #expect(message.attachments[0].sentName == "clienti [EMAIL_1].csv")
        #expect(message.text.hasPrefix("Scrivi a MARIO.ROSSI"))
        #expect(!message.summary.isEmpty)

        // La risposta torna con i dati veri (nella prima grafia del dizionario).
        let vault = try await anonymizer.store.snapshot()
        let reply = ChatShield.reveal("Ho scritto a [EMAIL_1]. Per [FULLNAME_9] non so.", vault: vault)
        #expect(reply.text.localizedCaseInsensitiveContains("mario.rossi@example.com"))
        #expect(reply.unknown == ["[FULLNAME_9]"])
        #expect(reply.sent.contains("[EMAIL_1]"))
    }

    @Test func historyIsSentAnonymized() {
        let question = ChatMessage(role: .user, text: "Ciao Mario Rossi", sent: "Ciao [FULLNAME_1]")
        let answer = ChatMessage(role: .assistant, text: "Ciao Mario Rossi!", sent: "Ciao [FULLNAME_1]!")
        let next = ChatMessage(role: .user, text: "E poi?", sent: "E poi?",
                               attachments: [ChatAttachment(name: "Mario.txt", sentName: "[FULLNAME_1].txt", sentText: "x", summary: "")])
        let transcript = ChatShield.transcript(history: [question, answer], next: next)
        #expect(!transcript.contains("Mario"))
        #expect(transcript.contains("Utente: Ciao [FULLNAME_1]\n\nAssistente: Ciao [FULLNAME_1]!"))
        #expect(transcript.contains("Allegato «[FULLNAME_1].txt»:\n<<<\nx\n>>>"))
        #expect(transcript.hasSuffix("senza usare strumenti né modificare file."))
    }

    @Test func partialPlaceholdersAreHidden() {
        var vault = Vault()
        vault.placeholder(label: "FULLNAME", value: "Mario Rossi")
        #expect(ChatShield.revealPartial("Gentile [FULLNAME_1], la [EMA", vault: vault) == "Gentile Mario Rossi, la ")
    }

    @Test func noDoubleDotAfterLegalForms() {
        var vault = Vault()
        vault.placeholder(label: "ORG", value: "Edilnord S.r.l.")
        #expect(ChatShield.reveal("Intestato a [ORG_1]. Poi [ORG_1], fine.", vault: vault).text == "Intestato a Edilnord S.r.l. Poi Edilnord S.r.l., fine.")
    }

    @Test func conversationsAreStoredEncrypted() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: "anonimizzatore-chat-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let folder = SecureFolder(directory: directory, protection: .file)
        let client = UUID()
        var conversation = ChatConversation(clientID: client)
        conversation.messages = [ChatMessage(role: .user, text: "Contratto di Mario Rossi", sent: "Contratto di [FULLNAME_1]")]
        try await ChatStore(folder: folder).save(conversation)

        let raw = try Data(contentsOf: directory.appending(path: "chat.sigillato"))
        #expect(!String(decoding: raw, as: UTF8.self).contains("Mario"))
        let store = ChatStore(folder: SecureFolder(directory: directory, protection: .file))
        let reopened = try await store.open()
        #expect(reopened == [conversation])
        #expect(reopened[0].displayTitle == "Contratto di Mario Rossi")
        #expect(try await store.unlink(client: client)[0].clientID == nil)
        #expect(try await store.delete(conversation.id).isEmpty)
    }
}
