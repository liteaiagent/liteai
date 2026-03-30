# Refactoring Plan — Prepare Big Files for Pane Extraction

> **Goal:** Split `session.tsx`, `prompt-input.tsx`, and `message-timeline.tsx` so that
> pane-portable code can later move to `@liteai/ui/panes/chat/` with a clean cut.
>
> **Approach:** Refactor in-place (still in `@liteai/web`), verify nothing breaks,
> *then* move the portable pieces to ui/panes in a separate step.

**Current Status:** All three refactoring phases are complete.
- `createSessionHistoryWindow` extracted from `session.tsx` (-427 lines).
- `createTimelineStaging` extracted from `message-timeline.tsx` (-95 lines).
- `MessageTimeline` parameterized to remove router dependencies (now 100% portable contexts).
- `PromptInput` abstracted: `useCommand`, `useComments`, `useFile`, `useSessionLayout` → optional props.
- **Phase C complete:** Portable pieces moved to `@liteai/ui/panes/chat/`. Web re-export stubs in place.

---

## Summary of the Problem

| File | Lines | Web-only deps | Portable? |
|------|------:|:---:|:-:|
| `session.tsx` | 1,823 | `useLayout`, `useFile`, `useTerminal`, `useComments`, `useNavigate`, `useSearchParams`, `useSessionLayout` | ❌ Mixed |
| `prompt-input.tsx` | 1,559 | `useCommand`, `useComments`, `useFile`, `useLayout`, `useSessionLayout`, `useNavigate` | ❌ Mixed |
| `message-timeline.tsx` | 1,029 | `useNavigate`, `useSessionKey` (router) | ⚠️ Mostly portable |

---

## Step 1: Refactor `session.tsx` (1,823 → ~350 shell + ~600 chat core + existing helpers)

`session.tsx` is the worst offender. It's a **single function component** of ~1,500 lines mixing:

- **Chat core logic** (history window, messages, followups, fork/revert/restore, auto-scroll) → moves to pane
- **Web shell** (layout sizing, terminal, file tree, review panel, tabs, side panel) → stays in web
- **Review system** (diff management, review panel rendering, comment integration) → stays in web

### Step 1a: Extract `createSessionHistoryWindow` → `session/history-window.ts` ✅

**What:** Lines 62–300 — a self-contained function with no JSX, no web-specific deps.

**Why:** It's already a pure function taking an input object. Zero changes needed — just move it.

```
session/history-window.ts  (~240 lines)
  export function createSessionHistoryWindow(input: SessionHistoryWindowInput) { ... }
  export type SessionHistoryWindowInput = { ... }
```

**Dependencies:** Only `solid-js` primitives (`createMemo`, `createStore`, `createEffect`). Fully portable.

### Step 1b: Extract followup management → `session/session-followup.ts` (Deferred)

**What:** Lines 1364–1467 — followup queue logic (queueFollowup, sendFollowup, editFollowup, clearFollowupEdit, followupDock, followupText, queueEnabled, etc.)

**Why:** This is pure state management with no JSX. Currently all inline inside `Page()`.

```
session/session-followup.ts  (~120 lines)
  export function createSessionFollowups(input: {
    sessionID: () => string | undefined
    sync: ReturnType<typeof useSync>
    sdk: ReturnType<typeof useSDK>
    globalSync: ReturnType<typeof useGlobalSync>
    settings: ReturnType<typeof useSettings>
    language: ReturnType<typeof useLanguage>
    composerBlocked: () => boolean
  }) { ... }
```

**Dependencies:** `useSync`, `useSDK`, `useGlobalSync`, `useSettings`, `useLanguage` — all are pane contexts (already moved). `sendFollowupDraft` from `prompt-input/submit`. Fully portable.

### Step 1c: Extract fork/revert/restore actions → `session/session-actions.ts` (Deferred)

**What:** Lines 1469–1577 — `halt`, `fork`, `revert`, `restore`, `rolled`, `busy`, `merge`, `roll`, `draft`, `line`, `fail`.

