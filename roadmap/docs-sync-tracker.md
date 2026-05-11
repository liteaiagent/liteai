# Documentation ↔ Code Sync Tracker

> **Purpose:** Track documentation freshness against `packages/core` source code and `roadmap/`.  
> **Created:** 2026-05-12  
> **Last updated:** 2026-05-13  

---

## How to Use This Document

Each section below maps a docs folder to its source code domain. Items are tagged:

- `[ ]` — Not yet audited/updated
- `[/]` — In progress
- `[x]` — Audited and synced with code

When resuming, pick the next `[ ]` section, compare the doc content against the source files listed, and update the doc to match current code. Mark `[x]` when done.

---

## Priority Order

| # | Doc Section | Staleness | Impact | Session |
|---|---|---|---|---|
| 1 | **Configuration: settings.md** | 🔴 Critical | Every user reads this | Session 1 ✅ |
| 2 | **Reference: environment-variables.md** | 🔴 Critical | Every user reads this | Session 1 ✅ |
| 3 | **Reference: tools-reference.md** | 🔴 Critical | Missing ~10 tools | Session 2 ✅ |
| 4 | **Architecture: provider-system.md** | 🔴 Critical | Lists 6 providers, code has 20+ | Session 2 ✅ |
| 5 | **Architecture: system-overview.md** | 🟡 Moderate | Missing ~12 modules from diagram | Session 3 ✅ |
| 6 | **Architecture: session-engine.md** | 🟡 Moderate | References non-existent files | Session 3 ✅ |
| 7 | **Build: hooks.md** | 🟡 Moderate | Wrong schema format | Session 4 ✅ |
| 8 | **Build: mcp.md** | 🟡 Moderate | Wrong config nesting | Session 4 ✅ |
| 9 | **Architecture: context-memory.md** | 🟡 Moderate | Thin, missing details | Session 5 ✅ |
| 10 | **Architecture: security-model.md** | 🟢 Minor | Thin but not wrong | Session 5 ✅ |
| 11 | **Architecture: transport-channels.md** | 🟢 Minor | Mostly correct | Session 6 ✅ |
| 12 | **Architecture: coordinator-swarms.md** | 🟢 Minor | Mostly correct | Session 6 ✅ |
| 13 | **Architecture: telemetry.md** | 🟢 Minor | Mostly correct | Session 6 ✅ |
| 14 | **Roadmap: feature-status.md** | 🟡 Moderate | Links may be stale | Session 7 ✅ |
| 15 | **Getting-started: all pages** | 🟡 Moderate | Need full audit | Session 7 ✅ |
| 16 | **Build: remaining pages** | 🟡 Moderate | Need full audit | Session 8 ✅ |
| 17 | **Reference: remaining pages** | 🟡 Moderate | Need full audit | Session 8 ✅ |
| 18 | **Platforms: all pages** | 🟢 Minor | Need full audit | Session 9 ✅ |

---

## Detailed Discrepancies

### 1. `docs/configuration/settings.md` → `src/config/schema.ts`

**Status:** [x] Updated (Session 1)

**Previously missing (now fixed):**
- Full `Info` schema with 30+ top-level keys (was showing ~6)
- `logLevel`, `skills`, `skillUsage`, `watcher`, `snapshot`, `share`, `autoupdate`
- `disabled_providers`, `enabled_providers`, `small_model`, `default_agent`, `username`
- Full `agent` config (25+ fields including thinking, thinkingBudget, effort, isolation, hooks, etc.)
- Full `provider` config (model overrides, dynamic models, whitelist/blacklist, options)
- Full `mcpServers` config (local/remote discriminated union, OAuth, timeout, disabled)
- `formatter` and `lsp` configuration
- `compaction` config (auto, prune, reserved)
- `experimental` flags (batch_tool, continue_loop_on_deny, mcp_timeout, etc.)
- Full `hooks` schema (type: command/prompt/agent/http, matcher, async, once, statusMessage)
- `disableAllHooks`, `outputStyle`, `enabledPlugins`, `disabledTools`, `disabledSkills`
- `extraKnownMarketplaces` (team-shared plugin sources)
- `telemetry` config (langfuse, otel endpoint/protocol, perfetto)
- `enterprise` config
- `permission` detailed schema with per-tool rules

