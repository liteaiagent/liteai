# Phased Migration Plan — v-Next Promotion Plan

> **Goal:** Remove all `experimental` labels, flags, and route prefixes from the codebase for the new major release. Every feature documented below is a candidate for promotion to official status or removal.

[experimental-audit.md](../spec/experimental-audit.md)

---

### Phase 1: Flag Cleanup (Low Risk) [✅ COMPLETED]

> **Scope:** Remove the master `LITEAI_EXPERIMENTAL` flag and rename env vars.
> **Impact:** Env var names change (breaking for users who set them).
> **Test:** `bun typecheck`, all affected module tests.

| Task | Action |
|------|--------|
| Remove `LITEAI_EXPERIMENTAL` master flag | Delete from `flag.ts`, update all `LITEAI_EXPERIMENTAL \|\|` fallbacks |
| Promote `EXPERIMENTAL_FILEWATCHER` | Enable file watcher by default in `watcher.ts:78` (always subscribe to project dir). Remove flag |
| Rename `EXPERIMENTAL_DISABLE_FILEWATCHER` → `DISABLE_FILEWATCHER` | Simple rename in `flag.ts` and `watcher.ts` |
| Promote `EXPERIMENTAL_ICON_DISCOVERY` | Remove flag gate in `project.ts:311` — always run `discover()` |
| Move `EXPERIMENTAL_DISABLE_COPY_ON_SELECT` → `DISABLE_COPY_ON_SELECT` | **Move to `packages/cli`** — pure TUI concern with zero consumers in core. Delete from `core/flag.ts`, define locally in CLI (e.g. `cli/flags.ts`). Update `dialog.tsx`, `app.tsx` |
| Rename `EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` → `BASH_TIMEOUT_MS` | Rename in `flag.ts`, `run_command.ts` |
| Rename `EXPERIMENTAL_OUTPUT_TOKEN_MAX` → `OUTPUT_TOKEN_MAX` | Rename in `flag.ts`, `options.ts` |
| Promote `EXPERIMENTAL_OXFMT` | **Defer to Phase 1b** — requires mutex-per-extension refactor first |
| Promote `EXPERIMENTAL_LSP_TY` | **Defer to Phase 1b** — requires mutex-per-extension refactor first |
| Promote `EXPERIMENTAL_WORKSPACES` | Remove flag gate in `workspace-router-middleware.ts:40`. Enable by default |
| Promote `EXPERIMENTAL_MARKDOWN` | Already default true. Remove flag — always render markdown |
| Rename `ENABLE_EXPERIMENTAL_MODELS` → `ENABLE_ALPHA_MODELS` | Rename in `flag.ts`, `state.ts` |

### Phase 1b: Formatter & LSP Mutex-per-Extension Refactor (Medium Risk) [✅ COMPLETED]

> **Problem:** The current formatter system runs **ALL** matching formatters for a given file extension. If both `oxfmt` and `prettier` support `.ts`, both run sequentially on the same file — causing conflicts, wasted cycles, and non-deterministic output. The LSP system avoids this via a crude global flag swap (`filterServers()`), but this is not per-extension and doesn't generalize.
>
> **Goal:** Both formatters and LSP servers must use a **priority-based, per-extension mutex** selection model. For each file extension, only the highest-priority tool runs.

#### Design: Priority-Based Mutex Selection

**Formatter Resolution (per extension):**

1. Collect all formatters whose `extensions` array includes the target extension
2. Filter to only those whose `enabled()` returns `true` (project has the dependency/config)
3. **Select the highest-priority one** — only one formatter runs per extension
4. Priority order (highest → lowest): project-specific tools > ecosystem-native tools > general-purpose tools

```
Priority (highest first):
  oxfmt        → JS/TS specialist (Rust-based, fastest)
  biome        → JS/TS specialist (Rust-based, config-detected)
  prettier     → general-purpose (JS-based, dependency-detected)
```

For non-overlapping extensions (e.g. `.go` → `gofmt`, `.py` → `ruff`), there's no conflict — only one formatter ever matches.

**LSP Resolution (per extension):**

1. Collect all LSP servers whose `extensions` array includes the target extension
2. Filter to only those whose `spawn()` would succeed (binary available)
3. **Select the highest-priority one** — only one LSP server per extension per root
4. Priority order for Python: `ty` > `pyright` (ty is faster, Rust-based)
5. Priority order for JS/TS linting: `biome` > `eslint` (already implemented via `filterServers()`)

**Config Override:**

Users can override priority via the existing config system:
```json
{
  "formatter": {
    "oxfmt": { "disabled": true }
  },
  "lsp": {
    "ty": { "disabled": true }
  }
}
```

