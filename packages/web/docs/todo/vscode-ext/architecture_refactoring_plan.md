# LiteAI Architecture Refactoring Plan

## Background & Motivation

LiteAI is currently a standalone web application where `packages/core` manages its own filesystem, project registry (SQLite), and git status. `packages/ui/src/panes/` contains shared UI components that are tightly coupled to HTTP/SSE-backed SolidJS contexts (`useGlobalSync()`, `useSDK()`, `useSync()`). This works for the web app but creates two classes of problems for the VSCode extension:

1. **UI Coupling:** Shared chat components pull in the entire `global-sync` state engine (multi-directory LRU, session caching, SSE event reducers, 30-dir eviction) — infrastructure the VSCode webview doesn't need. When the server is unavailable, the UI crashes.

2. **State Desync:** In VSCode, the IDE owns the filesystem (including unsaved buffers, remote workspaces via WSL/SSH/DevContainers), workspace folders, SCM, and terminals. Core bypasses all of this, reading stale files from disk and requiring manual project registration.

This plan addresses both problems across **three independent phases**. Each phase is self-contained and delivers value on its own. They can be executed in any order, though the numbered sequence is recommended.

---

## Phase 1: Dumb UI — Controller Pattern

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

### Task 1.1: Define Controller Interfaces

Create `packages/ui/src/panes/controllers/` with abstract interfaces that describe what the chat UI needs, without specifying how data is fetched.

**Files to create:**

```
packages/ui/src/panes/controllers/
├── index.ts              ← re-exports all controllers
├── chat-controller.ts    ← session data, messages, parts, status
├── session-controller.ts ← CRUD: rename, archive, delete, share, fork, revert
├── model-controller.ts   ← available models, recent, visibility, selection
└── prompt-controller.ts  ← prompt state, context items, set/reset
```