---

### 2. `docs/reference/environment-variables.md` → `src/flag/flag.ts`

**Status:** [x] Updated (Session 1)

**Previously missing (now fixed):**
- `LITEAI_GIT_BASH_PATH`, `LITEAI_CONFIG_CONTENT`, `LITEAI_TUI_CONFIG`
- `LITEAI_DISABLE_TERMINAL_TITLE`, `LITEAI_DISABLE_LSP_DOWNLOAD`
- `LITEAI_ENABLE_ALPHA_MODELS`, `LITEAI_DISABLE_MODELS_FETCH`
- `LITEAI_COMPACTION_BUFFER_TOKENS`, `LITEAI_PRUNE_MINIMUM_TOKENS`, `LITEAI_PRUNE_PROTECT_TOKENS`
- `LITEAI_INJECT_SKILLS_IN_SYSTEM_PROMPT`
- `LITEAI_DISABLE_FILEWATCHER`, `LITEAI_BASH_TIMEOUT_MS`
- `LITEAI_OUTPUT_TOKEN_MAX`, `LITEAI_DISABLE_FILETIME_CHECK`
- `LITEAI_MODELS_URL`, `LITEAI_HOME`, `LITEAI_CLIENT`
- `LITEAI_FORK_SUBAGENT`
- DB/testing flags: `LITEAI_DB_MEMORY`, `LITEAI_DISABLE_CHANNEL_DB`, `LITEAI_SKIP_MIGRATIONS`
- `LITEAI_FAKE_VCS`, `LITEAI_MODELS_PATH`
- Platform values: doc said `standard` but code uses `liteai` as default

---

### 3. `docs/reference/tools-reference.md` → `src/tool/*.ts`

**Status:** [x] Updated (Session 2)

**Previously missing (now fixed):**
- Added all 35 tools from `src/tool/` with correct canonical IDs from `Tool.define()` calls
- Added `apply_patch`, `codesearch`, `batch`, `skill`, `todowrite`, `plan_enter`, `plan_exit`, `send_command_input`, `StructuredOutput`, `ask_user`
- Fixed naming mismatches: `webfetch` (not `web_fetch`), `websearch` (not `web_search`), `command_status` (not `read_command_output`)
- Removed non-existent tools: `background_command` (integrated into `run_command`), `kill_command` (use `send_command_input` with `Terminate: true`)
- Added notes on conditionally loaded tools: memory tools (auto-memory), batch (experimental flag), structured output (json_schema format only)
- Added notes on tools registered but commented out in registry: `codesearch`, `lsp`
- Added tool configuration section: `disabledTools`, agent-scoped tools, output truncation
- Added `apply_patch` vs `edit`/`write`/`multiedit` mutual exclusivity based on model

---

### 4. `docs/architecture/provider-system.md` → `src/provider/`

**Status:** [x] Updated (Session 2)

**Previously missing (now fixed):**
- Expanded from 6 providers to all 20+ providers matching `src/provider/loaders/index.ts`
- Added tiered provider taxonomy: Direct API, Cloud Platforms, Aggregators, Specialized/Enterprise, Local
- Added complete multi-phase provider resolution pipeline with mermaid diagram
- Fixed `ModelCapabilities` interface to match actual code: `temperature`, `reasoning`, `attachment`, `toolcall`, `input`/`output` modality objects, `interleaved`
- Added model metadata schema (cost, limits, variants, status, api, family)
- Added dynamic model discovery section (`dynamicModels`, `/v1/models` fetch)
- Added auth plugins section (CodexAuth, CopilotAuth, CodeAssistAuth, Ai4allAuth from `src/auth/registry.ts`)
- Added SDK bridge section (`src/provider/sdk.ts` and `src/provider/loaders/bundled.ts`)
- Fixed file references: `src/provider/loaders/` directory (not `src/provider/loader.ts`)
- Added provider source types (`env`, `config`, `api`, `custom`)
- Added Vertex Anthropic variant (`google-vertex-anthropic`)