| Task | Action |
|------|--------|
| Refactor `getFormatter()` in `format/index.ts` | Change from returning `Info[]` → returning `Info \| undefined` (single winner per extension). Add priority ordering to formatter definitions |
| Add `priority` field to `Formatter.Info` | Numeric priority (lower = higher priority). Used to break ties when multiple formatters match |
| Promote `EXPERIMENTAL_OXFMT` | Remove flag gate in `formatter.ts:94`. oxfmt auto-detects via `package.json` like all other formatters. Mutex ensures only highest-priority runs |
| Refactor `filterServers()` in `lsp/index.ts` | Replace flag-based global exclusion with per-extension priority selection. Add `priority` field to `LSPServer.Info` |
| Promote `EXPERIMENTAL_LSP_TY` | Remove flag gate in `ty.ts:21`. Remove `filterServers()` flag logic. ty auto-detects via binary availability. Priority-based selection picks winner |
| Remove double-gate in `ty.ts` | Delete the `if (!Flag.LITEAI_EXPERIMENTAL_LSP_TY) return undefined` guard in `spawn()` — selection is now handled at the registry level |
| Update config schema | Document priority behavior. `disabled: true` in config always wins over auto-detection |
| Add formatter attribution to tool results | In `write.ts`, `edit.ts`, `apply_patch.ts`: append which formatter ran (e.g. `"Formatted by oxfmt"`) or failure status (e.g. `"prettier failed (exit 1)"`) to the tool output string |
| Add LSP source attribution to tool results | In `write.ts`, `edit.ts`, `apply_patch.ts`: change `"LSP errors detected"` → `"LSP errors detected by 'ty'"`. Include `source` attribute in `<diagnostics>` tag |
| Tests | `bun test test/format`, `bun test test/lsp` — verify single formatter/LSP per extension, verify priority ordering, verify config override, verify tool output includes attribution |

### Phase 1c: `run_command` Lifecycle Improvements (High Impact)

> **Problem:** The current `run_command` tool (`tool/run_command.ts`, 265 lines) is a simple spawn-and-wait implementation with no background task support, no progress streaming, no large output handling, and no command semantic interpretation. Long-running commands (typecheck, tests, builds) either block the agent or get killed on timeout — losing all work. This is the agent's most-used tool and its biggest bottleneck.
>
> **Reference:** liteai2's `BashTool.tsx` (1144 lines) implements a full command lifecycle with background tasks, progress generators, auto-backgrounding, output persistence, and semantic exit code interpretation.
>
> **Goal:** Bring `run_command` up to production quality with a proper long-running command lifecycle. Existing `EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` will be renamed to `BASH_TIMEOUT_MS` in Phase 1.

#### Priority 1: Background Task Lifecycle (Critical)

> Without background tasks, the agent cannot run `bun typecheck` (2+ min) or `bun test` (30+ min) without blocking or timing out.

| Task | Action |
|------|--------|
| Add `run_in_background` parameter to schema | Boolean flag. When `true`, spawn the command and immediately return a task ID without waiting for completion |
| Implement `BackgroundTask` registry | In-memory map of `taskId → { process, output, status }`. Commands spawned in background are tracked here |
| Auto-background on timeout | Instead of killing the process on timeout, transition it to a background task and return the task ID. The agent can then poll via `command_status` |
| Task completion notifications | When a background task completes, inject a `<task_notification>` into the agent's next turn so it knows the result is ready |
| Background task abort | Support aborting background tasks via `send_command_input` with `terminate: true` |
| Tests | `bun test test/tool/run_command` — verify background lifecycle: spawn → poll → complete → notify |

#### Priority 2: Output Management (High)

> Large outputs (typecheck errors, test failures) are silently lost. The agent makes decisions on truncated data.

| Task | Action |
|------|--------|
| Implement output persistence | For outputs exceeding threshold (30K chars), persist full output to a temp file. Include file path in tool result so the agent can read it via `read` tool |
| End-truncating accumulator | For very large outputs, keep the first N chars + last N chars, truncating the middle. This preserves both the start (command header) and end (summary/errors) |
| Structured output schema | Return `{ stdout, stderr, exitCode, interrupted, backgroundTaskId?, persistedOutputPath? }` instead of a raw string. Enables the agent to introspect exit codes programmatically |

#### Priority 3: Progress Streaming (Medium)

> The agent has zero visibility into long-running foreground commands. It doesn't know if the command is stuck or progressing.