**`ChatController` interface (core data accessors):**
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
}
```

**`SessionController` interface (CRUD actions):**
```ts
interface SessionController {
  rename(sessionID: string, title: string): Promise<void>
  archive(sessionID: string): Promise<void>
  delete(sessionID: string): Promise<boolean>
  share(sessionID: string): Promise<void>
  unshare(sessionID: string): Promise<void>
  fork(input: { sessionID: string; messageID: string }): void
  revert(input: { sessionID: string; messageID: string }): void
}
```

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

### Task 1.2: Refactor Chat Components to Use Controllers

Update each component in `packages/ui/src/panes/chat/` to receive data via controller props or a lightweight `ChatContext` provider, removing all `useSync()`, `useSDK()` calls from their bodies.

**Components to refactor (in dependency order):**

1. **`ChatPane`** — Replace `useSync()` reads with `controller.messages()`, `controller.session.get()`, etc. Already receives `handler` via props.

2. **`MessageTimeline`** — Replace `sync.data.message[id]`, `sync.data.part[messageID]`, `sync.data.session_status[id]`, `sync.data.agent` reads with controller accessors passed as props.

3. **`SessionTitleBar`** — **Heaviest refactoring.** Replace all `sdk.client.project.session.*` CRUD calls with `sessionController.rename()`, `.archive()`, `.delete()`, `.share()`, `.unshare()`. Replace `sync.session.get()` and `sync.set(produce(...))` reads/writes with controller accessors.

4. **`ChatPromptInput`** — Replace `useModels()` with `modelController` prop or context. Replace `useSync()` reads for provider data. Keep `handler` (submit/abort) as-is — it's already prop-driven.

5. **`ChatNewSession`** — Replace `useSync()` reads for sessions list, `useSDK()` for directory.

6. **`ChatModelSelector`** — Audit and convert to use `modelController`.

### Task 1.3: Move global-sync and Dependent Providers to `packages/web`

The following files should be moved from `packages/ui/src/panes/shared/` to `packages/web/src/context/` (which already has copies of some of these):

**Files to move:**
- `global-sync.tsx` → `packages/web/src/context/global-sync.tsx`
- `global-sync/` (entire directory) → `packages/web/src/context/global-sync/`
- `sync.tsx` → `packages/web/src/context/sync.tsx`
- `sdk.tsx` → `packages/web/src/context/sdk.tsx`
- `global-sdk.tsx` → `packages/web/src/context/global-sdk.tsx`
- `permission.tsx` → `packages/web/src/context/permission.tsx`
- `server.tsx` → `packages/web/src/context/server.tsx`

**Files that stay in `packages/ui/src/panes/shared/` (platform-agnostic):**
- `language.tsx` — i18n, no SDK dependency
- `platform.tsx` — platform abstraction (openLink, etc.)
- `settings.tsx` — local UI preferences (persisted via localStorage)
- `pane-route.tsx` — route signal, no SDK dependency
- `prompt.tsx` — prompt state management, depends only on `pane-route` + `persist`
- `persist.tsx` — localStorage persistence, no SDK dependency
- `models.tsx` — model list management (depends on `use-providers` which reads from sync — **needs re-evaluation**: may need to accept data via controller instead)

### Task 1.4: Update `PaneProviders` and Package Exports

**Split `PaneProviders` into two:**

1. `packages/ui/src/panes/shared/pane-providers.tsx` — **Slim version** with only platform-agnostic providers:
   ```
   PlatformProvider → LanguageProvider → SettingsProvider → PaneRouteProvider
     → PromptProvider → LocalProvider → {children}
   ```

2. `packages/web/src/context/web-pane-providers.tsx` — **Web version** extends the slim providers with HTTP/SSE providers:
   ```
   SlimPaneProviders → ServerProvider → GlobalSDKProvider → GlobalSyncProvider
     → SDKProvider → SyncProvider → ModelsProvider → PermissionProvider → {children}
   ```

**Update `packages/ui/src/panes/index.ts`:**
- Remove exports of `GlobalSyncProvider`, `useGlobalSync`, `SyncProvider`, `useSync`, `SDKProvider`, `useSDK`, `GlobalSDKProvider`, `ServerProvider`, etc.
- Export only: components, controller interfaces, platform-agnostic providers, types

### Task 1.5: Implement Adapter Controllers

**Web adapter** (`packages/web/src/context/web-chat-controller.ts`):
```ts
// Implements ChatController + SessionController using existing
// useGlobalSync() + useSDK() + useSync() — essentially wraps
// the current code into the new interface.
export function createWebChatController(): ChatController & SessionController {
  const sync = useSync()
  const sdk = useSDK()
  // ... delegate to existing sync/sdk calls
}
```

**VSCode adapter** (`packages/vscode/src/webview/vscode-chat-controller.ts`):
```ts
// Implements ChatController + SessionController using a simple
// flat store + direct HTTP calls (no multi-directory management).
// In the future (Phase 3), this can be replaced with postMessage-based
// communication to the Extension Host.
export function createVscodeChatController(serverUrl: string): ChatController & SessionController {
  // Simple single-directory store
  // Direct HTTP calls to liteai-core
  // No LRU, no eviction, no multi-dir management
}
```

### Acceptance Criteria
- [ ] All components in `packages/ui/src/panes/chat/` have zero imports from `@liteai/sdk/client` (except type-only imports)
- [ ] No component in `packages/ui/src/panes/chat/` calls `useSync()`, `useSDK()`, `useGlobalSync()`, or `useGlobalSDK()`
- [ ] `packages/ui` has no runtime dependency on `@liteai/sdk` (only `devDependencies` for types)
- [ ] Web app works identically to before (WebChatController delegates to existing sync/sdk)
- [ ] VSCode webview renders ChatPane using VscodeChatController
- [ ] `global-sync/` directory no longer exists in `packages/ui/`

---

## Phase 2: Hosted Mode Core (`--hosted`)

**Goal:** Enable `liteai-core` to run as a backend engine that delegates filesystem, git, and workspace resolution back to the host IDE when instructed.

**Why:** Without this, Core reads stale disk files (missing unsaved editor buffers), doesn't know about VSCode's workspace folders (causing "Project not found" errors), can't work over Remote SSH/WSL/DevContainers, and runs invisible terminals. This phase makes Core a "hosted engine" that asks the IDE for workspace state instead of reading it directly.

### Task 2.1: Define `HostCapabilities` Interface

Create `packages/core/src/capabilities/` with an interface that represents all environment interactions Core currently performs directly.

**File:** `packages/core/src/capabilities/types.ts`

```ts
interface HostCapabilities {
  // Filesystem
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  fileExists(path: string): Promise<boolean>
  listDirectory(path: string): Promise<string[]>
  stat(path: string): Promise<FileStat>

  // Git / VCS
  getGitStatus(directory: string): Promise<VcsInfo>
  getGitDiff(directory: string): Promise<string>

  // Workspace
  getWorkspaceFolders(): Promise<WorkspaceFolder[]>
  registerProject(directory: string): Promise<Project>

  // Terminal
  runCommand(input: RunCommandInput): Promise<RunCommandOutput>
}
```

### Task 2.2: Create `LocalCapabilities` Adapter

Relocate the current `node:fs`, `child_process`, `sqlite` workspace logic into a `LocalCapabilities` class that implements `HostCapabilities`. This is the default behavior — what Core does today.

**File:** `packages/core/src/capabilities/local.ts`

```ts
class LocalCapabilities implements HostCapabilities {
  async readFile(path: string) {
    return fs.readFile(path, "utf-8")  // current behavior
  }
  async getGitStatus(directory: string) {
    return execSync("git status ...", { cwd: directory })  // current behavior
  }
  // ... relocate existing fs/git/terminal code here
}
```

**This task is purely a refactor** — no behavior changes. Core works identically after this step.

### Task 2.3: Create `HostedCapabilities` Adapter

Create a second implementation that fulfills capabilities by making HTTP callbacks to an external port (the IDE's Extension Server).

**File:** `packages/core/src/capabilities/hosted.ts`

```ts
class HostedCapabilities implements HostCapabilities {
  constructor(private callbackPort: number, private csrfToken: string) {}

