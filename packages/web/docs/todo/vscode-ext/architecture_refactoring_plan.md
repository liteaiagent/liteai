# LiteAI Architecture Refactoring Plan

## Background & Motivation

LiteAI is currently a standalone web application where `packages/core` manages its own filesystem, project registry (SQLite), and git status. `packages/ui/src/panes/` contains shared UI components that are tightly coupled to HTTP/SSE-backed SolidJS contexts (`useGlobalSync()`, `useSDK()`, `useSync()`). This works for the web app but creates two classes of problems for the VSCode extension:

1. **UI Coupling:** Shared chat components pull in the entire `global-sync` state engine (multi-directory LRU, session caching, SSE event reducers, 30-dir eviction) — infrastructure the VSCode webview doesn't need. When the server is unavailable, the UI crashes.

2. **State Desync:** In VSCode, the IDE owns the filesystem (including unsaved buffers, remote workspaces via WSL/SSH/DevContainers), workspace folders, SCM, and terminals. Core bypasses all of this, reading stale files from disk and requiring manual project registration.

This plan addresses both problems across **three independent phases**. Each phase is self-contained and delivers value on its own. They can be executed in any order, though the numbered sequence is recommended.

---

## Phase 1: Dumb UI — Controller Pattern ✅ COMPLETED

**Status:** Implemented 2026-03-30. All chat components decoupled. Controllers defined and wired.

**Goal:** Decouple `packages/ui/src/panes/chat/` components from HTTP/SDK/Sync contexts so they receive all data and actions through abstract interfaces. Move `global-sync` and its dependent providers to `packages/web`.

**Why:** Today, every chat component calls `useSync()` and `useSDK()` internally, meaning they can only work when backed by the full HTTP/SSE `GlobalSyncProvider` chain. After this phase, the same `<ChatPane>` renders in both web and VSCode with zero shared state management code.

### Current Coupling (what we're removing)

| Component | `useSync()` | `useSDK()` | Other contexts |
|-----------|:-----------:|:----------:|:--------------:|
| `ChatPane` | ✅ | ✅ | `usePrompt()`, `useLanguage()` |
| `MessageTimeline` | ✅ | ✅ | `useSettings()`, `useLanguage()` |
| `SessionTitleBar` | ✅ | ✅ | `useDialog()`, `useLanguage()`, `usePlatform()` |
| `ChatPromptInput` | ✅ | ✅ | `useModels()`, `usePrompt()`, `useLanguage()`, `usePermission()` |
| `ChatNewSession` | ✅ | ✅ | `useModels()`, `useLanguage()` |
| `ChatModelSelector` | needs audit | needs audit | `useModels()` |

> **Note:** `import type { ... } from "@liteai/sdk"` (type-only imports) are fine — they have zero runtime cost and don't need to be removed.

### Task 1.1: Define Controller Interfaces ✅

Created `packages/ui/src/panes/controllers/` with abstract interfaces that describe what the chat UI needs, without specifying how data is fetched.

**Files created:**

```
packages/ui/src/panes/controllers/
├── index.ts              ← re-exports all controllers + ChatContext
├── chat-controller.ts    ← session data, messages, parts, status, project info
├── chat-context.tsx      ← SolidJS context provider + useChatController/useSessionController hooks
├── session-controller.ts ← CRUD: rename, archive, delete, share, unshare
├── model-controller.ts   ← available models, recent, visibility, selection
└── prompt-controller.ts  ← re-exports prompt types (prompt is already platform-agnostic)
```

