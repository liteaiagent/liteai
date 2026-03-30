# LiteAI VSCode Extension — Architecture & Implementation Plan

> **Status:** In Progress — Phase 1 ✅, Phase 2 (contexts) ✅, Phase 2 (components) pending  
> **Date:** 2026-03-30  
> **Scope:** Extract reusable UI from `@liteai/web`, bundle `liteai-core` in a VSCode extension, deliver a chat experience inside the IDE.

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Features](#2-features)
- [3. Architecture](#3-architecture)
  - [3.1 Current State](#31-current-state)
  - [3.2 Target State — Pane Architecture](#32-target-state--pane-architecture)
  - [3.3 Naming Convention](#33-naming-convention)
- [4. How It Works](#4-how-it-works)
  - [4.1 Server Lifecycle](#41-server-lifecycle)
  - [4.2 Communication Flow](#42-communication-flow)
  - [4.3 Security (CSRF Token)](#43-security-csrf-token)
  - [4.4 Deployment Topologies](#44-deployment-topologies)
- [5. Key Abstractions](#5-key-abstractions)
  - [5.1 PaneRoute](#51-paneroute)
  - [5.2 Platform](#52-platform)
  - [5.3 PaneProviders](#53-paneproviders)
  - [5.4 PostMessage Bridge](#54-postmessage-bridge)
- [6. File Structure](#6-file-structure)
  - [6.1 @liteai/ui — Shared Panes](#61-liteaiui--shared-panes)
  - [6.2 @liteai/vscode — Extension](#62-liteaivscode--extension)
- [7. What Moves, What Stays](#7-what-moves-what-stays)
- [8. Build & Packaging](#8-build--packaging)
- [9. Implementation Phases](#9-implementation-phases)
- [10. Open Questions & Decisions](#10-open-questions--decisions)

---

## 1. Overview

LiteAI currently has a fully-featured **web application** for AI-assisted coding: chat, traces, settings, model management. It also has a **VSCode extension** — but that extension only opens a terminal and runs the `liteai` CLI.

This plan upgrades the VSCode extension to deliver a **native chat panel** inside the IDE, powered by the same UI components as the web app. The core idea:

1. **Extract** reusable UI from `@liteai/web` into composable units called **Panes**
2. **Bundle** the `liteai-core` server executable inside the VSCode extension
3. **Compose** Panes in a webview sidebar, connected to the bundled server

The result: a self-contained VSCode extension that provides the full LiteAI chat experience without requiring any external setup — no CLI installation, no separate server, no browser tabs.

```
┌─────────────────────────────────────────────────────────────────┐
│                        TODAY                                     │
│                                                                  │
│  Web App (full featured) ──► liteai-core server                 │
│  VSCode Extension ──► opens terminal ──► runs `liteai` CLI      │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                        AFTER                                     │
│                                                                  │
│  Web App ──► liteai-core server                                  │
│                ▲ shared Panes (ChatPane, TracePane, ...)         │
│  VSCode Extension ──► bundled liteai-core ──► chat sidebar      │
│                                                                  │
│  Both share the same UI components from @liteai/ui/panes        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Features

### Day 1 (MVP)

| Feature | Description |
|---------|-------------|
| **Chat Sidebar** | Full chat experience in a VSCode sidebar panel — message history, streaming responses, markdown rendering |
| **Prompt Input** | Rich prompt editor with @ mentions, slash commands, file attachments |
| **Model Selector** | Choose provider + model, same selector as the web app |
| **Session Management** | Create, switch, and resume sessions |
| **Bundled Server** | `liteai-core` auto-spawned on extension activation — zero setup |
| **Remote Server Mode** | Connect to an existing LiteAI server via URL (team server, cloud) |
| **CSRF Security** | Shared secret between extension and server to prevent localhost hijacking |

### Future

| Feature | Description |
|---------|-------------|
| **Trace Pane** | OpenTelemetry-style span viewer for debugging AI calls |
| **Settings Pane** | Provider management, model config, agent settings |
| **Inline Completions** | AI-powered code suggestions (LSP-based, separate from Panes) |
| **@ File References** | Click to open referenced files in the editor |
| **Diff Preview** | Agent-applied edits shown as inline diff decorations |
| **Persistent Server** | Setting to keep `liteai-core` running after VSCode closes |

---

## 3. Architecture

### 3.1 Current State

```
@liteai/ui (design system)
  └── Primitives: Button, Icon, Dialog, Select, ScrollView
  └── Rendering: SessionTurn, MessagePart
  └── Contexts: Dialog, I18n, Marked, Data

@liteai/web (application)
  └── App Contexts: Server, SDK, Sync, Prompt, Models, Settings, ...
  └── Feature Components: PromptInput, MessageTimeline, TracePanel, ...
  └── App Shell: Router, Layout, Terminal, Settings pages

@liteai/vscode (extension)
  └── Terminal launcher (no UI)
```

**Problem:** All chat UI and state management lives in `@liteai/web`, tightly coupled to `@solidjs/router` and the web app layout. Cannot be reused.

### 3.2 Target State — Pane Architecture

```
@liteai/ui (design system + shared features)
  └── components/     ← existing primitives (unchanged)
  └── context/        ← existing base contexts (unchanged)
  └── panes/          ← NEW: composable feature units
       └── shared/    ← contexts migrated from web (Server, SDK, Sync, ...)
       └── chat/      ← ChatPane (MessageTimeline, PromptInput, ...)
       └── trace/     ← TracePane (future)
       └── settings/  ← SettingsPane (future)

@liteai/web (thin shell)
  └── App Shell only: Router, Layout, Terminal, File Tree
  └── Uses ChatPane from @liteai/ui/panes/chat
  └── Web-specific contexts: Layout, Terminal, Highlights, Comments

@liteai/vscode (full extension)
  └── bin/            ← bundled liteai-core executables
  └── Extension Host: ServerManager, PostMessage Bridge
  └── Webview: SolidJS app composing ChatPane
```

A **Pane** is a self-contained, embeddable UI feature area that:
1. Wraps its own required context providers
2. Accepts host-injected adapters via props (Platform, PaneRoute)
3. Renders a complete feature (chat, trace, settings)
4. Can be used standalone or composed into larger layouts

### 3.3 Naming Convention

| Option | Verdict | Reason |
|--------|---------|--------|
| Block | ❌ | Overloaded (CSS, Notion, Gutenberg) |
| Panel | ❌ | Conflicts with existing `TracePanel`, `SessionSidePanel` |
| View | ❌ | Overloaded (MVC, React) |
| Surface | ❌ | Conflicts with existing `DockSurface` |
| Widget | ❌ | Implies small/secondary |
| **Pane** | ✅ | Short, no conflicts, maps to VSCode's pane concept. `ChatPane`, `TracePane`, `SettingsPane` |

---

## 4. How It Works

### 4.1 Server Lifecycle

The extension **bundles a pre-compiled `liteai-core` executable** (the same binary produced by `core/script/build.ts`) and manages its lifecycle:

```
Extension activates
  → ServerManager.start()
    → Is liteai.server.url configured?
      YES → Use remote URL, skip spawning
      NO  → Detect platform (win32-x64, darwin-arm64, linux-x64, ...)
          → spawn("bin/{platform}/liteai-core", ["--port", "0", "--csrf-token", token])
          → Parse stdout for "listening on http://127.0.0.1:XXXXX"
          → Server is ready

Extension deactivates
  → ServerManager.dispose()
    → SIGTERM → child process
    → Force SIGKILL after 3s if still alive
```

The `liteai-core` binary is a standalone Bun executable (~60MB per platform) that includes:
- The Hono HTTP server with all API routes
- SQLite database (auto-created)
- All AI provider integrations
- Embedded web assets (for serving the web UI if needed)

### 4.2 Communication Flow

The webview (SolidJS) cannot directly call `localhost` in all VSCode environments (Remote SSH, Codespaces, web). The extension host acts as a proxy:

```
User types message in ChatPane (webview)
  → ChatPane calls sdk.sendMessage()
  → SDK calls fetch("/project/:id/session/:id/message")
  → fetch is the custom vscodeFetch (injected via Platform)
  → vscodeFetch sends postMessage to extension host
  → Extension host receives postMessage
  → Extension host calls real fetch("http://localhost:PORT/project/...")
  → liteai-core processes the request, calls AI provider
  → AI provider streams response
  → liteai-core sends SSE events
  → Extension host relays SSE events as postMessage to webview
  → ChatPane receives events, updates MessageTimeline in real-time
```

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                   │
│  Webview (SolidJS)          Extension Host        liteai-core     │
│  ┌──────────────┐          ┌──────────────┐     ┌─────────────┐  │
│  │              │          │              │     │             │  │
│  │  ChatPane    │ post     │  Bridge      │ HTTP│  Hono API   │  │
│  │  ┌────────┐  │ Message  │  ┌────────┐  │     │  ┌───────┐  │  │
│  │  │SDK     │──┼─────────►│  │ fetch  │──┼────►│  │Routes │  │  │
│  │  │(custom │  │          │  │ proxy  │  │     │  │       │  │  │
│  │  │ fetch) │◄─┼──────────│  │        │◄─┼─────│  │       │  │  │
│  │  └────────┘  │          │  └────────┘  │     │  └───────┘  │  │
│  │              │          │              │     │             │  │
│  │  ┌────────┐  │          │  ┌────────┐  │     │  ┌───────┐  │  │
│  │  │SSE     │◄─┼──────────│  │ SSE    │◄─┼─────│  │Events │  │  │
│  │  │listener│  │          │  │ relay  │  │     │  │stream │  │  │
│  │  └────────┘  │          │  └────────┘  │     │  └───────┘  │  │
│  └──────────────┘          └──────────────┘     └─────────────┘  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 4.3 Security (CSRF Token)

Any process on the local machine can connect to `localhost:PORT`. To prevent hijacking:

```
Extension generates:  csrfToken = crypto.randomUUID()
Extension spawns:     liteai-core --csrf-token <csrfToken>
Every HTTP request:   Authorization: Bearer <csrfToken>
Server middleware:    Rejects requests without valid token → 403
```

**Attack prevention:**
- Malicious browser tab calling `fetch("http://localhost:PORT/...")` → blocked (no token)
- Rogue npm postinstall script → blocked (no token)
- Other local processes → blocked (no token)

Only the extension host knows the token (generated at runtime, passed via CLI argument, never stored persistently).

### 4.4 Deployment Topologies

The extension supports 4 deployment modes transparently:

**Topology 1 — Local (default)**
```
Your Machine:  VSCode Extension ←→ liteai-core (auto-spawned, localhost)
```
Extension bundles and auto-launches `liteai-core`. Zero setup.

**Topology 2 — Remote Server**
```
Your Machine:  VSCode Extension ──HTTPS──→ Remote liteai-core (team/cloud server)
```
User configures `liteai.server.url` in VSCode settings. Extension doesn't spawn anything.

**Topology 3 — VSCode Remote SSH**
```
Your Laptop:  VSCode UI ──SSH tunnel──→ Remote: VS Code Server + Extension + liteai-core
```
Extension + server both run on the remote machine. Webview renders locally, postMessage goes through SSH tunnel. Binary must match remote machine's platform.

**Topology 4 — Hybrid (Remote SSH + Remote Server)**
```
Your Laptop ──SSH──→ Dev Machine (Extension) ──HTTPS──→ AI Server (liteai-core)
```
Extension runs on SSH target, connects to a separate AI server. Good for GPU-equipped servers.

The **Pane is topology-agnostic** — it only communicates via `postMessage` and doesn't know where the server is.

---

## 5. Key Abstractions

### 5.1 PaneRoute

Replaces `@solidjs/router`'s `useParams()`. Each host drives navigation differently:

```typescript
// ui/src/panes/shared/pane-route.tsx
export type PaneRoute = {
  projectID?: string
  sessionID?: string
}

export const PaneRouteContext = createContext<Accessor<PaneRoute>>()
export const usePaneRoute = () => useContext(PaneRouteContext)
```

| Host | How route is set |
|------|------------------|
| Web | Derived from URL: `useParams()` → `PaneRoute` |
| VSCode | Driven by extension host via `postMessage({ type: "route", route: {...} })` |

### 5.2 Platform

Host capability injection. Already exists, extended for Panes:

```typescript
export type Platform = {
  platform: "web" | "vscode"

  // Existing
  openLink(url: string): void
  storage?: (name?: string) => SyncStorage | AsyncStorage

  // Custom fetch for VSCode bridge
  fetch?: typeof fetch

  // Extensions for Panes
  searchFiles?: (query: string) => Promise<string[]>
  navigateSession?: (projectID: string, sessionID: string) => void
  openFile?: (path: string) => void
}
```

### 5.3 PaneProviders

Single wrapper that provides all contexts needed by any Pane.

> **Implementation note:** `LanguageProvider` accepts an optional `dictionaries` prop,
> allowing the host (web app) to inject additional i18n translations on top of the
> UI-package base translations via `mergeHostDictionaries()`. Without it, only UI-package
> strings are available (sufficient for the VSCode extension).

```typescript
// ui/src/panes/shared/pane-providers.tsx (IMPLEMENTED)
export function PaneProviders(props: ParentProps & {
  platform: Platform
  route: Accessor<PaneRoute>
  server: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  dictionaries?: Record<Locale, Record<string, unknown>>
}) {
  return (
    <PlatformProvider value={props.platform}>
      <ServerProvider defaultServer={props.server} servers={props.servers}>
        <GlobalSDKProvider>
          <LanguageProvider dictionaries={props.dictionaries}>
            <SettingsProvider>
              <PaneRouteProvider route={props.route}>
                <GlobalSyncProvider>
                  <ModelsProvider>
                    <PromptProvider>
                      <PermissionProvider>
                        <LocalProvider>{props.children}</LocalProvider>
                      </PermissionProvider>
                    </PromptProvider>
                  </ModelsProvider>
                </GlobalSyncProvider>
              </PaneRouteProvider>
            </SettingsProvider>
          </LanguageProvider>
        </GlobalSDKProvider>
      </ServerProvider>
    </PlatformProvider>
  )
}
```

### 5.4 PostMessage Bridge

Bidirectional communication between webview and extension host:

**Webview → Extension Host (requests):**
```typescript
vscodeFetch("/project/abc/session", { method: "POST", body: {...} })
  → postMessage({ type: "fetch", id: 1, url: "/project/abc/session", ... })
  → extension host does real fetch("http://localhost:PORT/project/abc/session")
  → postMessage({ type: "fetch-response", id: 1, body: {...} })
```

**Extension Host → Webview (events):**
```typescript
// Extension subscribes to SSE stream from server
// Relays each event as postMessage
postMessage({ type: "sse-event", payload: { type: "session.status", ... } })
```

**Webview → Extension Host (VSCode API calls):**
```typescript
// When ChatPane wants to open a file in the editor
postMessage({ type: "vscode-command", command: "openFile", args: { path: "src/main.ts" } })
  → extension host calls vscode.window.showTextDocument(...)
```

---

## 6. File Structure

### 6.1 @liteai/ui — Shared Panes

```
ui/src/
├── components/              ← existing primitives (unchanged)
├── context/                 ← existing base contexts (unchanged)
│
├── panes/                   ← Pane system (Phase 1 + 2 complete)
│   ├── index.ts             ← barrel exports (all contexts, hooks, types)
│   │
│   ├── shared/              ← contexts + utilities migrated from web
│   │   ├── pane-route.tsx        ✅ Phase 1 — router-agnostic route signal
│   │   ├── pane-providers.tsx    ✅ Phase 2 — all providers nested correctly
│   │   ├── platform.tsx          ✅ Phase 1 — from web/context/
│   │   ├── server.tsx            ✅ Phase 1 — from web/context/
│   │   ├── server-util.ts        ✅ Phase 1 — SDK factory for server connections
│   │   ├── server-health.ts      ✅ Phase 1 — health check utility
│   │   ├── global-sdk.tsx        ✅ Phase 1 — from web/context/
│   │   ├── sdk.tsx               ✅ Phase 1 — from web/context/ (uses usePaneRoute)
│   │   ├── persist.ts            ✅ Phase 1 — from web/utils/
│   │   ├── language.tsx          ✅ Phase 2 — injectable dictionaries for host i18n
│   │   ├── settings.tsx          ✅ Phase 2 — from web/context/
│   │   ├── global-sync.tsx       ✅ Phase 2 — from web/context/
│   │   ├── global-sync/          ✅ Phase 2 — 12 submodules migrated
│   │   │   ├── bootstrap.ts
│   │   │   ├── child-store.ts
│   │   │   ├── error-types.ts    ← InitError extracted from web/pages/error.tsx
│   │   │   ├── event-reducer.ts
│   │   │   ├── eviction.ts
│   │   │   ├── queue.ts
│   │   │   ├── session-cache.ts
│   │   │   ├── session-load.ts
│   │   │   ├── session-prefetch.ts
│   │   │   ├── session-trim.ts
│   │   │   ├── types.ts
│   │   │   └── utils.ts
│   │   ├── sync.tsx              ✅ Phase 2 — from web/context/
│   │   ├── models.tsx            ✅ Phase 2 — from web/context/
│   │   ├── prompt.tsx            ✅ Phase 2 — uses usePaneRoute, inline FileSelection
│   │   ├── permission.tsx        ✅ Phase 2 — uses usePaneRoute
│   │   ├── local.tsx             ✅ Phase 2 — uses usePaneRoute
│   │   ├── use-providers.ts      ✅ Phase 2 — from web/hooks/
│   │   ├── project-id.ts         ✅ Phase 2 — from web/utils/
│   │   ├── server-errors.ts      ✅ Phase 2 — from web/utils/
│   │   ├── model-variant.ts      ✅ Phase 2 — from web/context/
│   │   └── permission-auto-respond.ts ✅ Phase 2 — from web/context/
│   │
│   ├── chat/                ← ChatPane (Phase 2 — pending)
│   │   ├── chat-pane.tsx         ← main component
│   │   ├── message-timeline.tsx  ← from web/pages/session/
│   │   ├── prompt-input/         ← from web/components/prompt-input/
│   │   ├── model-selector.tsx    ← from web/
│   │   └── new-session-view.tsx  ← from web/
│   │
│   ├── trace/               ← TracePane (future)
│   │   └── trace-pane.tsx
│   │
│   └── settings/            ← SettingsPane (future)
│       └── settings-pane.tsx
```

### 6.2 @liteai/vscode — Extension

```
vscode/
├── src/
│   ├── extension.ts              ← entry point, activation
│   ├── server-manager.ts         ← spawn/monitor/kill liteai-core
│   ├── webview-bridge.ts         ← postMessage ↔ HTTP proxy
│   ├── chat-view-provider.ts     ← WebviewViewProvider for sidebar
│   └── webview/                  ← SolidJS webview app
│       ├── entry.tsx             ← mount point
│       ├── vscode-platform.ts    ← Platform adapter (custom fetch, etc.)
│       └── vscode.css            ← CSS bridge (VSCode vars → liteai tokens)
│
├── bin/                          ← bundled liteai-core (per-platform)
│   ├── windows-x64/liteai-core.exe
│   ├── darwin-arm64/liteai-core
│   ├── darwin-x64/liteai-core
│   ├── linux-x64/liteai-core
│   └── linux-arm64/liteai-core
│
├── webview-dist/                 ← Vite-built SolidJS output
├── dist/extension.js             ← esbuild-built extension host
├── package.json                  ← contributes: viewsContainers, views, commands
└── .vscodeignore
```

---

## 7. What Moves, What Stays

### Moves to `@liteai/ui/panes/shared/` — ✅ Complete

| File | Size | Status | Key Changes |
|------|------|--------|-------------|
| `platform.tsx` | 2KB | ✅ Phase 1 | Clean interface, no changes |
| `server.tsx` | 6KB | ✅ Phase 1 | + `server-util.ts` (1KB), `server-health.ts` (3KB) |
| `global-sdk.tsx` | 8KB | ✅ Phase 1 | Uses `createSdkForServer` from server-util |
| `sdk.tsx` | 1KB | ✅ Phase 1 | `useParams()` → `usePaneRoute()` |
| `persist.ts` | 11KB | ✅ Phase 1 | Moved from web/utils/ |
| `pane-route.tsx` | 1KB | ✅ Phase 1 | New — router-agnostic route signal |
| `pane-providers.tsx` | 2KB | ✅ Phase 2 | All 12 providers in dependency order |
| `language.tsx` | 7KB | ✅ Phase 2 | Injectable dictionaries via `mergeHostDictionaries()` |
| `settings.tsx` | 9KB | ✅ Phase 2 | Imports updated to relative paths |
| `global-sync.tsx` + subdir | 12KB + 42KB | ✅ Phase 2 | 12 submodule files + `InitError` extracted |
| `sync.tsx` | 23KB | ✅ Phase 2 | `@/utils/project-id` → `./project-id` |
| `models.tsx` | 5KB | ✅ Phase 2 | Uses local `use-providers` and `persist` |
| `prompt.tsx` | 9KB | ✅ Phase 2 | `useParams()` → `usePaneRoute()`, inline `FileSelection` |
| `permission.tsx` | 9KB | ✅ Phase 2 | `useParams()` → `usePaneRoute()` |
| `local.tsx` | 12KB | ✅ Phase 2 | `useParams()` → `usePaneRoute()`, removed test probe |
| `use-providers.ts` | 1KB | ✅ Phase 2 | Moved from web/hooks/ |
| `project-id.ts` | 1KB | ✅ Phase 2 | Moved from web/utils/ |
| `server-errors.ts` | 3KB | ✅ Phase 2 | Moved from web/utils/ |
| `model-variant.ts` | 2KB | ✅ Phase 2 | Moved from web/context/ |
| `permission-auto-respond.ts` | 2KB | ✅ Phase 2 | Moved from web/context/ |

**Total: 22 files + 12 global-sync submodules = 34 files in `panes/shared/`**

### Moves to `@liteai/ui/panes/chat/`

| Component | Size | Notes |
|-----------|------|-------|
| `MessageTimeline` | 41KB | Core chat scroll view |
| `PromptInput` (directory) | ~70KB | Editor, submit, slash commands, context items |
| `ModelSelector` | 8KB | Provider/model picker |
| `NewSessionView` | 3KB | Empty state for new sessions |

### Stays in `@liteai/web`

| Module | Reason |
|--------|--------|
| `layout.tsx` (33KB) | Multi-panel sizing, dock, file tree — web orchestration |
| `terminal.tsx` | Ghostty integration — web-only |
| `highlights.tsx` | Shiki highlighting — web-only |
| `comments.tsx` | Line comments — web-only |
| `notification.tsx` | System notifications — web-only |
| `command.tsx` | Command palette — web-specific |
| `file.tsx` context | File content cache — web-specific |
| All dialog components | App-specific (connect provider, edit project, etc.) |
| All settings pages | Web layout — move to SettingsPane later |

---

## 8. Build & Packaging

### Extension Build Pipeline

```
1. Build liteai-core executable (per platform)
   bun run --cwd packages/core build:exe

2. Build webview SolidJS app
   vite build --cwd packages/vscode (webview entry)

3. Build extension host
   esbuild src/extension.ts → dist/extension.js

4. Copy platform binary
   cp core/dist/liteai-core-{platform}/bin/liteai-core → vscode/bin/{platform}/

5. Package VSIX
   vsce package --target {platform}
```

### Platform-Specific VSIX Publishing

```bash
vsce package --target win32-x64      # includes bin/windows-x64/liteai-core.exe
vsce package --target darwin-arm64   # includes bin/darwin-arm64/liteai-core
vsce package --target darwin-x64     # includes bin/darwin-x64/liteai-core
vsce package --target linux-x64      # includes bin/linux-x64/liteai-core
vsce package --target linux-arm64    # includes bin/linux-arm64/liteai-core
```

Each VSIX is ~60MB (dominated by the Bun executable).

---

## 9. Implementation Phases

### Phase 1 — Infrastructure ✅ Complete

- [x] Create `ui/src/panes/` directory structure
- [x] Create `PaneRoute` abstraction
- [x] Move `Platform` interface to `ui/panes/shared/`
- [x] Move persist utilities to `ui/panes/shared/`
- [x] Move `server.tsx` → `ui/panes/shared/`
- [x] Move `global-sdk.tsx` → `ui/panes/shared/`
- [x] Move `sdk.tsx` → `ui/panes/shared/` (replace `useParams()` with `usePaneRoute()`)
- [x] Create `PaneProviders` wrapper
- [x] Update `@liteai/ui` package.json exports
- [x] Verify web app still works (re-export from new locations)

### Phase 2 — ChatPane Extraction (in progress)

**Context & utility migration: ✅ Complete**
- [x] Move utility: `project-id.ts` → `ui/panes/shared/`
- [x] Move utility: `server-errors.ts` → `ui/panes/shared/`
- [x] Move utility: `model-variant.ts` → `ui/panes/shared/`
- [x] Move utility: `permission-auto-respond.ts` → `ui/panes/shared/`
- [x] Move hook: `use-providers.ts` → `ui/panes/shared/`
- [x] Move context: `settings.tsx` → `ui/panes/shared/`
- [x] Move context: `language.tsx` → `ui/panes/shared/` (with injectable dictionaries)
- [x] Move context: `global-sync.tsx` + 12 submodules → `ui/panes/shared/`
- [x] Extract `InitError` type from `web/pages/error.tsx` → `ui/panes/shared/global-sync/error-types.ts`
- [x] Move context: `sync.tsx` → `ui/panes/shared/`
- [x] Move context: `models.tsx` → `ui/panes/shared/`
- [x] Move context: `prompt.tsx` → `ui/panes/shared/` (replace `useParams()` with `usePaneRoute()`)
- [x] Move context: `permission.tsx` → `ui/panes/shared/` (replace `useParams()` with `usePaneRoute()`)
- [x] Move context: `local.tsx` → `ui/panes/shared/` (replace `useParams()`, remove test probe)
- [x] Update `PaneProviders` with all new providers in correct nesting order
- [x] Update `panes/index.ts` barrel export
- [x] Create re-export stubs in web for all moved contexts/utilities
- [x] Add `@solid-primitives/i18n` dependency to `@liteai/ui`
- [x] Verify: `bun typecheck` passes (ui, web, storybook)
- [x] Verify: `bun run build` passes (web)
- [x] Verify: `bun test` passes (291/291 tests, 0 failures)

**Component extraction: pending**
- [ ] Move `PromptInput` component tree to `ui/panes/chat/`
- [ ] Move `MessageTimeline` to `ui/panes/chat/`
- [ ] Move `ModelSelector`, `NewSessionView` to `ui/panes/chat/`
- [ ] Create `ChatPane` wrapper component
- [ ] Refactor `web/src/pages/session.tsx` to use `ChatPane`
- [ ] Verify web app is fully functional with extracted Panes

### Phase 3 — VSCode Extension (Week 3-4)

- [ ] Create `ServerManager` (spawn, health check, restart, shutdown)
- [ ] Add `--csrf-token` flag to `liteai-core` server + middleware
- [ ] Create `postMessage` bridge (fetch proxy + SSE relay)
- [ ] Create `ChatViewProvider` (WebviewViewProvider for sidebar)
- [ ] Create webview SolidJS entry point with `vscodePlatform`
- [ ] Set up Vite build for webview assets
- [ ] Set up build script to copy platform binary to `vscode/bin/`
- [ ] Update `package.json` contributes (views, viewsContainers, commands)
- [ ] Add settings: `liteai.server.url`, `liteai.server.username`, `liteai.server.password`
- [ ] Add CSS bridge (VSCode CSS variables → liteai design tokens)
- [ ] Test: local topology
- [ ] Test: remote server topology
- [ ] Test: Remote SSH topology

### Phase 4 — Polish & Future Panes (Week 5+)

- [ ] Persistent server option (keep running after VSCode closes)
- [ ] TracePane extraction
- [ ] SettingsPane extraction
- [ ] @ file references → click to open in editor
- [ ] Agent edit diffs → show as inline decorations
- [ ] Storybook stories for Panes with `MockPaneProviders`

---

## 10. Open Questions & Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | **Server connection gating** — Should Panes include `ConnectionGate` (health check UI) or leave it to the host? | Leave to host. Panes assume a healthy connection. Extension shows status bar indicator. |
| 2 | **CSS isolation** — How do Panes style themselves in VSCode? | Panes use `@liteai/ui/styles` design tokens. VSCode webview includes a CSS bridge that maps `--vscode-*` variables to `--liteai-*` tokens. |
| 3 | **Storybook** — Should Panes have stories? | Yes. Create `MockPaneProviders` in storybook package that provides fake SDK/Sync data. |
| 4 | **Shared server across windows** — One server per VSCode window or shared? | Shared. One `liteai-core` process per machine. If a second window opens, detect the existing server and reuse it (store port in a lockfile). |
| 5 | **Auto-update** — When extension updates, bundled binary updates too. | Show toast: "LiteAI updated. Restart to apply." Let user restart when ready. |
| 6 | **`@liteai/ui` new dependencies** — Moving contexts adds deps. | Accept: `@solid-primitives/event-bus`, `@solid-primitives/storage`, `@solid-primitives/i18n`, `zod`. These are lightweight and already used transitively. |
| 7 | **Web app backward compatibility** — How to avoid breaking the web app during migration? | ✅ Resolved — all moved contexts have re-export stubs in web. All 291 tests pass, production build succeeds. Web imports from `@liteai/ui/panes` via the barrel export. |
| 8 | **Language i18n across hosts** — Web has additional i18n strings beyond UI package. How to share? | ✅ Resolved — `LanguageProvider` uses UI-only dictionaries by default. Host can inject additional translations via `mergeHostDictionaries()` passed as `dictionaries` prop to `PaneProviders`. |
| 9 | **`useParams()` replacement** — Router-specific hooks in contexts. | ✅ Resolved — All contexts refactored to use `usePaneRoute()`. Three contexts affected: `prompt.tsx`, `permission.tsx`, `local.tsx`. |
| 10 | **`InitError` type** — Defined in `web/pages/error.tsx`, used by `global-sync.tsx`. | ✅ Resolved — Extracted to `ui/panes/shared/global-sync/error-types.ts`. Simple `{ name: string; data: Record<string, unknown> }` type. |
| 11 | **Test-only code in shared contexts** — `local.tsx` had `modelProbe` test instrumentation. | ✅ Resolved — Removed from shared version. Web can add back via wrapper if needed. |
