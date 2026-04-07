# Experimental Features Audit — v-Next Promotion Plan

> **Goal:** Remove all `experimental` labels, flags, and route prefixes from the codebase for the new major release. Every feature documented below is a candidate for promotion to official status or removal.

---

## Table of Contents

1. [Environment Flags (flag.ts)](#1-environment-flags)
2. [API Routes (/experimental)](#2-api-routes)
3. [Config Schema (config.experimental)](#3-config-schema-experimental)
4. [Plugin Hooks (experimental.*)](#4-plugin-hooks)
5. [Provider & SDK Integration](#5-provider--sdk-integration)
6. [Phased Migration Plan](#6-phased-migration-plan)

---

## 1. Environment Flags

All flags are defined in [`flag.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/flag/flag.ts#L56-L71).

| Flag | Type | Default | Description | Consumers | Decision |
|------|------|---------|-------------|-----------|----------|
| `LITEAI_EXPERIMENTAL` | boolean | `false` | Master toggle — enables several sub-flags when true | Gates `ICON_DISCOVERY`, `OXFMT`, `WORKSPACES` | **Remove** — sub-flags promoted individually |
| `LITEAI_EXPERIMENTAL_FILEWATCHER` | boolean | `false` | Enables parcel watcher subscription on `Instance.directory` (full project watch) | [`file/watcher.ts:78`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/file/watcher.ts#L78) | **Promote** — enable by default, no flag needed |
| `LITEAI_EXPERIMENTAL_DISABLE_FILEWATCHER` | boolean | `false` | Kill switch to completely disable file watcher init | [`file/watcher.ts:121`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/file/watcher.ts#L121) | **Rename** → `LITEAI_DISABLE_FILEWATCHER` (non-experimental pattern) |
| `LITEAI_EXPERIMENTAL_ICON_DISCOVERY` | boolean | `EXPERIMENTAL \|\| false` | Auto-discovers `favicon.*` in project root and sets it as the project icon | [`project/project.ts:311`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/project/project.ts#L311) | **Promote** — enable by default |
| `LITEAI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT` | boolean | `true` on Windows | Disables automatic clipboard copy on text selection in CLI TUI | [`cli/dialog.tsx:179`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/cli/cmd/tui/ui/dialog.tsx#L179), [`cli/app.tsx:224,809`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/cli/cmd/tui/app.tsx#L224) | **Rename** → `LITEAI_DISABLE_COPY_ON_SELECT` |
| `LITEAI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` | number? | `120000` | Override default bash command timeout | [`tool/run_command.ts:20`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/tool/run_command.ts#L20) | **Rename** → `LITEAI_BASH_TIMEOUT_MS` |
| `LITEAI_EXPERIMENTAL_OUTPUT_TOKEN_MAX` | number? | `32000` | Override max output tokens sent to provider | [`provider/transform/options.ts:8`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/provider/transform/options.ts#L8) | **Rename** → `LITEAI_OUTPUT_TOKEN_MAX` |
| `LITEAI_EXPERIMENTAL_OXFMT` | boolean | `EXPERIMENTAL \|\| false` | Enable oxfmt code formatter as an alternative to prettier | [`format/formatter.ts:94`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/format/formatter.ts#L94) | **Promote** — auto-detect like other formatters, remove flag |
| `LITEAI_EXPERIMENTAL_LSP_TY` | boolean | `false` | Use `ty` (Astral's Rust-based Python LSP) instead of pyright | [`lsp/index.ts:80`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/lsp/index.ts#L80), [`lsp/server/ty.ts:21`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/lsp/server/ty.ts#L21) | **Promote** — move to config `lsp.ty` / `lsp.pyright` toggle |
| `LITEAI_EXPERIMENTAL_WORKSPACES` | boolean | `EXPERIMENTAL \|\| false` | Enable workspace routing middleware (multi-instance request proxying) | [`workspace-router-middleware.ts:40`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/control-plane/workspace-router-middleware.ts#L40), [`cli/app.tsx:380`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/cli/cmd/tui/app.tsx#L380), [`cli/header.tsx:106,163`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/cli/cmd/tui/routes/session/header.tsx#L106) | **Promote** — enable by default |
| `LITEAI_EXPERIMENTAL_MARKDOWN` | boolean | `true` (unless `EXPERIMENTAL_MARKDOWN=false`) | Render markdown in CLI TUI message parts | [`cli/parts.tsx:76,84`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/cli/cmd/tui/routes/session/parts.tsx#L76) | **Promote** — already default true, remove flag |
| `LITEAI_ENABLE_EXPERIMENTAL_MODELS` | boolean | `false` | Show alpha-status models in provider model list | [`provider/state.ts:386`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/provider/state.ts#L386) | **Rename** → `LITEAI_ENABLE_ALPHA_MODELS` |

---

## 2. API Routes

### `/experimental/worktree` — Git Worktree CRUD

**File:** [`server/routes/experimental.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/server/routes/experimental.ts)

| Method | Path | OperationID | Description |
|--------|------|-------------|-------------|
| `POST` | `/experimental/worktree` | `project.worktree.create` | Create a new git worktree + run startup scripts |
| `GET` | `/experimental/worktree` | `project.worktree.list` | List sandbox worktrees for the project |
| `DELETE` | `/experimental/worktree` | `project.worktree.remove` | Remove a worktree and delete its branch |
| `POST` | `/experimental/worktree/reset` | `project.worktree.reset` | Reset worktree branch to primary default branch |

**Decision:** **Promote** → Move to `/project/worktree` or `/worktree` under main project routes.

### `/experimental/workspace` — Control Plane Workspace CRUD

**File:** [`server/routes/workspace.ts`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/server/routes/workspace.ts)

| Method | Path | OperationID | Description |
|--------|------|-------------|-------------|
| `POST` | `/experimental/workspace` | `project.workspace.create` | Create a workspace |
| `GET` | `/experimental/workspace` | `project.workspace.list` | List all workspaces |
| `DELETE` | `/experimental/workspace/:id` | `project.workspace.remove` | Remove a workspace |

**Decision:** **Promote** → Move to `/workspace` under main routes.

### Server Mount Point

**File:** [`server/server.ts:68`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/server/server.ts#L68)

```ts
.route("/experimental", ExperimentalRoutes())
```

**Decision:** Dissolve `ExperimentalRoutes` — merge worktree routes into project routes and workspace routes into main routes. Delete `routes/experimental.ts`.

---

## 3. Config Schema (`experimental`)

**File:** [`config/schema.ts:664-680`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/config/schema.ts#L664-L680)

```ts
experimental: z.object({
  disable_paste_summary: z.boolean().optional(),
  batch_tool: z.boolean().optional(),
  primary_tools: z.array(z.string()).optional(),
  continue_loop_on_deny: z.boolean().optional(),
  mcp_timeout: z.number().int().positive().optional(),
}).optional(),
```

| Property | Consumers | Description | Decision |
|----------|-----------|-------------|----------|
| `disable_paste_summary` | — | Disable paste content summarization | **Promote** → top-level config field |
| `batch_tool` | [`tool/registry.ts:53`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/tool/registry.ts#L53) | Enable the batch tool (runs multiple tool calls in one step) | **Promote** → `disabledTools` pattern or enable by default |
| `primary_tools` | [`tool/task.ts:98`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/tool/task.ts#L98) | Tools that should only be available to primary agents (denied to subagents) | **Promote** → top-level `agent.primary_tools` or permission system |
| `continue_loop_on_deny` | [`session/engine/persister.ts:329`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/engine/persister.ts#L329) | Continue the agent loop when a tool call is denied (instead of stopping) | **Promote** → top-level config or permission config |
| `mcp_timeout` | MCP system | Global MCP request timeout | **Already duplicated** — MCP servers have per-server `timeout` in schema. **Remove** or merge into `mcpServers` defaults |

---

## 4. Plugin Hooks (`experimental.*`)

**File:** [`plugin/types.ts:198-224`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/plugin/types.ts#L198-L224)

| Hook Name | Invocation Site | Description | Decision |
|-----------|----------------|-------------|----------|
| `experimental.chat.messages.transform` | [`session/engine/query.ts:305`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/engine/query.ts#L305) | Mutate chat messages before sending to LLM | **Rename** → `chat.messages.transform` |
| `experimental.chat.system.transform` | [`session/llm.ts:90`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/llm.ts#L90), [`agent/agent.ts:254`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/agent/agent.ts#L254) | Mutate system prompt before sending to LLM | **Rename** → `chat.system.transform` |
| `experimental.session.compacting` | [`session/tasks/compaction.ts:173`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/tasks/compaction.ts#L173) | Intercept/customize compaction behavior | **Rename** → `session.compacting` |
| `experimental.text.complete` | [`session/engine/persister.ts:191`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/engine/persister.ts#L191) | Post-process completed text output | **Rename** → `text.complete` |

> [!WARNING]
> Renaming hooks is a **breaking change for plugins**. Since this is a major release (v-Next), this is acceptable per Directive 0. However, any published plugins using these hooks will need updating.

---

## 5. Provider & SDK Integration

These items use "experimental" in a Vercel AI SDK / upstream context and should be audited separately:

| Location | Usage | Note |
|----------|-------|------|
| [`session/llm.ts:198`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/llm.ts#L198) | `experimental_repairToolCall` | Upstream Vercel AI SDK API — cannot rename |
| [`session/llm.ts:228`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/llm.ts#L228) | `experimental_telemetry` | Upstream Vercel AI SDK API — cannot rename |
| [`session/index.ts:812-813`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/index.ts#L812) | `model.cost?.experimentalOver200K` | Internal model cost field — **Rename** → `over200KRate` |
| [`provider/provider.ts:62`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/provider/provider.ts#L62) | `experimentalOver200K` in schema | Schema definition — **Rename** → `over200KRate` |
| [`provider/state.ts:41`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/provider/state.ts#L41) | `experimentalOver200K: model.cost?.context_over_200k` | Mapping from external model data — **Rename** → `over200KRate` |
| [`provider/models.ts:63`](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/provider/models.ts#L63) | `experimental: z.boolean().optional()` | Model metadata field from upstream — **Keep** (external schema) |

---

## 6. Phased Migration Plan

### Phase 1: Flag Cleanup (Low Risk)

> **Scope:** Remove the master `LITEAI_EXPERIMENTAL` flag and rename env vars.
> **Impact:** Env var names change (breaking for users who set them).
> **Test:** `bun typecheck`, all affected module tests.

| Task | Action |
|------|--------|
| Remove `LITEAI_EXPERIMENTAL` master flag | Delete from `flag.ts`, update all `LITEAI_EXPERIMENTAL \|\|` fallbacks |
| Promote `EXPERIMENTAL_FILEWATCHER` | Enable file watcher by default in `watcher.ts:78` (always subscribe to project dir). Remove flag |
| Rename `EXPERIMENTAL_DISABLE_FILEWATCHER` → `DISABLE_FILEWATCHER` | Simple rename in `flag.ts` and `watcher.ts` |
| Promote `EXPERIMENTAL_ICON_DISCOVERY` | Remove flag gate in `project.ts:311` — always run `discover()` |
| Rename `EXPERIMENTAL_DISABLE_COPY_ON_SELECT` → `DISABLE_COPY_ON_SELECT` | Rename in `flag.ts`, `dialog.tsx`, `app.tsx` |
| Rename `EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` → `BASH_TIMEOUT_MS` | Rename in `flag.ts`, `run_command.ts` |
| Rename `EXPERIMENTAL_OUTPUT_TOKEN_MAX` → `OUTPUT_TOKEN_MAX` | Rename in `flag.ts`, `options.ts` |
| Promote `EXPERIMENTAL_OXFMT` | Remove flag — auto-detect oxfmt like biome/prettier |
| Promote `EXPERIMENTAL_LSP_TY` | Move to config-driven LSP server selection. Remove flag |
| Promote `EXPERIMENTAL_WORKSPACES` | Remove flag gate in `workspace-router-middleware.ts:40`. Enable by default |
| Promote `EXPERIMENTAL_MARKDOWN` | Already default true. Remove flag — always render markdown |
| Rename `ENABLE_EXPERIMENTAL_MODELS` → `ENABLE_ALPHA_MODELS` | Rename in `flag.ts`, `state.ts` |

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
| **Total** | **31** | **22** | **6** | **2** | **1** |