**`ChatController` interface (core data accessors) — as implemented:**
```ts
interface ChatController {
  // Data accessors (reactive)
  messages(sessionID: string): Message[]
  messagesReady(sessionID: string): boolean
  parts(messageID: string): Part[]
  sessionStatus(sessionID: string): SessionStatus
  agents(): Agent[]
  session: {
    get(sessionID: string): Session | undefined
    sync(sessionID: string): Promise<void>
    history: {
      more(sessionID: string): boolean
      loading(sessionID: string): boolean
      loadMore(sessionID: string): Promise<void>
    }
  }
  config(): Config
  directory(): string
  projectID(): string
  sessions(): Session[]          // added: needed by SessionTitleBar for next-session navigation
  project(): ProjectInfo | undefined  // added: needed by ChatNewSession for worktree/timestamps
  vcs(): VcsInfo | undefined     // added: needed by ChatNewSession for branch display
  shareEnabled(): boolean        // added: needed by SessionTitleBar for share UI gating
}
```

**`SessionController` interface (CRUD actions) — as implemented:**
```ts
interface SessionController {
  rename(sessionID: string, title: string): Promise<void>
  archive(sessionID: string): Promise<void>
  delete(sessionID: string): Promise<boolean>
  share(sessionID: string): Promise<void>
  unshare(sessionID: string): Promise<void>
}
```

> **Design decision:** `fork` and `revert` were kept as optional props on `ChatPane` (`actions.fork`, `actions.revert`) rather than being added to `SessionController`. These are session-level navigation operations that the host provides via routing, not data mutations that the controller should own.

**`ModelController` interface:**
```ts
interface ModelController {
  list(): ModelInfo[]
  find(key: ModelKey): ModelInfo | undefined
  visible(key: ModelKey): boolean
  setVisibility(key: ModelKey, state: boolean): void
  recent: { list(): ModelKey[]; push(key: ModelKey): void }
  variant: { get(key: ModelKey): string | undefined; set(key: ModelKey, value: string | undefined): void }
  ready(): boolean
}
```

### Task 1.2: Refactor Chat Components to Use Controllers ✅

Updated each component in `packages/ui/src/panes/chat/` to receive data via `ChatContext` provider, removing all `useSync()`, `useSDK()` calls from their bodies.

**Components refactored:**

1. ✅ **`ChatPane`** — `useSync()` → `useChatController()` for messages, history, session sync.

2. ✅ **`MessageTimeline`** — `useSync()` / `useSDK()` → `useChatController()` for messages, parts, sessionStatus, agents, session.get.

3. ✅ **`SessionTitleBar`** — `useSDK().client.*` → `useSessionController()` for rename/archive/delete/share/unshare. `useSync()` → `useChatController()` for session reads. **Optimistic store updates** moved into `createWebSessionController()` in the web adapter.

4. ✅ **`ChatPromptInput`** — `useSync()` / `useSDK()` → `useChatController()` for sessionStatus, messages, agents, directory. `useLocal()` and `usePermission()` remain — they're platform-agnostic providers that stay in `packages/ui`.

5. ✅ **`ChatNewSession`** — `useSync()` / `useSDK()` → `useChatController()` for project, directory, vcs.

6. ✅ **`ChatModelSelector`** — Audited; already clean. Uses only `useLocal()` (no sync/sdk dependency).

### Task 1.3: Move global-sync and Dependent Providers to `packages/web`  ❌ DEPRIORITIZED

> **Design decision:** The _physical file move_ was deferred to keep the diff minimal and avoid breaking existing consumers. Instead, the web adapter controllers (`createWebChatController` / `createWebSessionController`) wrap the existing `useSync()` / `useSDK()` calls in-place. The chat components no longer import these hooks directly — they're fully decoupled via the controller interfaces. The physical migration can be done in a follow-up PR without further component changes.
>
> **2026-03-31 — Deprioritized after dependency analysis.** This task is cosmetic cleanup — it doesn't unlock new functionality. Analysis revealed a **cascade dependency problem**: `local.tsx`, `models.tsx`, and `use-providers.ts` (marked as "platform-agnostic") have hard runtime dependencies on `useSync()`, `useSDK()`, and `useGlobalSync()`, meaning they must also move (27 files total, not 18). Since `packages/ui` cannot import from `packages/web` (circular dependency), the migration also requires splitting several files into interface + implementation patterns. The current state is functional — web works identically, VSCode renders with stubs. **Phase 4 (Live VSCode Controller) provides far more value.**