| Task | Action |
|------|--------|
| Implement progress metadata updates | During execution, periodically update `ctx.metadata()` with current output lines, elapsed time, and total bytes. The UI (CLI/Web) can display this |
| Progress threshold | Only start streaming progress after 2s delay (avoid noise for fast commands) |

#### Priority 4: Command Intelligence (Medium)

> The agent treats all non-zero exit codes as errors, even when they have well-defined non-error semantics.

| Task | Action |
|------|--------|
| Semantic exit code interpretation | `grep` returns 1 for "no match" (not an error), `diff` returns 1 for "files differ" (expected), `test` returns 1 for "false" (valid). Add an interpreter that maps `(command, exitCode)` → `{ isError, message }` |
| Sleep pattern detection | Block `sleep N` (N ≥ 2) as the first command. Suggest `run_in_background` or appropriate alternatives. Prevents agent polling loops |
| Silent command detection | Commands like `mv`, `cp`, `mkdir` produce no stdout on success. Detect these and return "Done" instead of empty output, preventing the agent from retrying |
| Rename `EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` → `BASH_TIMEOUT_MS` | Already planned in Phase 1. Listed here for dependency tracking |

### Phase 2: Route Promotion (Medium Risk)

> **Scope:** Move `/experimental/*` routes to official paths. Update SDK/clients.
> **Impact:** Breaking API change — clients must update endpoint URLs.
> **Test:** `bun typecheck`, `bun test test/server`, SDK integration tests.

| Task | Action |
|------|--------|
| Move worktree routes | From `/experimental/worktree` → `/project/worktree` (or `/worktree`) |
| Move workspace routes | From `/experimental/workspace` → `/workspace` |
| Update `operationId` values | Remove `experimental.` prefix from all operation IDs |
| Delete `routes/experimental.ts` | Inline routes into appropriate route files |
| Update `server.ts` mount | Remove `.route("/experimental", ...)`, add new mounts |
| Update SDK clients | Update web & CLI to use new endpoint paths |
| Update test fixtures | Any test hitting `/experimental/*` endpoints |

### Phase 3: Config & Hook Stabilization (Medium Risk)

> **Scope:** Dissolve `config.experimental` and rename plugin hooks.
> **Impact:** Breaking config change + breaking plugin API.
> **Test:** `bun typecheck`, `bun test test/config`, `bun test test/session`.

| Task | Action |
|------|--------|
| Promote `experimental.batch_tool` | Move to top-level `batch_tool: boolean` or enable by default |
| Promote `experimental.primary_tools` | Move to `agent.primary_tools` at top level |
| Promote `experimental.continue_loop_on_deny` | Move to `permission.continue_on_deny` or top-level |
| Promote `experimental.disable_paste_summary` | Move to top-level `disable_paste_summary` |
| Remove `experimental.mcp_timeout` | Already superseded by per-server `timeout` in `mcpServers` |
| Delete `experimental` from config schema | Remove the entire `experimental` object from `schema.ts` |
| Rename plugin hooks | `experimental.chat.messages.transform` → `chat.messages.transform`, etc. |
| Update plugin types | Remove `experimental.` prefix from all hook names in `types.ts` |
| Update all trigger sites | `session/llm.ts`, `session/engine/query.ts`, `session/engine/persister.ts`, `session/tasks/compaction.ts`, `agent/agent.ts` |

### Phase 4: Internal Schema Cleanup (Low Risk)

> **Scope:** Rename internal `experimentalOver200K` fields.
> **Impact:** Internal only — no external-facing changes.
> **Test:** `bun typecheck`, `bun test test/provider`.

| Task | Action |
|------|--------|
| Rename `experimentalOver200K` → `over200KRate` | Update `provider.ts`, `state.ts`, `session/index.ts` |
| Keep upstream `experimental_*` | Do not rename `experimental_repairToolCall`, `experimental_telemetry` (Vercel AI SDK owns these) |
| Keep `models.ts` `experimental` field | External model metadata — not our naming |

---

## Summary

| Category | Total Items | Promote | Rename | Remove | Keep |
|----------|------------|---------|--------|--------|------|
| Environment Flags | 12 | 7 | 4 | 1 (master) | 0 |
| API Routes | 7 endpoints | 7 | — | — | — |
| Config Fields | 5 | 4 | — | 1 | — |
| Plugin Hooks | 4 | 4 (rename) | — | — | — |
| Internal Schema | 3 | — | 2 | — | 1 |
| `run_command` (Phase 1c) | 13 tasks | 13 (new) | — | — | — |
| **Total** | **44** | **35** | **6** | **2** | **1** |

---

## Design Decisions & Rationale

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

