# Contratto fra il modello (preload) e l'interfaccia (React)

Il modello vive nel preload: `window.anonimaiker = { model, platform, pathForFile }` (tipi in `src/shared/api.ts`).
Le classi stanno in `src/preload/` (importa i tipi da `src/preload/model.ts`, solo `import type`: il renderer non ha Node).
Il renderer può importare valori solo da moduli senza Node: `src/shared/*`, `src/renderer/*`. Da `src/core` e
`src/preload` solo `import type`.

## Regole

- Ogni oggetto osservabile estende `Observable`: nei componenti `useObserved(obj)` (`src/renderer/ui/observe.ts`).
- `AppModel`, `Workspace`, `ChatState`, `UpdateState` notificano solo i propri campi: una vista che legge `model.chat.*`
  deve anche fare `useObserved(model.chat)`; lo stesso per `model.updates` e per ogni banco di lavoro.
- Ogni campo pubblico chiama `changed()` quando lo si assegna: l'interfaccia può assegnarli (`space.input = testo`,
  `model.section = "documents"`, `model.chat.draft = s`, `model.showsSettings = false`).
- Array e Set si sostituiscono, mai si modificano sul posto. Gli id sono UUID stringa; le date `Date`.
- I metodi async restituiscono Promise (si possono lanciare senza aspettare). Gli errori finiscono in `model.alert`
  (o `chat.error` / `chat.connectionError`): rimetterlo a `null` lo chiude.

## window.anonimaiker
- `model: AppModel`, `platform: PlatformAPI`, `pathForFile(file: File): string` (trascinamento → `model.open(path, space)`,
  `model.attach([path])`, `model.addDocuments([path], companyID)`).

## ContentView / Sidebar / StatusFooter / ProjectSwitcher / finestre dell'app
- `engineState`: `{kind:"loading"|"ready"|"missing"} | {kind:"failed", message}`
- `vaultState`: `{kind:"opening"} | {kind:"ready", protection: "windowsDPAPI"|"file"|"secureEnclave"} | {kind:"failed", message}`
- `isVaultReady`, `alert: string|null`, `section: AppSection`, `showsChat`
- finestre: `showsGuide`, `requestsNewProject`, `showsSettings`, `showsAbout`; `appVersion: string`
- `handleMenu(command)` è già collegato ai menu in `start()`.
- `src/shared/navigation.ts`: `AppSection` (`"anonymize"|"reveal"|"documents"|"people"|"companies"|"deals"|"activities"|"dictionary"`,
  `AppSection.allCases`, `.title(s)`, `.symbol(s)` = nome SF Symbol da tradurre in icona lucide), `CRMRoute`
  (`{kind:"company"|"document", id}`, `CRMRoute.company(id)`, `.document(id)`, `.equals`).

## GuideView
- `finishGuide(action: "backup"|"createProject"|"anonymize"|"chat"|null)`

## ProjectsView / ProjectNameSheet
- `projects: Project[]` (`{id,name,notes,created,updated}`, dal più recente), `currentProjectID`, `currentProject`, `hasProject`
- `selectProject(id|null)`, `showProjects()`, `createProject(name)`, `renameProject(id, name)`, `deleteProject(id)`

## WorkspaceView / ReportBar / TextPane
- `anonymizeSpace`, `revealSpace`: il `Workspace` del progetto aperto.
- `Workspace`: `mode`, `input`, `source: OpenedFile|null`, `clientID`, `output`, `highlights: {location,length}[]` (UTF-16 di `output`),
  `outcome: {kind:"anonymized", report} | {kind:"revealed", result} | null`, `progress: number|null`, `ranInput`, `isRunning`,
  `inputPreview`, `outputPreview` (`DocumentPreview|null`), `outputData`, `recognizedPages`, `projectNote`, `task`;
  getter `isFile`, `isStale`, `hasInput`, `hasOutput`, `isEmpty`; `clear()`.
- `OpenedFile`: `{path, format, data, text}`, getter `name`, `isFile`.
- `AppModel`: `canRun(space)`, `run(space)`, `cancel(space)`, `open(path, space)`, `chooseFile(space)`, `save(space)`,
  `copy(testoOSpazio)`, `saveToProject(space)`.

## DictionaryView
- `vault: Vault`, `dictionaryClient: string|null`; `refreshVault()`, `remove(placeholders)`, `showVaultInFinder()` (apre Esplora file).