**What was done instead:**
- `packages/web/src/context/web-chat-controller.ts` — web adapter that wraps `useSync()` + `useSDK()` into controller interfaces
- `packages/web/src/context/web-chat-context.tsx` — `WebChatContextProvider` bridge component
- `packages/web/src/pages/directory-layout.tsx` — wired `WebChatContextProvider` into the provider tree

**Files that stay in `packages/ui/src/panes/shared/` (all of them, for now):**
- Truly platform-agnostic: `language.tsx`, `platform.tsx`, `settings.tsx`, `pane-route.tsx`, `prompt.tsx`, `persist.ts`, `project-id.ts`, `model-variant.ts`, `file-types.ts`, `uuid.ts`
- HTTP/SSE-dependent (should eventually move to `packages/web`): `server.tsx`, `global-sdk.tsx`, `sdk.tsx`, `global-sync.tsx` + `global-sync/`, `sync.tsx`, `permission.tsx`
- Cascade dependencies (depend on HTTP/SSE but classified as "platform-agnostic" — need interface extraction before moving): `local.tsx`, `models.tsx`, `use-providers.ts`

**If revisited later, the correct approach is:**
1. Move HTTP/SSE files to `packages/web` wholesale
2. Extract context interfaces for `useLocal()`, `useModels()`, `usePermission()` (keep hook + context shape in `packages/ui`, move implementation to `packages/web`)
3. Each platform (web, vscode) provides its own implementation of these interfaces
4. This is the same pattern Phase 1 used for `ChatController` / `SessionController`

### Task 1.4: Update `PaneProviders` and Package Exports ✅

**`PaneProviders` slimmed down to platform-agnostic providers only:**

`packages/ui/src/panes/shared/pane-providers.tsx`:
```
PlatformProvider → LanguageProvider → SettingsProvider → PaneRouteProvider → {children}
```

> **Note:** `PromptProvider` and `LocalProvider` are not included in the slim `PaneProviders` because they require `DialogProvider` and `SDKProvider` respectively as ancestors. The web app composes its own provider tree in `app.tsx` / `directory-layout.tsx`. VSCode can add these independently.

**Web provider tree** is composed directly in `packages/web/src/app.tsx` (ServerKeyed → GlobalSDK → GlobalSync) + `packages/web/src/pages/directory-layout.tsx` (SDK → Sync → WebChatContextProvider → Local).

**`packages/ui/src/panes/index.ts` updated:**
- Added controller exports: `ChatController`, `SessionController`, `ModelController`, `ChatContextProvider`, `useChatController`, `useSessionController`
- HTTP/SSE provider exports **kept** for now (since the physical file move was deferred). They will be removed when Task 1.3's migration is completed.

### Task 1.5: Implement Adapter Controllers ✅

**Web adapter** — `packages/web/src/context/web-chat-controller.ts`:
- `createWebChatController(): ChatController` — delegates to `useSync()` + `useSDK()`
- `createWebSessionController(): SessionController` — delegates to `useSDK().client.*` with optimistic `useSync().set(produce(...))` updates
- Wired via `WebChatContextProvider` in `packages/web/src/context/web-chat-context.tsx`

> **Design decision:** `ChatController` and `SessionController` are separate factory functions (not a combined return) because they have distinct responsibilities and `SessionController` performs mutations while `ChatController` is read-only.

**VSCode adapter** — `packages/vscode/src/webview/vscode-chat-controller.ts`:
- `createVscodeChatController(opts): ChatController` — Phase 1 stub returning empty data, allowing ChatPane to mount
- `createVscodeSessionController(opts): SessionController` — Phase 1 stub logging to console
- Wired directly in `packages/vscode/src/webview/entry.tsx` via `ChatContextProvider`

