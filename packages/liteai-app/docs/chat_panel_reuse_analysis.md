# Chat Panel Reuse Analysis: Web App → VSCode Extension

## Executive Summary

The chat panel in `liteai-app` is deeply integrated with web-app-specific concerns (routing, layout management, file trees, terminals). To share it with a VSCode webview, we need to extract the **core chat experience** into reusable layers. The analysis identifies **3 tiers** of work: what's already shared, what should move to `@liteai/ui`, and what stays app-specific.

---

## Current Architecture

### What's Already in `@liteai/ui` (✅ Shared)

The UI package already contains the **rendering components** for the chat:

| Component | File | Purpose |
|---|---|---|
| `SessionTurn` | [session-turn.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/components/session-turn.tsx) | Renders a single conversation turn |
| `SessionReview` | [session-review.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/components/session-review.tsx) | Code review panel |
| `MessagePart` | [message-part.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/components/message-part.tsx) | Message content rendering (markdown, code, tools) |
| `MessageNav` | [message-nav.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/components/message-nav.tsx) | Message navigation |
| `ScrollView` | [scroll-view.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/components/scroll-view.tsx) | Scrollable container |
| `DockSurface` | [dock-surface.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/components/dock-surface.tsx) | Dock/prompt tray |
| Primitives | `Button`, `Icon`, `Dialog`, `Select`, etc. | General UI primitives |
| Contexts | `createSimpleContext`, `DialogProvider`, `I18nProvider` | Context utilities |
| Hooks | `createAutoScroll`, `useFilteredList` | Shared hooks |

### What's in `liteai-app` Only (❌ Not Shared)

The chat panel is assembled from several large files and context providers in the app:

#### Chat Panel Components (in `liteai-app`)

| Component | File | Lines | What It Does |
|---|---|---|---|
| **Session Page** | [session.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/pages/session.tsx) | 1823 | Orchestrates entire chat view: timeline, review panel, terminal, file tree, prompt dock |
| **Message Timeline** | [message-timeline.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/pages/session/message-timeline.tsx) | 1029 | Renders message list with scroll, staging, title editing, sharing, archiving |
| **Prompt Input** | [prompt-input.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/components/prompt-input.tsx) | 1569 | Rich contenteditable editor with @ mentions, slash commands, file/image attachments |
| **Prompt Submit** | [submit.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/components/prompt-input/submit.ts) | 585 | Session creation, message sending, optimistic updates |
| **Slash Popover** | [slash-popover.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/components/prompt-input/slash-popover.tsx) | ~200 | @ and / command popovers |
| **Context Items** | [context-items.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/components/prompt-input/context-items.tsx) | ~130 | Renders attached context (files, selections) |
| **Editor DOM** | [editor-dom.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/components/prompt-input/editor-dom.ts) | ~160 | ContentEditable cursor/text utilities |
| **History** | [history.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/components/prompt-input/history.ts) | ~250 | Prompt history navigation |
| **Session Header** | [session-header.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/components/session/session-header.tsx) | 490 | Titlebar with project name, app launcher, panel toggles |
| **New Session View** | [session-new-view.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/components/session/session-new-view.tsx) | 92 | Empty state before first message |
| **Model Selector** | [dialog-select-model.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/components/dialog-select-model.tsx) | ~250 | Model picker popover |

#### Context Providers (in `liteai-app`)

| Context | File | Purpose | VSCode Needs? |
|---|---|---|---|
| `SDK` | [sdk.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/sdk.tsx) | Per-project SDK client + events | **Yes** |
| `GlobalSDK` | [global-sdk.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/global-sdk.tsx) | SSE event stream, client factory | **Yes** |
| `Sync` | [sync.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/sync.tsx) | Session messages, diffs, history | **Yes** |
| `GlobalSync` | [global-sync.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/global-sync.tsx) | Sessions list, config, providers | **Yes** |
| `Prompt` | [prompt.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/prompt.tsx) | Prompt state (text, context items) | **Yes** |
| `Local` | [local.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/local.tsx) | Model/agent selection per session | **Yes** |
| `Server` | [server.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/server.tsx) | Server connection management | **Yes** |
| `Platform` | [platform.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/platform.tsx) | Platform abstraction (web/desktop) | **Yes** (VSCode variant) |
| `Language` | [language.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/language.tsx) | i18n translations | **Yes** |
| `Models` | [models.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/models.tsx) | Model registry + recent | **Yes** |
| `Settings` | [settings.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/settings.tsx) | User settings | **Yes** |
| `Permission` | [permission.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/permission.tsx) | Auto-accept permissions | **Yes** |
| `Command` | [command.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/command.tsx) | Command palette & keybinds | Partial |
| `Comments` | [comments.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/comments.tsx) | Line comments in review | No |
| `File` | [file.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/file.tsx) | File content cache + search | Partial |
| `Terminal` | [terminal.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/terminal.tsx) | Terminal sessions | No |
| `Layout` | [layout.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/layout.tsx) | Panel sizing/visibility state | No |
| `Highlights` | [highlights.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/highlights.tsx) | Syntax highlighting | No |
| `Notification` | [notification.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai-app/src/context/notification.tsx) | System notifications | No |

