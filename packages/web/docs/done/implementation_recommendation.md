# Phase 3 + Deferred Phase 1.3 — Implementation Recommendation

## TL;DR

**I recommend we split the work into 2 sessions**, but not along the lines you might expect. Phase 1.3 (file migration) is independent and lower-risk. Phase 3 (Extension Server) is the high-value work. Let's do Phase 3 first, then Phase 1.3 as cleanup.

---

## Scope Assessment

### Phase 3: VSCode Extension Server (6 tasks)

| Task | Effort | Risk | Description |
|------|--------|------|-------------|
| **3.1** Server Manager Spawn | Small | Low | Add `--hosted`, `--callback-port`, `--callback-csrf-token` flags to spawn args |
| **3.2** Extension Callback Server | **Medium** | Medium | New HTTP server in extension host with CSRF validation |
| **3.3** File Operations | Medium | Low | `/fs/readFile` (dirty buffer!), `/fs/writeFile`, `/fs/stat`, `/fs/readDirectory`, `/fs/exists` |
| **3.4** Workspace Registration | Small | Low | Push `workspaceFolders` to Core's `POST /project` on activation + listen for changes |
| **3.5** Terminal Integration | Medium | **High** | `vscode.window.createTerminal()` + shell integration API for output capture |
| **3.6** Git/SCM Integration | Small | Low | Query `vscode.git` extension API for status |

### Deferred Phase 1.3: File Migration (5 sub-tasks)

| Sub-task | Effort | Risk |
|----------|--------|------|
| Move `global-sync.tsx` + `global-sync/` → `packages/web/src/context/` | Medium | Medium |
| Move `sync.tsx`, `sdk.tsx`, `global-sdk.tsx` → `packages/web/src/context/` | Medium | Medium |
| Move `server.tsx`, `permission.tsx` → `packages/web/src/context/` | Small | Medium |
| Update all `packages/web` imports | Medium | Low |
| Remove HTTP/SSE exports from `packages/ui/src/panes/index.ts` | Small | Medium |

---

## Recommended Split

### Session A — Phase 3: Extension Server *(do first)*

This is the **high-value, high-impact** work that makes the VSCode extension "real."

**Tasks:** 3.1 → 3.2 → 3.3 → 3.4 → 3.6

> [!NOTE]
> **Task 3.5 (Terminal Integration) should be deferred** — it requires VSCode's Shell Integration API which is complex, has edge cases across platforms, and Core's PTY module needs deeper changes first (as noted in [the plan](~/Documents/workspace/liteai/packages/web/docs/todo/vscode-ext/architecture_refactoring_plan.md#L230)). The other 5 tasks deliver 90% of the value.

**What we'll build:**

```
packages/vscode/src/
├── extension-server.ts          ← NEW: HTTP callback server (Tasks 3.2, 3.3, 3.6)
├── server-manager.ts            ← MODIFIED: spawn with --hosted flags (Task 3.1)
├── extension.ts                 ← MODIFIED: boot ExtensionServer + workspace sync (Task 3.4)
└── webview/
    └── vscode-chat-controller.ts ← TODO (separate follow-up): wire to real IPC
```

**Key dependencies already in place:**
- ✅ Core accepts `--hosted --callback-port --callback-csrf-token` flags ([main.ts](~/Documents/workspace/liteai/packages/core/src/main.ts#L44-L66))
- ✅ `HostedCapabilities` makes callbacks to these exact endpoints ([hosted.ts](~/Documents/workspace/liteai/packages/core/src/capabilities/hosted.ts))
- ✅ Core has `POST /project?directory=...` for workspace registration ([server.ts](~/Documents/workspace/liteai/packages/core/src/server/server.ts#L124-L162))
- ✅ `ServerManager` already generates CSRF tokens and spawns the binary ([server-manager.ts](~/Documents/workspace/liteai/packages/vscode/src/server-manager.ts))

### Session B — Phase 1.3: File Migration *(do second)*

This is **pure cleanup** — no new functionality, just moving files from `packages/ui/src/panes/shared/` to `packages/web/src/context/` and updating imports.

**Lower priority** because:
- The chat components are already decoupled (Phase 1 done)
- The web adapter controllers already wrap `useSync()`/`useSDK()` in `packages/web`
- It's a refactoring with import-breakage risk that doesn't affect end-user functionality

---

## Decision Point

> [!IMPORTANT]
> **Do you want me to start Session A (Phase 3) now?**
>
> I'll implement Tasks 3.1–3.4 + 3.6 in this conversation, deferring Task 3.5 (Terminal) for a follow-up.
>
> Alternatively, if you prefer to start with the simpler Phase 1.3 cleanup first, I can do that instead.

---

## What Phase 3 Won't Cover (intentionally)

- **Wiring VscodeChatController to real IPC** — The stub controllers in `entry.tsx` will remain stubs. Making them talk to Core requires additional changes to the webview-side `fetch` bridge or a new postMessage protocol. This is a natural Phase 4.
- **Terminal Integration (Task 3.5)** — Complex, platform-specific, and Core's PTY module isn't ready for hosted delegation yet.
- **Remote SSH/WSL/DevContainers testing** — The code will use `vscode.workspace.fs` APIs which transparently work over remotes, but we can't test this without the actual environment.