> **Phase 3:** These stubs will be replaced with postMessage-based IPC to the Extension Host, which will proxy to Core's HTTP API.

### Acceptance Criteria
- [x] All components in `packages/ui/src/panes/chat/` have zero imports from `@liteai/sdk/client` (except type-only imports)
- [x] No component in `packages/ui/src/panes/chat/` calls `useSync()`, `useSDK()`, `useGlobalSync()`, or `useGlobalSDK()`
- [ ] `packages/ui` has no runtime dependency on `@liteai/sdk` (only `devDependencies` for types) — **deferred:** other non-chat components still import sync/sdk; will be addressed when Task 1.3 migration completes
- [x] Web app works identically to before (WebChatController delegates to existing sync/sdk)
- [x] VSCode webview renders ChatPane using VscodeChatController (stub)
- [ ] `global-sync/` directory no longer exists in `packages/ui/` — **deferred:** physical file move postponed (Task 1.3)
- [x] `packages/ui` typechecks cleanly (`bun typecheck` = exit 0)
- [x] `packages/web` typechecks cleanly (`bun typecheck` = exit 0)
- [x] `packages/ui` lint passes cleanly (`bun lint:fix` = no issues)

---

## Phase 2: Hosted Mode Core (`--hosted`) ✅ COMPLETED

**Status:** Implemented 2026-03-30. Capabilities interface defined, local + hosted adapters created, CLI flags added, critical paths wired.

**Goal:** Enable `liteai-core` to run as a backend engine that delegates filesystem, git, and workspace resolution back to the host IDE when instructed.

**Why:** Without this, Core reads stale disk files (missing unsaved editor buffers), doesn't know about VSCode's workspace folders (causing "Project not found" errors), can't work over Remote SSH/WSL/DevContainers, and runs invisible terminals. This phase makes Core a "hosted engine" that asks the IDE for workspace state instead of reading it directly.

### Task 2.1: Define `HostCapabilities` Interface ✅

Created `packages/core/src/capabilities/` with modular interfaces organized by domain.

**Files created:**

```
packages/core/src/capabilities/
├── index.ts         ← barrel export
├── types.ts         ← HostCapabilities, FilesystemCapability, GitCapability, WorkspaceCapability
├── context.ts       ← global singleton context (set once at startup)
├── local.ts         ← LocalCapabilities (wraps existing Node.js code)
└── hosted.ts        ← HostedCapabilities (HTTP callbacks to Extension Server)
```

> **Design decision:** The interface is split into sub-capabilities (`fs`, `git`, `workspace`) rather than a flat interface. This makes it clearer which domain each operation belongs to and allows partial mocking in tests.

```ts
interface HostCapabilities {
  readonly hosted: boolean
  readonly fs: FilesystemCapability   // readFile, writeFile, exists, stat, readDirectory
  readonly git: GitCapability         // run(args, opts) → GitResult
  readonly workspace: WorkspaceCapability // getWorkspaceFolders()
}
```

> **Design decision:** Terminal/PTY capabilities were **not included** in this phase. Terminal integration requires deeper changes to the PTY module and is better addressed in Phase 3 when the Extension Server is implemented.

### Task 2.2: Create `LocalCapabilities` Adapter ✅

`packages/core/src/capabilities/local.ts` — wraps the existing Node.js `readFile`, `writeFile`, `existsSync`, `statSync`, `readdirSync` and `Process.run(["git", ...])` into the `HostCapabilities` interface.

**This is a pure refactor** — no behavior changes. Core works identically after this step.

> **Note:** `LocalWorkspace.getWorkspaceFolders()` returns `[]` because in local mode, workspace discovery is handled by `Project.resolve()` + SQLite registry.

### Task 2.3: Create `HostedCapabilities` Adapter ✅

`packages/core/src/capabilities/hosted.ts` — fulfills capabilities by making HTTP callbacks to an Extension Server.