## CRM (CompaniesView, CompanyDetailView, DocumentsView, DocumentDetailView, CRMLists, Editors, DossierSheet)
- `crm: CRMDatabase`, `companiesPath: CRMRoute[]`, `documentsPath: CRMRoute[]`, `busyDocuments: ReadonlySet<string>`, `companyChoices: Company[]`
- `saveCompany(c)`, `saveContact(c)`, `saveDeal(d)`, `saveActivity(a)` (passa copie: `{...company, name}`), `toggleDone(a)`,
  `deleteContact(id)`, `deleteDeal(id)`, `deleteActivity(id)`, `deleteCompany(id)`, `chooseDocuments(companyID|null)`,
  `addDocuments(paths, companyID|null)`, `data(version)`, `anonymizeDocument(id)`, `importAnswer(documentID)`,
  `pasteAnswer(documentID)`, `removeVersion(versionID, documentID)`, `deleteDocument(id)`, `export(version, document)`,
  `preview(version, document)` → `{preview, compared, highlights, unknown}`, `dossier(companyID)` → `{original, anonymized}`,
  `openCompany(id|null)`, `openDocument(id)`, `showDictionary(companyID)`.
- Funzioni di aiuto dei tipi CRM in `src/core/crm` (`Company.address`, `Contact.fullName`, `Deal.weightedAmount`,
  `Activity.isOverdue`, `CompanyStatus.title`…): sono valori, non solo tipi — se usano Node non si possono importare;
  in quel caso ricopia la funzione (sono poche righe) in `src/renderer/crm/helpers.ts`.
- Date e importi: `Format.date`, `dateTime`, `amount` da `src/shared/format.ts`.

## SettingsView
- `settings: AnonymizationSettings`: si salva assegnando un oggetto nuovo o con `updateSettings(s => {…})`. Mai modificarlo sul posto.
- motore: `engineState`, `engine`; chat: `chatModel`, `chatEffort`, `codexClient`, `chooseChatModel(slug)`, `chooseChatEffort(e|null)`,
  `chat.models`, `chat.modelRevision`; aggiornamenti: `updates.automatic`.

## BackupViews
- `backupStep: {kind:"export"} | {kind:"restore", path} | null`, `totals: BackupSummary|null`, `lastBackup: Date|null`
- `startExport()`, `startRestore()`, `allProjectsSummary()`, `exportBackup(password)` → `Promise<boolean>`,
  `openBackup(path, password)` → `Promise<BackupContents>` (lancia `BackupError`), `restore(contents)` → `Promise<string|null>`.

## UpdateViews (`model.updates: UpdateState`)
- `phase`: `idle|checking|upToDate` | `{available, release}` | `{downloading, release, progress}` | `{installing, release, step}` | `{failed, message, release|null}`
- `isPresented`, `automatic`, `lastCheck`, `skippedVersion`, `isBusy`
- modello: `checkForUpdates(userInitiated)`, `skip(release)`, `install(release)`, `cancelUpdate()`, `openReleasePage(release|null)`.

## ChatView / ChatGPTConnectView (`model.chat: ChatState`)
- `conversations`, `selectedID`, `draft`, `pending: {id, symbol, input, name}[]`, `codexStatus`, `models`, `modelRevision`,
  `error`, `connectionError`, `phase: {anonymizing|waiting} | {reading, titles} | null`,
  `connection: {installing} | {waitingForBrowser, url|null} | null`; getter `selected`, `isBusy`, `hasDraft`.
- modello: `refreshCodexStatus()`, `newConversation()`, `select(id|null)`, `deleteConversation(id)`, `attachFiles()`,
  `attach(paths)`, `attachDossier(companyID)`, `attachDocument(document)`, `removePending(id)`, `canSendChat`, `sendChat()`,
  `retryChat()`, `cancelChat()`, `apply(proposal, messageID)`, `discard(proposal, messageID)`, `document(proposal)`,
  `saveAsNote(message)`, `exportConversation(c)`, `connectChatGPT()`, `cancelChatGPTConnection()`, `disconnectChatGPT()`.
- `ChatConversation.displayTitle(c)`, `ChatProposal.isNewDocument(p)` da `src/core/chat` (vedi la nota sui valori qui sopra).