---

## Proposed Extraction Plan

### Layer 1: Move Core Contexts to `@liteai/ui` (or new `@liteai/chat` package)

These contexts are fundamental to the chat experience and have no web-app-specific dependencies:

```
ui/src/context/
├── index.ts            (existing)
├── data.tsx            (existing)
├── dialog.tsx          (existing)
├── file.tsx            (existing)
├── helper.tsx          (existing)
├── i18n.tsx            (existing)
├── marked.tsx          (existing)
├── worker-pool.tsx     (existing)
│
│  ── NEW ──
├── platform.tsx        ← from liteai-app (Platform abstraction interface)
├── server.tsx          ← from liteai-app (server connection management)
├── global-sdk.tsx      ← from liteai-app (SSE + client factory)
├── sdk.tsx             ← from liteai-app (per-project SDK client)
├── prompt.tsx          ← from liteai-app (prompt state management)
└── models.tsx          ← from liteai-app (model registry)
```

> [!IMPORTANT]
> `platform.tsx` defines a Platform interface. Both `liteai-app` and `liteai-vscode` would provide their own implementations. This is the primary injection point for platform differences.

**Dependencies to resolve:**
- `platform.tsx` — No internal deps, pure interface. Clean move.
- `server.tsx` — Depends on `platform.tsx` and `@/utils/persist`, `@/utils/server-health`. Need to extract `Persist` + `persisted` utilities.
- `global-sdk.tsx` — Depends on `server.tsx`, `platform.tsx`, `language.tsx`, `@/utils/server`.
- `sdk.tsx` — Depends on `global-sdk.tsx`. Minimal, clean move.
- `prompt.tsx` — Depends on `@solidjs/router` (useParams), `@/utils/persist`, `@/context/file` types. Router dependency needs abstraction.
- `models.tsx` — Depends on `global-sync.tsx`, `@/utils/persist`.

### Layer 2: Move Chat Components to `@liteai/ui`

These are the visual components of the chat panel:

```
ui/src/components/
│  ── NEW ──
├── prompt-input/
│   ├── prompt-input.tsx       ← Main prompt editor
│   ├── context-items.tsx      ← Attached file/selection pills
│   ├── slash-popover.tsx      ← @ and / command popovers
│   ├── editor-dom.ts          ← ContentEditable utilities
│   ├── history.ts             ← Prompt history navigation
│   ├── placeholder.ts         ← Placeholder text logic
│   ├── drag-overlay.tsx       ← Drag & drop overlay
│   ├── image-attachments.tsx  ← Image attachment preview
│   ├── attachments.ts         ← Attachment logic
│   ├── build-request-parts.ts ← Request building
│   ├── submit.ts              ← Submit logic (needs abstraction)
│   ├── files.ts               ← File type constants
│   └── paste.ts               ← Paste handling
│
├── chat-timeline/
│   ├── message-timeline.tsx   ← Message list with scroll management
│   ├── message-gesture.ts     ← Scroll gesture detection
│   └── message-id-from-hash.ts
│
├── model-selector.tsx         ← Model picker popover
└── new-session-view.tsx       ← Empty state view
```

### Layer 3: Move Supporting State to `@liteai/ui`

```
ui/src/context/
│  ── NEW ──
├── sync.tsx           ← Session data sync (messages, parts, diffs)
├── global-sync.tsx    ← Global data (sessions, config, providers, agents)
├── local.tsx          ← Model/agent selection per session
├── settings.tsx       ← User settings
└── permission.tsx     ← Permission auto-accept
```

### What Stays in `liteai-app` (App-Specific)

| Component | Reason |
|---|---|
| `pages/session.tsx` (the orchestrator) | Routes, layout panels, file tree, terminal, trace - all app-specific. Becomes a thin shell that composes shared components. |
| `pages/session/session-side-panel.tsx` | File tree + review side panel layout |
| `pages/session/terminal-panel.tsx` | Terminal integration |
| `pages/session/trace-panel.tsx` | Trace/debug panel |
| `pages/session/file-tabs.tsx` | File tab bar |
| `pages/session/review-tab.tsx` | Review wrapper |
| `components/session-header.tsx` | Titlebar with app launcher, panel toggles |
| `context/terminal.tsx` | Terminal sessions |
| `context/layout.tsx` | Multi-panel layout state |
| `context/highlights.tsx` | Syntax highlighting config |
| `context/notification.tsx` | System notification config |
| `context/comments.tsx` | Line comments (review-specific) |
| All settings pages | Web-app settings UI |
| All dialog components | App-specific dialogs (connect provider, etc.) |

---

## Key Abstractions Needed

### 1. Router Abstraction

Several contexts use `useParams()` from `@solidjs/router`. For VSCode, routing is different (single panel, no URL). 