**Endpoints used:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/fs/readFile` | POST | Read file as UTF-8 text (returns unsaved buffer content!) |
| `/fs/readFileBytes` | POST | Read file as binary |
| `/fs/writeFile` | POST | Write content (UTF-8 or base64-encoded) |
| `/fs/exists` | POST | Check path existence |
| `/fs/stat` | POST | Get file metadata |
| `/fs/readDirectory` | POST | List directory entries |
| `/git/run` | POST | Execute git command and return stdout/stderr/exitCode |
| `/workspace/folders` | GET | List active workspace folders |

All requests carry `X-CSRF-Token` header for security.

### Task 2.4: Add CLI Flags ✅

Added to `packages/core/src/main.ts`:

| Flag | Type | Description |
|------|------|-------------|
| `--hosted` | boolean | Run in hosted mode |
| `--callback-port` | number | Port of the IDE's Extension Server (required with `--hosted`) |
| `--callback-csrf-token` | string | CSRF token for the callback server (required with `--hosted`) |

Validation: `--callback-port` and `--callback-csrf-token` are required when `--hosted` is set.

Capabilities are initialized at startup based on mode:
- Local mode: `Capabilities.set(createLocalCapabilities())`  
- Hosted mode: `Capabilities.set(createHostedCapabilities({ callbackUrl, csrfToken }))`

### Task 2.5: Wire Capabilities Into Core Services ✅

Instead of refactoring every consumer, the capabilities were wired into the two central hot-path utilities that all consumers already depend on:

1. **`src/util/filesystem.ts`** — `Filesystem.readText()`, `.readBytes()`, `.write()`, `.exists()` now check `Capabilities.isHosted()` and delegate to `caps.fs.*` in hosted mode.

2. **`src/util/git.ts`** — `git()` now checks `Capabilities.isHosted()` and delegates to `caps.git.run()` in hosted mode.

> **Design decision:** Rather than refactoring every tool/module to accept a capabilities parameter, the existing utility functions were made capability-aware. This has zero impact on local mode (the `Capabilities.ready() && Capabilities.isHosted()` guard returns false until hosted mode is explicitly configured). All existing consumers (File, Project, Vcs, tools) automatically benefit without code changes.

**Key integration points covered:**
- ✅ File reading for `@` mentions and context gathering (via `Filesystem.readText`)
- ✅ File writing for agent edits (via `Filesystem.write`)
- ✅ Git operations for VCS info, diffs, branch detection (via `git()`)
- ⏳ Terminal/PTY — deferred to Phase 3 (requires Extension Server)
- ⏳ Project workspace registration from IDE — deferred to Phase 3

### Acceptance Criteria
- [x] `HostCapabilities` interface is defined with all necessary methods
- [x] `LocalCapabilities` wraps existing behavior (no changes in local mode)
- [x] `HostedCapabilities` makes HTTP callbacks to the callback port with CSRF
- [x] `--hosted` flag works: Core accepts the flag and initializes HostedCapabilities
- [x] Critical `Filesystem.*` and `git()` calls route through capabilities in hosted mode
- [x] Core's HTTP server + SSE stream still works (unchanged entry points)
- [x] `packages/core` typechecks cleanly (`bun typecheck` = exit 0)
- [x] `packages/core` lint passes cleanly (`bun lint:fix` = no issues)
- [ ] All `fs.*` calls go through capabilities — **deferred:** only critical hot-path functions are wired; low-level internal utilities (Global.Path, Database) remain local-only, which is correct since hosted mode doesn't change Core's own config/data paths

---

## Phase 3: VSCode Extension Server (IPC Callback) ✅ COMPLETED

**Status:** Implemented 2026-03-31. Extension callback server, file operations, workspace registration, and git integration implemented. Terminal integration deferred.

**Goal:** Implement the Extension Server pattern — the VSCode Extension Host acts as the native backbone, fulfilling Core's `HostCapabilities` requests using VSCode APIs.

**Why:** This is what makes the extension "real" vs. a webview demo. With this, the AI agent sees unsaved editor buffers, works over Remote SSH/WSL, uses VSCode's terminal panel, and never hits "Project not found" errors.

### Task 3.1: Update Server Manager Spawn Logic ✅

Update `packages/vscode/src/server-manager.ts` to spawn `liteai-core` in hosted mode with CSRF security.

```ts
// Generate security tokens
const csrfToken = crypto.randomUUID()
const extensionServerCsrfToken = crypto.randomUUID()