---

### 5. `docs/architecture/system-overview.md` → `src/`

**Status:** [x] Updated (Session 3)

**Previously missing (now fixed):**
- Expanded module inventory from ~16 to 47+ modules matching actual `src/` directory
- Added missing subsystems: `auth/`, `bus/`, `ide/`, `capabilities/`, `snapshot/`, `acp/`, `hook/`, `scheduler/`, `feedback/`, `patch/`, `format/`, `style/`, `installation/`, `control-plane/`, `share/`, `skill/`, `plugin/`, `isolation/`, `worktree/`, `account/`, `question/`, `command/`, `shell/`
- Added Safety & Guardrails section (loop-detection, stop-drift, permission)
- Added pipeline and persister to session engine diagram
- Updated subsystem summary table with correct descriptions and module counts
- Added multi-tenant design section with tenant/session isolation explanation
- Added data flow sequence diagram for a single turn
- Added Effect to technology stack

---

### 6. `docs/architecture/session-engine.md` → `src/session/engine/`

**Status:** [x] Updated (Session 3)

**Previously missing (now fixed):**
- Fixed all non-existent file references: `tool-dispatch.ts` → `streaming-tool-executor.ts`, `content-optimization.ts` → removed, `compaction.ts` → `compaction-orchestrator.ts`
- Added event-sourced architecture overview with orchestrator/generator separation
- Added all engine components: `persister.ts`, `pipeline.ts`, `correction-injector.ts`, `loop-detection.ts`, `thinking-loop-detector.ts`, `stop-drift.ts`, `system.ts`
- Added pre-processing pipeline (tool result budget + snip compact stages)
- Added StreamingToolExecutor concurrency model (concurrent-safe vs exclusive classification)
- Added loop detection with 3 detectors (thinking, tool call, content chanting) and thresholds
- Added stop-drift prevention for plan mode
- Added step mode (StepPauseLatch, IDE integration)
- Added persistence architecture (EventPersister write queue, drainWrites)
- Added session modes table (Normal, Plan, Coordinator, Headless)
- Added turn budgets and stop conditions tables
- Added event routing table for all EngineEvent.Any types

---

### 7. `docs/build/hooks.md` → `src/hook/`, `src/config/schema.ts`

**Status:** [x] Updated (Session 4)

**Previously missing (now fixed):**
- Fixed handler type from `"shell"` to `"command"` and added all 4 types: `command`, `http`, `prompt`, `agent`
- Added all 23 lifecycle events from `Event` enum in `src/hook/hook.ts`
- Added complete handler field documentation: `matcher`, `once`, `async`, `statusMessage`, `allowedEnvVars`, `timeout`
- Added exit code semantics for command hooks (0 = proceed, 2 = blocked, other = proceed)
- Added structured JSON output parsing (`hookSpecificOutput`, `permissionDecision`)
- Added HTTP hook documentation with `allowedEnvVars` for header variable expansion
- Added prompt and agent hook types (context injection)
- Added group matcher pattern (regex filtering by tool name)
- Added hook input context JSON structure with field availability matrix
- Added agent-scoped hooks (per-agent `hooks` field in config)
- Removed non-existent `method` field (HTTP hooks always use POST)
- Added `disableAllHooks` global kill switch

---

### 8. `docs/build/mcp.md` → `src/mcp/`, `src/config/schema.ts`

**Status:** [x] Updated (Session 4)

**Previously missing (now fixed):**
- Fixed config key from `"mcp": { "servers": {} }` to top-level `mcpServers`
- Added discriminated union types: `type: "local"` (McpLocal) vs `type: "remote"` (McpRemote)
- Added auto-inference: `command` → local, `url` → remote
- Added complete OAuth documentation: auto-discovery, manual config (`clientId`, `clientSecret`, `scope`), disable (`oauth: false`)
- Added all schema fields: `timeout`, `disabled`, `headers`, `env`, `args`
- Added `.mcp.json` project-level config with Claude Code compatibility
- Added MCP server status states: `connected`, `disabled`, `failed`, `needs_auth`, `needs_client_registration`
- Added tool naming convention (`{server}_{tool}` with sanitization)
- Added environment variable expansion (`${VAR}` and `${VAR:-default}`)
- Added lifecycle management (startup, process tracking, reconnection, shutdown)
- Added agent-scoped MCP servers
- Added global timeout via `experimental.mcp_timeout`