**Why:** Pure operations on sync data + SDK calls. No JSX, no layout deps.

```
session/session-actions.ts  (~130 lines)
  export function createSessionActions(input: {
    sessionID: () => string | undefined
    sync: ...
    sdk: ...
    prompt: ...
    language: ...
    globalSync: ...
  }) { ... }
```

**Dependencies:** All pane contexts. `useNavigate` is only used by `fork` for navigation — parameterize it as a callback: `onFork?: (projectID: string, sessionID: string) => void`.

### Step 1d: Extract review/diff management → `session/session-review.ts`

**What:** The review panel rendering, diff loading effects, review scroll management, comment integration (~200 lines scattered through the function).

**Why:** This is web-specific (uses `useFile`, `useComments`, `useLayout`) and stays in web. Extracting it cleans up `session.tsx` without moving anything.

```
session/session-review.ts  (~200 lines)
  export function createSessionReview(input: {
    sessionID: ...
    sync: ...
    layout: ...
    file: ...
    comments: ...
    sessionKey: ...
    ...
  }) { ... }
```

### Step 1e: What remains in `session.tsx` (~350 lines)

After extraction, `session.tsx` becomes a thin orchestration shell:

```tsx
export default function Page() {
  // 1. Hook into all contexts (web-specific + pane)
  // 2. Wire up extracted modules:
  const historyWindow = createSessionHistoryWindow({ ... })
  const followups = createSessionFollowups({ ... })
  const actions = createSessionActions({ ... })
  const review = createSessionReview({ ... })
  
  // 3. Layout + routing effects (web-specific, ~100 lines)
  // 4. JSX: shell layout with MessageTimeline + SessionComposerRegion (~120 lines)
}
```

This shell is clearly web-only (layout, router, terminal, file tree) and **stays in web**.

---

## Step 2: Refactor `message-timeline.tsx` (1,029 → ~200 header + ~700 timeline + ~130 staging)

MessageTimeline is actually **mostly portable**. The web-specific parts are small and precise.

### Step 2a: Extract `createTimelineStaging` → `session/timeline-staging.ts` ✅

**What:** Lines 100–195 — completely self-contained, no web deps.

**Size:** ~95 lines. Already a standalone function — can stay inline or move to `session/timeline-staging.ts`.

### Step 2b: Isolate web-specific dependencies ✅

The web-specific deps inside `MessageTimeline` are:

| Dep | Used for | Replacement strategy |
|-----|----------|---------------------|
| `useNavigate` | `navigateParent()`, `navigateAfterSessionRemoval()` | Inject as prop: `onNavigateSession` |
| `useSessionKey` | `params.id`, `sessionKey()` | Already has `sessionID` from parent; inject `sessionKey` as prop |
| `useGlobalSDK` | `globalSDK.client` for share/unshare | Use regular `useSDK` — or inject `shareClient` |

**Action:** Add 2-3 props to `MessageTimeline`:
```tsx
onNavigateSession?: (projectID: string, sessionID: string) => void
onNavigateSessionList?: (projectID: string) => void
projectID: string  // instead of reading from useParams
sessionKey: string  // instead of reading from useSessionKey
```

This makes `MessageTimeline` fully portable — it no longer imports from `@solidjs/router`.

### Step 2c: Extract session header/title/share UI → `session/session-title-bar.tsx`

**What:** Lines 301–919 — the title bar, rename, share popover, delete/archive dialogs.

**Why:** This is a large, self-contained UI block. Extracting it makes `MessageTimeline` focus purely on message rendering.

```
session/session-title-bar.tsx  (~400 lines)
  export function SessionTitleBar(props: {
    sessionID: string
    projectID: string
    sync: ...
    centered: boolean
    working: boolean
    tint: string | undefined
    onNavigateSession: ...
    // ...
  }) { ... }
```

### Step 2d: What remains in `MessageTimeline` (~500 lines)

