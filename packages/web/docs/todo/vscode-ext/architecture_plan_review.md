# Architecture Refactoring Plan — Review & Recommendations

## Overall Verdict: The Plan is Solid ✅

The three-phase approach (Dumb UI → Hosted Mode → Extension Server) is architecturally sound and mirrors proven patterns (Antigravity uses the same layered approach). The phasing order is correct — UI decoupling **must** come first.

However, the **Phase 1 component list is incomplete**. Here's the full picture:

---

## Phase 1: What Needs the "Dumb UI" Treatment?

### Current Coupling Map (`packages/ui/src/panes/chat/`)

| Component | `useSync()` | `useSDK()` | `useGlobalSync()` | Needs Refactoring? |
|-----------|:-----------:|:----------:|:------------------:|:-------------------:|
| **ChatPane** | ✅ | ✅ | ❌ | ✅ Listed in plan |
| **ChatNewSession** | ✅ | ✅ | ❌ | ✅ Listed in plan |
| **MessageTimeline** | ✅ | ✅ | ❌ | ⚠️ **MISSING from plan** |
| **SessionTitleBar** | ✅ | ✅ | ❌ | ⚠️ **MISSING from plan** |
| **ChatPromptInput** | ✅ | ✅ | ❌ | ⚠️ **MISSING from plan** |
| **ChatModelSelector** | ? | ? | ❌ | ⚠️ **Needs audit** |

> [!IMPORTANT]
> **MessageTimeline**, **SessionTitleBar**, and **ChatPromptInput** all directly call `useSync()` and `useSDK()` inside their bodies. They are NOT dumb yet — they actively read from and write to the HTTP-backed sync store. These must be included in Phase 1.

### What Specifically Needs Refactoring In Each?

#### MessageTimeline (376 lines)
- **Reads**: `sync.data.message[id]`, `sync.data.session_status[id]`, `sync.data.part[messageID]`, `sync.data.agent`
- **Reads**: `sync.session.get(id)` for title, parentID
- These should come via **props** or a **Controller accessor**, not from the context directly

#### SessionTitleBar (610 lines) — **Heaviest coupling**
- **Reads**: `sync.session.get(id)`, `sync.data.config.share`
- **Writes**: `sdk.client.project.session.share()`, `.unshare()`, `.update()`, `.delete()`
- **Mutates store**: `sync.set(produce(...))` to update session list after archive/delete
- This is the most tightly coupled component. It needs:
  - Session CRUD operations abstracted into **controller actions** (`controller.renameSession()`, `controller.archiveSession()`, `controller.deleteSession()`, `controller.shareSession()`)
  - Session info as props/accessor

#### ChatPromptInput (23KB)
- **Reads**: `sdk.client`, `sync.data` for model/provider lists
- Already partially prop-driven (accepts `handler`, `searchFiles`, `recentFiles`)
- Needs model/provider data to come from controller instead of directly from sync

---

## What Does NOT Need Dumb UI Refactoring

### Shared Providers (the adapter layer) — Keep coupled
These files **ARE** the adapters. They sit below the Controller interface and implement it using HTTP/SDK:

| File | Role | Should Stay Coupled |
|------|------|:-------------------:|
| `sync.tsx` (SyncProvider) | Adapter: maps SDK → `useSync()` context | ✅ Yes |
| `permission.tsx` | Adapter: permission auto-respond logic | ✅ Yes |
| `global-sync.tsx` | Adapter: SSE event stream → reactive store | ✅ Yes |
| `global-sdk.tsx` | Adapter: creates SDK client | ✅ Yes |
| `server.tsx` | Adapter: server health/connection | ✅ Yes |
| `models.tsx` | Adapter: model list management | ✅ Yes |

> [!NOTE]
> These providers are **already the right pattern** — they're the glue between HTTP and the UI. The Controller interfaces will formalize what they expose, and platform-specific adapters (web vs. VSCode) will implement the same Controller interface differently.

### Web-Only Components — Keep coupled
Everything in `packages/web/src/` (sidebar, settings, layout, home) can stay directly coupled to `useGlobalSync()`. These components will **never** run in VSCode — they're web-app-specific. Refactoring them would be wasted effort.

---

## Suggested Revisions to the Plan

### Phase 1 Action Items (Updated)

```diff
 ### Action Items
 - [ ] **Define Interfaces:** Create `ChatController`, `SyncController`, 
       and `ProjectController` interfaces
+- [ ] **Define SessionController:** Add `SessionController` with 
+      `rename()`, `archive()`, `delete()`, `share()`, `unshare()` 
+      actions (needed by SessionTitleBar)
 - [ ] **Refactor Components:** Update `<ChatPane>`, `<SessionReview>`, 
-      and `<ChatNewSession>` to accept `props.controller`
+      `<ChatNewSession>`, `<MessageTimeline>`, `<SessionTitleBar>`, 
+      and `<ChatPromptInput>` to accept controller/props
 - [ ] **Implement Adapters:** Inside `packages/web` (and 
       `packages/vscode/webview`), create a `GlobalChatController`
```

### Refactoring Strategy Per Component

| Component | Strategy |
|-----------|----------|
| **ChatPane** | Already mostly clean. Swap `useSync()` reads for controller accessors. |
| **MessageTimeline** | Pass message data, session status, and parts as **props**. Already receives `renderedUserMessages` as prop — extend this pattern for parts and status. |
| **SessionTitleBar** | Extract CRUD actions into `SessionController` interface. Pass session info (title, parentID, share) as props. All `sdk.client.*` calls become `controller.rename()`, etc. |
| **ChatPromptInput** | Model/provider data should come from a `ModelController` or props. Submit handler is already prop-driven ✅. |
| **ChatNewSession** | Minimal coupling — just `useSync()` for project info and `useSDK()` for directory. Easy to prop-drive. |

### The Type-Only Imports Are Fine

> [!TIP]
> Many components import **types** from `@liteai/sdk` (e.g., `import type { UserMessage }`). These are compile-time only — they produce **zero runtime coupling** and don't need to be removed. TypeScript type imports are perfectly acceptable in "dumb" components.

---

## Summary

| Question | Answer |
|----------|--------|
| Is the plan's 3-phase approach correct? | ✅ Yes, solid architecture |
| Is the Phase 1 component list complete? | ❌ No, missing 3 critical components |
| Should web-only components be made dumb? | ❌ No, wasted effort |
| Should shared providers be made dumb? | ❌ No, they ARE the adapters |
| Is the `@liteai/sdk` type import a problem? | ❌ No, type-only imports are fine |
| Biggest refactoring challenge? | **SessionTitleBar** — heavy CRUD coupling |