  async readFile(path: string) {
    const res = await fetch(`http://127.0.0.1:${this.callbackPort}/fs/readFile`, {
      method: "POST",
      headers: { "X-CSRF-Token": this.csrfToken },
      body: JSON.stringify({ path }),
    })
    return res.text()
  }

  async getWorkspaceFolders() {
    const res = await fetch(`http://127.0.0.1:${this.callbackPort}/workspace/folders`, {
      headers: { "X-CSRF-Token": this.csrfToken },
    })
    return res.json()
  }
  // ... etc
}
```

### Task 2.4: Add CLI Flags

Introduce `--hosted --callback-port <port> --csrf-token <token>` to the `liteai start` command.

When these flags are present:
- Use `HostedCapabilities` instead of `LocalCapabilities`
- Skip SQLite project registry initialization (projects come from the host)
- Core still runs its own HTTP server + SSE stream (the UI connects to this)

### Task 2.5: Wire Capabilities Into Core Services

Audit all places in `packages/core` that directly call `fs.*`, `child_process.*`, or access the project registry, and route them through the `HostCapabilities` interface.

**Key integration points:**
- File reading for `@` mentions and context gathering
- File writing for agent edits
- Git status for VCS info
- Terminal/PTY for running commands
- Project lookup/registration

### Acceptance Criteria
- [ ] `HostCapabilities` interface is defined with all necessary methods
- [ ] `LocalCapabilities` passes all existing tests (identical behavior)
- [ ] `HostedCapabilities` makes HTTP callbacks to the callback port
- [ ] `--hosted` flag works: Core can start without direct filesystem access
- [ ] All `fs.*` and `child_process.*` calls in Core go through capabilities
- [ ] Core's HTTP server + SSE stream still works in hosted mode (unchanged)

---

## Phase 3: VSCode Extension Server (IPC Callback)

**Goal:** Implement the Extension Server pattern — the VSCode Extension Host acts as the native backbone, fulfilling Core's `HostCapabilities` requests using VSCode APIs.

**Why:** This is what makes the extension "real" vs. a webview demo. With this, the AI agent sees unsaved editor buffers, works over Remote SSH/WSL, uses VSCode's terminal panel, and never hits "Project not found" errors.

### Task 3.1: Update Server Manager Spawn Logic

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

### Task 3.2: Implement Extension Callback Server

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

### Task 3.3: Implement File Operations

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

### Task 3.4: Implement Workspace Registration

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

### Task 3.5: Implement Terminal Integration

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

### Task 3.6: Implement Git/SCM Integration

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
- [ ] Extension spawns Core with `--hosted --callback-port --csrf-token` flags
- [ ] Extension Server validates CSRF token on all incoming requests
- [ ] `/fs/readFile` returns unsaved editor buffer content when available
- [ ] `/workspace/folders` returns active workspace folders
- [ ] Workspace folder changes are synced to Core in real-time
- [ ] "Project not found in registry" error no longer occurs
- [ ] Terminal commands appear in VSCode's terminal pane
- [ ] Git status comes from VSCode's SCM API
- [ ] Extension works over Remote SSH/WSL/DevContainers

---

## Phase Summary

| Phase | Scope | Independence | Deliverable |
|-------|-------|:------------:|-------------|
| **Phase 1** | `packages/ui`, `packages/web`, `packages/vscode/webview` | ✅ Fully independent | Portable UI components, `global-sync` moved to web |
| **Phase 2** | `packages/core` | ✅ Fully independent | Core runs as hosted engine with callback support |
| **Phase 3** | `packages/vscode` (extension host) | Requires Phase 2 | VSCode Extension Server fulfilling Core's capability requests |

### Execution Order Options

- **Recommended:** Phase 1 → Phase 2 → Phase 3 (each builds on the previous)
- **Parallel track A:** Phase 1 (UI team) + Phase 2 (Core team) in parallel, then Phase 3
- **Quick wins first:** Phase 1 alone gives a working VSCode extension with direct HTTP connection (no hosted mode). Phase 2+3 upgrade it to native-quality later.

### Benefits After All Phases

- **Testability:** UI components are fully testable without HTTP backends
- **Portability:** Same components work in web, VSCode, and future Tauri/Electron builds
- **Native Context:** AI agent sees unsaved file changes, remote filesystems, VSCode terminals
- **Future Proof:** Core enforces strict interface boundaries, enabling Rust/Go rewrite
- **Security:** CSRF tokens protect bidirectional IPC on localhost