```tsx
export function MessageTimeline(props: {
  // Existing props +
  projectID: string
  sessionKey: string
  onNavigateSession?: (projectID: string, sessionID: string) => void
  onNavigateSessionList?: (projectID: string) => void
}) {
  // 1. Staging (inline or imported)
  // 2. SessionTitleBar (imported component)
  // 3. ScrollView with message rendering
  // 4. Session turns with For loop
}
```

This is now **fully pane-portable** — all web-specific navigation is injected via props.

---

## Step 3: Refactor `prompt-input.tsx` (1,559 → ~350 editor core + ~200 model/agent bar + ~400 submit + ~300 integration)

`prompt-input.tsx` is the most deeply web-entangled file. It uses:

| Web-only dep | What it does |
|-------------|-------------|
| `useCommand` | Registers command palette entries, reads keybinds |
| `useComments` | Comment history for prompt history |
| `useFile` | File search, tabs, file loading |
| `useLayout` | File tree tab |
| `useSessionLayout` | `params`, `tabs`, `view` |

### Step 3a: Extract editor DOM logic → already in `prompt-input/editor-dom.ts` ✅

Already extracted. No action needed.

### Step 3b: Extract model/agent/variant bar → `prompt-input/prompt-controls.tsx`

**What:** Lines 1407–1555 — the `<DockTray>` with agent selector, model selector, variant selector, permissions toggle.

**Why:** This is a self-contained UI section. It uses `useCommand` for keybinds and `useProviders` — both need abstraction.

```
prompt-input/prompt-controls.tsx  (~200 lines)
  export function PromptControls(props: {
    local: ReturnType<typeof useLocal>
    language: ...
    mode: "normal" | "shell"
    // Keybind labels injected as strings instead of useCommand
    keybinds?: { agentCycle?: string; modelChoose?: string; variantCycle?: string; autoAccept?: string }
    // Model selector variant injected
    variants: string[]
    // ... 
  }) { ... }
```

### Step 3c: Abstract `useCommand` integration

`useCommand` is used for two things:
1. **Registering commands** (lines 424–449) — web-only command palette integration
2. **Reading keybinds** for tooltip display — cosmetic

**Strategy:** Make command registration optional:
```tsx
interface PromptInputProps {
  // ...existing...
  commands?: {
    register: (id: string, factory: () => Command[]) => void
    keybind: (id: string) => string | undefined
    trigger: (id: string, source: string) => void
    options: Command[]
  }
}
```

When `commands` is undefined (VSCode), no command palette registration happens, and keybind tooltips show nothing.

### Step 3d: Abstract `useComments` and `useFile`

These are used for:
- **Comments:** History persistence when navigating prompt history. Can be injected as optional callbacks.
- **File search:** `files.searchFilesAndDirectories(query)` for @ mentions. Abstract as `searchFiles?: (query: string) => Promise<string[]>` (already in `Platform`).
- **File tabs:** `recent()` computation, `files.tab()`, `files.pathFromTab()`. Inject as props.

```tsx
interface PromptInputProps {
  // ...existing...
  recentFiles?: string[]
  searchFiles?: (query: string) => Promise<string[]>
  commentActions?: {
    all: () => Comment[]
    replace: (items: Comment[]) => void
    setActive: (focus: CommentFocus) => void
    setFocus: (focus: CommentFocus) => void
  }
}
```

### Step 3e: Abstract `useSessionLayout`

Used for: `params.id` (session ID), `tabs` (open file tabs), `view` (review panel state).

Replace with injected props:
```tsx
interface PromptInputProps {
  sessionID?: string
  onOpenFile?: (path: string) => void
  onOpenReviewPanel?: () => void
}
```

### Step 3f: What remains in `prompt-input.tsx` (~1,200 lines → core portable editor)

After abstracting the web-specific deps into props/callbacks, the core `PromptInput` becomes portable:
- Editor DOM rendering and parsing
- Slash command popover
- @ mention popover  
- History navigation
- File attachment handling
- Submit logic
- Image handling