---

### 9. `docs/architecture/context-memory.md` → `src/session/engine/`, `src/platform/`, `src/agent/memory.ts`

**Status:** [x] Updated (Session 5)

**Thin page, missing:**
- Section registry details (`section-registry.ts`, `section-parser.ts`)
- Full instruction loading chain details (what `instruction.ts` actually does)
- Platform profile details (how `src/platform/profile.ts` works, which profiles exist in `src/platform/profiles/`)
- Memory tool details (readMemory, writeMemory, editMemory internals)
- Memory path construction

---

### 10. `docs/architecture/security-model.md` → `src/permission/`, `src/auth/`, `src/isolation/`

**Status:** [x] Updated (Session 5)

**Thin page, missing:**
- `arity.ts` — Permission arity (single vs batch)
- `classifier.ts` — Auto-classification logic
- `next.ts` — Next permission resolver
- `sandbox.ts` — Sandbox configuration
- `teammate-classifier.ts` — Already documented in coordinator-swarms.md, but not here
- Auth module (`src/auth/`) — Multiple auth providers (ai4all, code-assist, codex, copilot)
- Auth service (`src/auth/service.ts`)
- Isolation registry (`src/isolation/registry.ts`)

---

### 11-18. Remaining Sections

**Status:** [x] All complete (Sessions 6-9)

- `transport-channels.md` — Added 21 routes, middleware order, mDNS conditions
- `coordinator-swarms.md` — 17 modules, teammate types/events/context, swarm messages, permission bridge
- `telemetry.md` — Langfuse, exporter factories, Perfetto, OTLP config
- `feature-status.md` — Tool count (35), hook types updated
- `getting-started/*` — Fixed memory paths, env vars, permission modes (6 modes)
- `build/*` — Fixed telemetry config in troubleshoot-performance
- `reference/*` — Added missing routes to channels-reference
- `platforms/*` — Fixed CSRF header in remote-control

---

## Roadmap Cross-References

The following roadmap documents should be reflected in docs:

| Roadmap Doc | Docs Coverage |
|---|---|
| `roadmap/agents-platform-roadmap.md` | Partially in `docs/architecture/coordinator-swarms.md` |
| `roadmap/core_features/00-index.md` | Source map — useful for future audits |
| `roadmap/core_features/06-context-memory.md` | Partially in `docs/roadmap/context-memory-roadmap.md` |
| `roadmap/project-scoped-persistence/` | Not reflected in docs |
| `roadmap/hosted-language-proxy/` | Not reflected in docs |
| `roadmap/liteagent-framework/` | Not reflected in docs |
| `roadmap/ai-tutor-platform/` | Not reflected in docs |
| `roadmap/thinking_loop_analysis.md` | Not reflected in docs |

---

## Session Log

| Session | Date | Work Done |
|---|---|---|
| 1 | 2026-05-12 | Created tracker. Updated `settings.md` and `environment-variables.md` |
| 2 | 2026-05-13 | Updated `tools-reference.md` (35 tools) and `provider-system.md` (20+ providers) |
| 3 | 2026-05-13 | Updated `system-overview.md` (47+ modules) and `session-engine.md` (event-sourced architecture) |
| 4 | 2026-05-13 | Updated `hooks.md` (4 handler types, 23 events) and `mcp.md` (local/remote transports, OAuth) |
| 5 | 2026-05-13 | Rewrote `context-memory.md` and `security-model.md` |
| 6 | 2026-05-13 | Updated `transport-channels.md`, `coordinator-swarms.md`, `telemetry.md` |
| 7 | 2026-05-13 | Updated `feature-status.md`. Audited 11 getting-started pages |
| 8 | 2026-05-13 | Audited 12 build pages. Audited 8 reference pages |
| 9 | 2026-05-13 | Audited 5 platform pages. **All 18 items complete.** |
