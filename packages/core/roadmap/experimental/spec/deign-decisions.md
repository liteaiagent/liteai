# Design Decisions & Rationale

## Phase 1: Design Decisions

### DR-1: Formatter & LSP feedback via tool results, not system-injected messages

**Decision:** When the AI modifies a file (via `write`, `edit`, or `apply_patch` tools), formatter and LSP results are appended to the **tool result output string** — not delivered as separate system-injected messages.

**Rationale:**

1. **Causal coupling:** The formatter and LSP checks are triggered *inside* the tool's `execute()` function (via `Bus.publish(File.Event.Edited)` and `LSP.touchFile()`). They complete before the tool returns. The results are a direct consequence of the tool call, so they belong in the tool result.

2. **No user-initiated file editing in Web/CLI:** In the current architecture, only the AI modifies files via tool calls. The Web UI and CLI TUI do not expose file editing interfaces. Therefore, every file modification has a corresponding tool call whose result can carry the feedback.

3. **Token efficiency:** System-injected messages persist in the conversation history and cost tokens on every subsequent turn. Tool result strings are scoped to the turn they occurred in and are naturally summarized by compaction.

4. **No infrastructure needed:** The tool result channel already exists and works. A system-injected message channel for arbitrary async events does not currently exist outside of planning mode.

**Future consideration (VSCode LSP server mode):** When `packages/core` acts as an LSP server for VSCode, users *will* edit files directly. In that scenario, system-injected messages become necessary — the LSP detects errors in a user-edited file and prompts the AI to propose a fix. This requires new infrastructure (an async notification channel into the conversation) and is deferred to a separate roadmap item.

### DR-2: File watcher promotion — dependency analysis with formatter, LSP, and file index

**Context:** Promoting `EXPERIMENTAL_FILEWATCHER` enables OS-native file watching via Parcel watcher on the project directory. This analysis maps how the four subsystems (watcher, ripgrep index, formatter, LSP) are currently wired and whether enabling the watcher introduces regressions or dependencies.

**Current event wiring:**

```
AI Tool (write/edit/apply_patch)
  ├── await Bus.publish(File.Event.Edited)          → Formatter (subscribes, runs)
  ├── await Bus.publish(FileWatcher.Event.Updated)  → VCS only (branch detection)
  ├── await LSP.touchFile()                         → LSP (direct call, re-analyzes file)
  └── await LSP.diagnostics()                       ← LSP (returns errors to tool result)

File Watcher (Parcel, OS-native)
  └── Bus.publish(FileWatcher.Event.Updated)        → VCS only (branch detection)
                                                    ✗ Formatter — NOT subscribed
                                                    ✗ LSP — NOT notified
                                                    ✗ File index — NOT updated
```

**Key observations:**

1. **Two separate bus events exist:** `File.Event.Edited` (triggers formatter) and `FileWatcher.Event.Updated` (triggers VCS). They are published independently — the watcher only produces the latter. The formatter only subscribes to the former.

2. **LSP is notified via direct function call** (`LSP.touchFile()`), not via bus events. Only AI tools make this call. The file watcher has no path to LSP.

3. **Execution order within tools is correct:** Formatter runs at step 1 (via `File.Event.Edited`), LSP runs at step 3 (via `LSP.touchFile()`). So LSP always analyzes the already-formatted file.

4. **Ripgrep index (`file/index.ts`) is completely standalone.** It re-scans the full project via `rg --files` every time `files()` is called. It does not subscribe to any bus events.

**Impact of promoting file watcher:**

| Subsystem | Impact | Explanation |
|-----------|--------|-------------|
| **VCS** | ✅ Improves | Branch detection now works for user-initiated git operations (checkout, merge, rebase), not just AI tool calls |
| **Formatter** | ⚪ No change | Subscribes to `File.Event.Edited`, not `FileWatcher.Event.Updated`. Unaffected by watcher |
| **LSP** | ⚪ No change | Notified via direct call from tools, not bus events. Unaffected by watcher |
| **File index** | ⚪ No change | Full ripgrep re-scan on every `files()` call. Does not listen to any events |
| **Performance** | ⚠️ Minor cost | OS-native file watching consumes resources (inotify watches on Linux, FSEvents on macOS). Large monorepos could exhaust inotify limits |