The web app wraps it with a thin adapter that provides the `useCommand`, `useComments`, `useFile`, `useLayout` integrations.

---

## Execution Order

> [!IMPORTANT]
> Each step produces a working, type-checked, tested state. No big-bang changes.

### Phase A: Pure extractions (no API changes)

These are file-level moves that don't change any interfaces:

1. ✅ **Extract `createSessionHistoryWindow`** → `session/history-window.ts`
2. ✅ **Extract `createTimelineStaging`** → `session/timeline-staging.ts`
3. ⏸️ **Extract followup logic** → *Deferred (coupled to local state, moves easily as part of ChatPane)*
4. ⏸️ **Extract fork/revert/restore** → *Deferred (coupled to local state, moves easily as part of ChatPane)*
5. ✅ **Extract review management** → `session/session-review.tsx`
6. ✅ **Extract session title bar** → `session/session-title-bar.tsx`

After each: `bun typecheck && bun run build && bun test`

### Phase B: Interface abstractions (prop injection)

These change component APIs but don't move files:

7. ✅ **MessageTimeline:** Replace `useNavigate`/`useSessionKey` with props
8. ✅ **PromptInput:** Abstract `useCommand` to optional prop
9. ✅ **PromptInput:** Abstract `useComments`/`useFile` to optional props  
10. ✅ **PromptInput:** Abstract `useSessionLayout` to props

After each: `bun typecheck && bun run build && bun test`

### Phase C: ChatPane extraction (separate PR — the actual plan Phase 2 components)

11. ✅ **Move portable pieces to `ui/panes/chat/`** — history-window, timeline-staging, message-gesture, message-timeline, session-title-bar, agent-color, comment-note, same
12. ⏸️ **Create `ChatPane` wrapper** — *Deferred until PromptInput is also extracted (model selector dialogs, file context still web-entangled)*
13. ✅ **Web re-export stubs** — all web consumers continue importing from original paths, now re-exported from `@liteai/ui/panes/chat`

---

## File Size After Refactoring

| File | Before | After |
|------|-------:|------:|
| `session.tsx` | 1,823 | ~350 |
| `session/history-window.ts` | — | ~240 |
| `session/session-followup.ts` | — | ~120 |
| `session/session-actions.ts` | — | ~130 |
| `session/session-review.ts` | — | ~200 |
| `message-timeline.tsx` | 1,029 | ~500 |
| `session/session-title-bar.tsx` | — | ~400 |
| `prompt-input.tsx` | 1,559 | ~1,200 (with abstractions) |
| `prompt-input/prompt-controls.tsx` | — | ~200 |

> [!NOTE]
> `prompt-input.tsx` stays largest because most of its code IS the portable editor core.
> The refactoring here is about **abstracting web deps from the interface**, not splitting it further.
> The editor DOM, popover, history, and submit logic are all tightly cohesive.

---

## Dependency Map: What's Portable vs Web-Only

### Already portable (in `@liteai/ui/panes/shared/`)
- `useSync`, `useSDK`, `useGlobalSDK`, `useGlobalSync`  
- `useLocal`, `usePrompt`, `usePermission`
- `useModels`, `useSettings`, `useLanguage`
- `usePlatform`, `usePaneRoute`
- `persist`, `server-errors`, `project-id`, `use-providers`

### Web-only (stays in `@liteai/web`)
- `useLayout` — multi-panel sizing, dock, file tree
- `useTerminal` — Ghostty terminal management
- `useFile` — file content cache, tree browsing
- `useComments` — line comment system
- `useCommand` — command palette
- `useNavigate`, `useParams`, `useSearchParams` — `@solidjs/router`
- `useSessionLayout` — wrapper around router params + layout

### Need abstraction to become portable
- `useNavigate` → inject `onNavigateSession` callback
- `useCommand` → inject optional `commands` prop
- `useFile.searchFilesAndDirectories` → inject via `Platform.searchFiles`
- `useComments` → inject optional `commentActions` prop