**Solution:** Create a `ChatRouter` context in `@liteai/ui`:
```ts
// ui/src/context/chat-router.tsx
export type ChatRoute = {
  projectID?: string
  sessionID?: string
}

export const { use: useChatRoute, provider: ChatRouteProvider } = createSimpleContext({
  name: "ChatRoute",
  init: (props: { route: Accessor<ChatRoute> }) => props.route,
})
```

- `liteai-app` derives it from `useParams()` (URL-based routing)
- `liteai-vscode` drives it from the extension's state (command-based navigation)

### 2. Persistence Abstraction

The `Persist` utility uses `localStorage`. VSCode webviews need `vscode.getState()`/`vscode.setState()` or the extension's `globalState`.

**Solution:** The existing `Platform.storage` property already supports this — `platform.tsx` defines `storage?: (name?) => SyncStorage | AsyncStorage`. Just ensure all `persisted()` calls go through the platform's storage.

### 3. File Search Abstraction

`PromptInput` uses `useFile().searchFilesAndDirectories()` for @ mentions. In VSCode, this should use the workspace API.

**Solution:** Inject a file search function via the `Platform` interface or a dedicated `FileSearch` context:
```ts
platform.searchFiles?: (query: string) => Promise<string[]>
```

### 4. Navigation Abstraction

`submit.ts` uses `useNavigate()` to navigate after session creation. In VSCode, navigation happens through the extension host.

**Solution:** Add `navigate` to the `Platform` interface:
```ts
platform.navigateSession?: (projectID: string, sessionID: string) => void
```

---

## VSCode Extension Architecture

```
liteai-vscode/
├── src/
│   ├── extension.ts              ← Extension activation + commands
│   ├── chat-panel.ts             ← WebviewViewProvider (sidebar)
│   ├── webview/
│   │   ├── entry.tsx             ← SolidJS app entry for webview
│   │   ├── vscode-platform.ts    ← Platform implementation for VSCode
│   │   └── vscode-bridge.ts      ← postMessage bridge to extension host
│   └── server.ts                 ← LiteAI server connection management
├── webview-dist/                  ← Built webview assets
└── package.json
```

The webview would compose the shared components like this:

```tsx
// liteai-vscode/src/webview/entry.tsx
import { AppBaseProviders } from "@liteai/ui/app"  // after extraction
import { ChatTimeline } from "@liteai/ui/chat-timeline"
import { PromptInput } from "@liteai/ui/prompt-input"

function VSCodeChatPanel() {
  return (
    <ChatRouteProvider route={route}>
      <ServerProvider ...>
        <GlobalSDKProvider>
          <GlobalSyncProvider>
            <SDKProvider ...>
              <SyncProvider>
                <PromptProvider>
                  <LocalProvider>
                    <div class="chat-panel">
                      <ChatTimeline ... />
                      <PromptInput ... />
                    </div>
                  </LocalProvider>
                </PromptProvider>
              </SyncProvider>
            </SDKProvider>
          </GlobalSyncProvider>
        </GlobalSDKProvider>
      </ServerProvider>
    </ChatRouteProvider>
  )
}
```

---

## Dependency Graph

```mermaid
graph TD
    subgraph "Already in @liteai/ui"
        UI[UI Primitives<br/>Button, Icon, Dialog, etc.]
        ST[SessionTurn]
        MP[MessagePart]
        SV[ScrollView]
        DS[DockSurface]
    end

    subgraph "Move to @liteai/ui (Layer 1: Contexts)"
        Platform[Platform Context]
        Server[Server Context]
        GSDK[Global SDK Context]
        SDK[SDK Context]
        GSync[Global Sync Context]
        Sync[Sync Context]
        Prompt[Prompt Context]
        Models[Models Context]
        Local[Local Context]
        Settings[Settings Context]
        Perm[Permission Context]
    end

    subgraph "Move to @liteai/ui (Layer 2: Components)"
        PI[Prompt Input]
        MT[Message Timeline]
        MS[Model Selector]
        NSV[New Session View]
    end

    subgraph "Stays in liteai-app"
        SP[Session Page Orchestrator]
        SH[Session Header]
        TP[Terminal Panel]
        FT[File Tabs/Tree]
        TR[Trace Panel]
        RP[Review Panel]
        Layout[Layout Context]
        Terminal[Terminal Context]
    end

    subgraph "New: liteai-vscode"
        VE[Extension Host]
        VP[VSCode Chat Panel]
    end

    Platform --> Server
    Server --> GSDK
    GSDK --> SDK
    GSDK --> GSync
    SDK --> Sync
    GSync --> Sync
    Sync --> Local
    Models --> Local

    PI --> Prompt
    PI --> Local
    PI --> Sync
    PI --> SDK

    MT --> Sync
    MT --> SDK
    MT --> ST
    MT --> MP
    MT --> SV

    SP --> PI
    SP --> MT
    SP --> TP
    SP --> FT
    SP --> TR
    SP --> RP
    SP --> Layout
    SP --> Terminal

    VP --> PI
    VP --> MT
    VP --> MS
    VP --> NSV