**Decision:** Promoting the file watcher is **safe** — it has no dependency on or conflict with the formatter, LSP, or file index. The systems are fully decoupled by design.

**Future optimization (separate roadmap item):** The file watcher could be wired to:
- **File index:** Incrementally add/remove entries on file create/delete events, eliminating full ripgrep re-scans
- **LSP:** Call `LSP.touchFile()` on changed files to keep diagnostics fresh (relevant when VSCode LSP server mode is implemented)
- **Formatter:** Potentially trigger formatting on external file changes (lower priority — most users have editor-integrated formatters)

These enhancements are additive improvements, not prerequisites for the watcher promotion.

### DR-3: `run_command` improvement scope — what we adopt and what we skip from liteai2

**Context:** Phase 1c draws heavily from liteai2's `BashTool.tsx` (1144 lines), which implements a comprehensive command lifecycle. This record documents what we adopt, what we skip, and why.

**Reference documents:**
- Agent-facing API spec: [`run-command-improvements.md`](./run-command-improvements.md) — describes the consumer perspective (`run_command`, `command_status`, `send_command_input` tools)
- Backend implementation: Phase 1c of this document — describes the `core` package changes

**What we adopt (aligned with both specs):**

| Feature | Source | Rationale |
|---------|--------|-----------|
| Background task lifecycle | liteai2 `spawnBackgroundTask()` + `BackgroundTask` registry | Critical for long-running commands. Agent-spec's `WaitMsBeforeAsync` pattern already backgrounds commands; we need the registry to track them |
| Auto-background on timeout | liteai2 `shellCommand.onTimeout()` | Prevents work loss. Current behavior kills the process — unacceptable for typechecks |
| Output persistence | liteai2 `persistedOutputPath` / `getToolResultPath()` | Agent-spec's `OutputCharacterCount` handles reading; we need the persistence layer to store |
| Semantic exit codes | liteai2 `interpretCommandResult()` | Reduces false error reports. Low implementation cost, high agent-quality impact |
| Sleep detection | liteai2 `detectBlockedSleepPattern()` | Prevents agent waste loops. Simple pattern match |
| Progress metadata | liteai2 `onProgress()` callback | Already partially implemented via `ctx.metadata()`. Needs threshold + structured updates |

**What we skip (product-specific or out of scope):**

| Feature | Source | Rationale |
|---------|--------|-----------|
| Sandbox (filesystem/network) | liteai2 `SandboxManager` | Requires significant infrastructure. Deferred to separate roadmap |
| Sed edit simulation | liteai2 `applySedEdit()` / `parseSedEditCommand()` | LiteAI has dedicated `edit`, `write`, and `apply_patch` tools — sed simulation is unnecessary |
| Foreground task registration (Ctrl+B) | liteai2 `registerForeground()` / `BackgroundHint` | CLI-specific TUI feature, not core engine concern. If needed, belongs in `packages/cli` |
| Image output handling | liteai2 `isImageOutput()` / `resizeShellImageOutput()` | Rare use case. Can be added later as a non-breaking enhancement |
| React JSX progress rendering | liteai2 `setToolJSX()` / `<BackgroundHint />` | LiteAI uses SSE, not React. Progress is delivered via metadata updates |
| Code indexing detection | liteai2 `detectCodeIndexingFromCommand()` | Analytics-specific. Not relevant to core command lifecycle |
| Git operation tracking | liteai2 `trackGitOperations()` | Nice-to-have. Can be added separately without affecting command lifecycle |
| Assistant auto-backgrounding | liteai2 `ASSISTANT_BLOCKING_BUDGET_MS` / `KAIROS` | Feature-flagged assistant mode. LiteAI's architecture handles this differently via session routing |

**Key architectural difference:** LiteAI's `run_command` returns results via `Tool.execute()` → SSE. liteai2's `BashTool` uses React state + async generators. Despite the different transport layers, the core lifecycle (spawn → track → notify → retrieve) is identical. Phase 1c implements the lifecycle in LiteAI's SSE-based architecture.