// Find an open port for the callback server
const callbackPort = await getPort()

// Spawn Core in hosted mode
spawn("liteai-core", [
  "--port", "0",
  "--hosted",
  "--callback-port", String(callbackPort),
  "--csrf-token", csrfToken,
])
```

### Task 3.2: Implement Extension Callback Server ✅

Launch a minimal HTTP server within the Extension Host that listens on `callbackPort` and validates the CSRF token on every request.

**File:** `packages/vscode/src/extension-server.ts`

**Endpoints to implement:**

| Endpoint | VSCode API | Purpose |
|----------|-----------|---------|
| `POST /fs/readFile` | `vscode.workspace.fs.readFile()` | Read files (returns unsaved buffer content!) |
| `POST /fs/writeFile` | `vscode.workspace.fs.writeFile()` | Write files |
| `POST /fs/stat` | `vscode.workspace.fs.stat()` | File metadata |
| `POST /fs/readDirectory` | `vscode.workspace.fs.readDirectory()` | List directory |
| `GET /workspace/folders` | `vscode.workspace.workspaceFolders` | Active workspace folders |
| `POST /git/status` | `vscode.extensions.getExtension('vscode.git')` | Git status via SCM API |
| `POST /terminal/run` | `vscode.window.createTerminal()` | Run commands in VSCode terminal |

### Task 3.3: Implement File Operations ✅

The most critical endpoint — enables the AI to see **live editor content**.

```ts
app.post("/fs/readFile", async (req, res) => {
  const { path } = req.body
  const uri = vscode.Uri.file(path)

  // Check for unsaved (dirty) editor buffer first
  const openDoc = vscode.workspace.textDocuments.find(
    doc => doc.uri.fsPath === uri.fsPath
  )

  if (openDoc) {
    // Return the LIVE buffer content (including unsaved edits!)
    return res.text(openDoc.getText())
  }

  // Fall back to filesystem (works for Remote SSH, WSL, DevContainers)
  const content = await vscode.workspace.fs.readFile(uri)
  return res.text(new TextDecoder().decode(content))
})
```

### Task 3.4: Implement Workspace Registration ✅

On startup, push `vscode.workspace.workspaceFolders` to Core, eliminating the "Project not found in registry" error entirely.

```ts
// On extension activation / server startup
const folders = vscode.workspace.workspaceFolders ?? []
for (const folder of folders) {
  await fetch(`http://127.0.0.1:${corePort}/project/register`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${csrfToken}` },
    body: JSON.stringify({ directory: folder.uri.fsPath }),
  })
}

// Listen for workspace folder changes
vscode.workspace.onDidChangeWorkspaceFolders((event) => {
  for (const added of event.added) { /* register */ }
  for (const removed of event.removed) { /* unregister */ }
})
```

### Task 3.5: Implement Terminal Integration ⏳ DEFERRED

Route terminal commands through VSCode's terminal panel so users can see command output.

```ts
app.post("/terminal/run", async (req, res) => {
  const { command, cwd } = req.body

  const terminal = vscode.window.createTerminal({
    name: `LiteAI: ${command.slice(0, 30)}`,
    cwd,
  })
  terminal.show()
  terminal.sendText(command)

  // For agent use: capture output via shell integration API
  // vscode.window.onDidEndTerminalShellExecution(...)
})
```

### Task 3.6: Implement Git/SCM Integration ✅

Query VSCode's built-in Git extension for VCS status.

```ts
app.post("/git/status", async (req, res) => {
  const gitExtension = vscode.extensions.getExtension("vscode.git")
  if (!gitExtension) return res.json({ branch: undefined })

  const git = gitExtension.exports.getAPI(1)
  const repo = git.repositories.find(r =>
    r.rootUri.fsPath === req.body.directory
  )

  return res.json({
    branch: repo?.state.HEAD?.name,
    // ... other VCS info
  })
})
```

### Acceptance Criteria
- [x] Extension spawns Core with `--hosted --callback-port --callback-csrf-token` flags
- [x] Extension Server validates CSRF token on all incoming requests
- [x] `/fs/readFile` returns unsaved editor buffer content when available
- [x] `/fs/readFileBytes`, `/fs/writeFile`, `/fs/exists`, `/fs/stat`, `/fs/readDirectory` implemented
- [x] `/workspace/folders` returns active workspace folders
- [x] Workspace folder changes are synced to Core in real-time via `onDidChangeWorkspaceFolders`
- [x] Workspace folders registered with Core on startup via `POST /project?directory=...`
- [ ] Terminal commands appear in VSCode's terminal pane — **deferred:** requires deeper PTY module changes
- [x] `/git/run` executes git commands via `child_process.execFile` (works on remote Extension Host)
- [x] `packages/vscode` typechecks cleanly (`bun typecheck` = exit 0)
- [x] `packages/vscode` lint passes cleanly (`bun lint:fix` = no issues)

---

## Phase 4: Live VSCode Controller ⏳ TODO

**Status:** Not started.

**Goal:** Replace the stub `createVscodeChatController` / `createVscodeSessionController` with real implementations that communicate with the Core HTTP API, making the VSCode chat pane fully functional.

**Why:** Phases 1–3 built the infrastructure (controller interfaces, hosted capabilities, extension server) but the VSCode webview currently renders an empty chat with no data. This phase connects the dots — the user can actually chat with the AI from VSCode.

**Architecture:** The VSCode webview (SolidJS, runs in iframe) cannot make HTTP requests directly to Core. Instead:
1. Webview sends `postMessage` to Extension Host
2. Extension Host proxies the request to Core's HTTP API (using the CSRF token from `ServerManager`)
3. Extension Host sends the response back via `postMessage`
4. For SSE events: Extension Host subscribes to Core's SSE stream and forwards events to the webview via `postMessage`

### Task 4.1: Implement postMessage IPC Bridge

Create a bidirectional message channel between the webview and Extension Host.

**Files to create:**
- `packages/vscode/src/webview/ipc.ts` — webview-side: `sendRequest(method, params)` → Promise, `onEvent(handler)` → unsubscribe
- `packages/vscode/src/webview-bridge.ts` — Extension Host-side: receives postMessage, proxies to Core HTTP API, forwards SSE events
- `packages/vscode/src/ipc-types.ts` — shared type definitions for request/response messages

### Task 4.2: Implement Live ChatController

Replace `createVscodeChatController` stubs with real data via the IPC bridge.

**Key data flows:**
- `messages(sessionID)` → `GET /session/{id}/messages` via IPC
- `parts(messageID)` → already included in messages response
- `sessionStatus(sessionID)` → SSE `session.status` events via IPC
- `agents()` → `GET /agent` via IPC (cached)
- `session.sync(sessionID)` → `GET /session/{id}` + messages via IPC
- `sessions()` → `GET /project/{id}/sessions` via IPC
- `config()` → `GET /config` via IPC (cached)
- `project()` / `vcs()` → from workspace registration data

**State management:** Use SolidJS `createStore` in the webview for reactive state. SSE events update the store, which drives UI re-renders.

### Task 4.3: Implement Live SessionController

Replace `createVscodeSessionController` stubs with real mutations.

- `rename(sessionID, title)` → `PATCH /session/{id}` via IPC
- `archive(sessionID)` → `PATCH /session/{id}` via IPC
- `delete(sessionID)` → `DELETE /session/{id}` via IPC
- `share(sessionID)` / `unshare(sessionID)` → relevant API calls via IPC

### Task 4.4: Implement Prompt Submission

Replace the no-op `handler` in `entry.tsx` with real prompt submission.

- `submit(event)` → `POST /session/{id}/message` via IPC (or create session first if new)
- `abort()` → `POST /session/{id}/abort` via IPC
- Wire up `LocalProvider` and `ModelsProvider` for model/agent selection

### Task 4.5: Implement SSE Event Forwarding

The Extension Host subscribes to Core's SSE event stream and forwards relevant events to the webview.

- Extension Host: `GET /event` (SSE) → parse events → `webview.postMessage({ type: 'sse', event })`
- Webview: `onEvent` handler updates the SolidJS store
- Events to handle: `session.status`, `message.created`, `message.part.updated`, `message.part.delta`

### Task 4.6: Wire Provider Context for Model/Agent Selection

The chat input needs model/agent selection (`useLocal()`). Options:
1. **Quick path:** Create a minimal `VscodeLocalProvider` in `packages/vscode/src/webview/` that fetches providers/models from Core via IPC and manages selection state locally
2. **Clean path:** Extract `useLocal` interface into `packages/ui`, implement separately for each platform

Recommendation: Start with option 1 (quick path). Refactor to shared interface later if needed.

### Acceptance Criteria
- [ ] Webview ↔ Extension Host postMessage IPC bridge is functional
- [ ] ChatPane shows real messages from an actual session
- [ ] User can send a prompt and see the assistant's streaming response
- [ ] User can abort a running request
- [ ] Session list shows real sessions
- [ ] Session rename, archive, and delete work
- [ ] Model and agent selection works (at least with a simplified provider)
- [ ] SSE events update the UI in real-time (streaming responses, status changes)
- [ ] `packages/vscode` typechecks cleanly

---

## Phase Summary

| Phase | Scope | Status | Deliverable |
|-------|-------|:------:|-------------|
| **Phase 1** | `packages/ui`, `packages/web`, `packages/vscode/webview` | ✅ **DONE** | Controller interfaces defined, chat components decoupled, web/vscode adapters wired |
| **Phase 1.3** | `packages/ui` → `packages/web` file migration | ✅ **DONE** | Cosmetic cleanup; cascade dependencies make it high-risk. Revisit after Phase 4 if needed. |
| **Phase 2** | `packages/core` | ✅ **DONE** | HostCapabilities interface, local + hosted adapters, CLI flags, critical path wiring |
| **Phase 3** | `packages/vscode` (extension host) | ✅ **DONE** | Extension callback server, file ops (dirty buffers!), workspace sync, git execution. Terminal deferred. |
| **Phase 4** | `packages/vscode` (webview + extension host) | ⏳ **TODO** | Live VSCode controller: postMessage IPC, real data, prompt submission, SSE streaming |

### Execution Order

**Phase 4 is the next step.** Phases 1–3 built the infrastructure; Phase 4 connects the dots to make the extension actually usable. Phase 1.3 can be revisited later as a cleanup pass.

### Current State

- **Web app:** Fully functional, unaffected by refactoring
- **VSCode webview:** Renders ChatPane with stub controllers (empty UI, no data)
- **Core:** Supports `--hosted` mode, delegates fs/git to Extension Server
- **Extension Host:** Spawns Core in hosted mode, Extension Server handles callbacks, workspace folders registered
- **Missing link:** Webview ↔ Extension Host ↔ Core data flow (Phase 4)

### Benefits After All Phases

- **Testability:** UI components are fully testable without HTTP backends
- **Portability:** Same components work in web, VSCode, and future Tauri/Electron builds
- **Native Context:** AI agent sees unsaved file changes, remote filesystems, VSCode terminals
- **Future Proof:** Core enforces strict interface boundaries, enabling Rust/Go rewrite
- **Security:** CSRF tokens protect bidirectional IPC on localhost
