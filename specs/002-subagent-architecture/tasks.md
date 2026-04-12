# Tasks: Sub-Agent Architecture

**Input**: Design documents from `/specs/002-subagent-architecture/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: Included — the spec's acceptance scenarios and success criteria explicitly require verifiable behavior across all user stories.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Monorepo**: `packages/core/src/` for source, `packages/core/test/` for tests
- Agent modules: `packages/core/src/agent/`
- Session modules: `packages/core/src/session/`
- All paths relative to repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Define error types, bus events, and config schema extensions that all user stories depend on.

- [x] T001 Define structured error types (`ConcurrentAgentLimitError`, `AgentDisabledError`, `McpConnectionError`, `RequiredMcpServerError`, `AgentSpawnError`, `AgentTimeoutError`) in `packages/core/src/agent/errors.ts`
- [x] T002 [P] Define agent bus events (`agent.spawned`, `agent.completed`, `agent.progress`, `liteai_cache_eviction_hint`) using `BusEvent.define()` with zod schemas per contracts/agent-api.md in `packages/core/src/agent/events.ts`. **Note**: `BusEvent.define()` is pre-existing infrastructure at `@/bus/bus-event` — no prerequisite task required
- [x] T003 [P] Extend `Agent` schema in `packages/core/src/config/schema.ts` with new fields: `tools` (string[] | Record<string, boolean>), `disallowedTools` (string[]), `skills` (string[]), `hooks` (object), `mcpServers` (array/object), `model` (string/object), `permissionMode` (string), `thinking` (boolean, default: false), `thinkingBudget` (number), `criticalSystemReminder` (string), `timeout` (number, default: 1800000), `maxTurns` (number, frontmatter alias: `steps`), `requiredMcpServers` (string[]), `omitLiteaiMd` (boolean, default: false), `initialPrompt` (string), `isolation` (string enum), `containerImage` (string, Docker image for remote isolation), `effort` (string enum: `'low' | 'medium' | 'high' | 'max'`), `background` (boolean, default: false), `memory` (string enum: `'user' | 'project' | 'local'`) — all optional
- [x] T004 Add new config fields to the `knownKeys` set in the Agent schema transform function in `packages/core/src/config/schema.ts` to prevent them from being shunted into `options`. **Runs sequentially after T003** (cannot run in parallel — knownKeys entries reference fields defined in T003)
- [x] T064 [P] Add concurrent agent limit tracking per session in `packages/core/src/session/index.ts` — expose `incrementAgentCount()` / `decrementAgentCount()` / `getAgentCount()` on Session used by `runAgent()` for limit enforcement

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T005 Implement `AgentExecutionContext` using `AsyncLocalStorage<AgentContext>` with `SubagentContext` and `TeammateAgentContext` discriminated union types, `runWithAgentContext()`, and `consumeInvokingRequestId()` in `packages/core/src/agent/context.ts`
- [x] T006 [P] Implement root vs sub-agent discriminator utility: `isRootAgent()` returns `true` when `agentId` is `undefined` on execution context, for use as a gating predicate in `packages/core/src/agent/context.ts`
- [x] T007 [P] Implement `AgentDefinition` type hierarchy — `BaseAgentDefinition`, `BuiltInAgentDefinition`, `CustomAgentDefinition`, `PluginAgentDefinition` union with type guards (`isBuiltInAgent`, `isCustomAgent`, `isPluginAgent`) in `packages/core/src/agent/agent.ts`
- [x] T007a [P] Define `RunAgentResult` type in `packages/core/src/agent/agent.ts` 
- [x] T008 Extend `Agent.Info` in `packages/core/src/agent/agent.ts` to include the new config fields
- [x] T009 [P] Extend `AgentLoader` in `packages/core/src/agent/loader.ts` to track source provenance
- [x] T010 Write tests for `AgentExecutionContext` ALS isolation in `packages/core/test/agent/context.test.ts`
- [x] T011 Write tests for `AgentDefinition` type guards, `Agent.Info` field population from config in `packages/core/test/agent/agent.test.ts`

**Checkpoint**: Foundation ready — user story implementation can now begin in parallel.

---

## Phase 3: User Story 1 — Context-Aware Sub-Agent Spawning (Priority: P1) 🎯 MVP

**Goal**: Enable spawning sub-agents with isolated execution contexts that selectively inherit parent state, with abort linkage, wall-clock timeout, and concurrent agent limits.

**Independent Test**: Spawn a sub-agent within an active session, verify file state inheritance, message isolation, abort linkage, and parent state immutability after sub-agent completion.

### Tests for User Story 1

- [x] T012 [P] [US1] Write context forking tests: state isolation, abort linkage, setAppState no-op, file state cloning, thinking config disabled by default, setAppStateForTasks scoping, queryTracking depth increment in `packages/core/test/agent/context.test.ts`
- [x] T013 [P] [US1] Write runner integration tests: spawn lifecycle, concurrent limit enforcement, wall-clock timeout abort, RunAgentResult for all terminal states (completed/failed/killed), nested spawning verification (Agent A spawns Agent B — verify 2-level isolation, abort propagation through chain, parent state immutability), and verify `executeSubagentStartHooks` and `resolveSkillName` integrations run properly at spawn time in `packages/core/test/agent/runner.test.ts`

### Implementation for User Story 1

- [x] T014 [US1] Implement `SubagentContext` type and `createSubagentContext()` factory function — selective clone of `readFileState` (shallow Map clone), child `AbortController` linked to parent, wrapped `getAppState` with `shouldAvoidPermissionPrompts`, no-op `setAppState`, fresh `toolDecisions`, `thinkingConfig` disabled by default (unless `thinking: true`, then inherit parent config but replace `budgetTokens` with agent's `thinkingBudget` if specified), effort level override (when agent config specifies `effort`, replace forked context's effort with agent's value), scoped `setAppStateForTasks` (registerTask/killTask/deleteTodo only), and capture context root `cwd` tied to target isolation boundaries in `packages/core/src/agent/context.ts`
- [x] T015 [US1] Implement `SubagentContextOverrides` support in `createSubagentContext()`: `shareSetAppState` (MUST delegate directly to parent's `setAppState`, bypassing the no-op wrapper), `shareSetResponseLength`, `shareAbortController`, `criticalSystemReminder` passthrough in `packages/core/src/agent/context.ts`
- [x] T016 [US1] Implement `runAgent()` orchestrator in `packages/core/src/agent/runner.ts` — spawn lifecycle: validate agent enabled, check concurrent limit, `createSubagentContext()`, wrap entire execution in `runWithAgentContext()` for ALS isolation, delegate to query loop (enforcing `maxTurns` and aborting if turn limit exceeded), capture `RunAgentResult`, return result with usage metrics. Additionally, implement the agent tool registration that calls `runAgent()` and converts the `RunAgentResult` into the LLM-facing string block (e.g. `<task_result>...`) format for the tool registry. For killed/timed-out terminal states, use a **phase-local stub** for `extractPartialResult` inlined in `runner.ts` (scan messages in reverse for last assistant text, truncate to 2000 chars). **DO NOT refactor early — this stub is intentional; T037 (Phase 6) replaces it by moving the implementation to `lifecycle.ts` and updating the import**
- [x] T017 [US1] Implement wall-clock timeout via `setTimeout` + `abortController.abort()` in `runAgent()` — configurable per agent (default: 1800000ms), clear timeout in finally block in `packages/core/src/agent/runner.ts`
- [x] T018 [US1] Implement concurrent agent limit enforcement: atomic counter per session, check at spawn time, `ConcurrentAgentLimitError` on exceed, decrement in finally block in `packages/core/src/agent/runner.ts`
<!-- T019: Merged into T016 (runner orchestrator handles both spawn lifecycle and result capture) -->
- [x] T020 [US1] Add sub-agent system prompt construction: invoke `SectionRegistry` resolver for the sub-agent's model context, independent of parent's prompt cache, in `packages/core/src/session/engine/system.ts`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable — sub-agents spawn with isolated contexts, inherit file state, have linked abort controllers, enforce concurrent limits, and respect wall-clock timeouts.

---

## Phase 4: User Story 2 — Typed Agent Definitions with Source Priority (Priority: P2)

**Goal**: Load agents from multiple sources (built-in, plugin, user, project) with deterministic merge priority, expanded config fields, hooks at spawn, skills preloading, and requiredMcpServers validation.

**Independent Test**: Define agents across all four source levels, verify merge priority produces correct final config, and confirm expanded fields are parsed and available at runtime.

### Tests for User Story 2

- [x] T021 [P] [US2] Write agent definition merge priority tests: 4-source override ordering, field-by-field merge, hidden agent protection, disabled agent rejection in `packages/core/test/agent/agent.test.ts`
- [x] T022 [P] [US2] Write requiredMcpServers validation tests: load-time filtering (agent excluded when server disconnected), spawn-time re-validation (structured error on stale reference) in `packages/core/test/agent/agent.test.ts`

### Implementation for User Story 2

- [x] T023 [US2] Implement `getActiveAgentsFromList()` with deterministic priority ordering (`builtIn < plugin < userSettings < projectSettings`), field-by-field merge for matching `agentType` identifiers, and hidden agent protection in `packages/core/src/agent/agent.ts`
- [x] T024 [US2] Implement `requiredMcpServers` dual validation: (1) load-time filtering in `AgentLoader` to exclude agents when required servers are disconnected or have no tools, (2) spawn-time re-validation in `runAgent()` with `RequiredMcpServerError` in `packages/core/src/agent/loader.ts` and `packages/core/src/agent/runner.ts`
- [x] T024a [US2] Implement `isRestrictedToPluginOnly(resourceType)` utility in `packages/core/src/agent/policy.ts` to govern admin-trusted resource boundaries (like `hooks` and `mcp`).
- [x] T025 [P] [US2] Implement `executeSubagentStartHooks()` at spawn time in `packages/core/src/agent/runner.ts` — register agent-declared hooks with `isAgent=true` flag, convert `Stop` → `SubagentStop` events, enforce admin-trust gating via `isRestrictedToPluginOnly('hooks')`, and wire `clearSessionHooks(agentId)` into cleanup
- [x] T026 [P] [US2] Implement skill preloading at spawn time in `packages/core/src/agent/runner.ts` — resolve skills via `resolveSkillName()` with 3-strategy namespace resolution (exact → plugin-prefix → suffix match), load and inject into agent's initial messages, wire `clearInvokedSkillsForAgent(agentId)` into cleanup
- [x] T027 [US2] Extend `resolveSkillName()` with 3-strategy namespace-aware lookup in `packages/core/src/skill/loader.ts` — exact match, plugin-prefix match (`pluginId/skillName`), suffix match; silently skip with debug log if all fail

### US6c — Agent Persistent Memory (grouped here: memory is an agent config extension loaded at spawn time)

- [x] T028a [P] [US6c] Write agent memory tests: scope resolution (`user`/`project`/`local` paths), `loadAgentMemoryPrompt()` injection with scope-specific guidelines, `isAgentMemoryPath()` path traversal prevention, `ensureMemoryDirExists()` idempotent creation, Read/Write/Edit tool auto-injection when `memory` configured in `packages/core/test/agent/memory.test.ts`
- [x] T028 [US6c] Implement agent memory module: `getAgentMemoryDir()`, `loadAgentMemoryPrompt()`, `isAgentMemoryPath()`, `ensureMemoryDirExists()`, and implement `isAutoMemoryEnabled()` resolving the multi-source fallback sequence (`LITEAI_DISABLE_AUTO_MEMORY` env var -> headless mode checks -> project settings -> default enabled). Auto-inject Read/Write/Edit memory tools in `packages/core/src/agent/memory.ts` when enabled
- [x] T028b [P] [US6c] Implement agent memory snapshot system in `packages/core/src/agent/memory.ts` — `checkAgentMemorySnapshot()` to detect newer project-level snapshots, `copyProjectSnapshotToLocal()` to seed local memory from project snapshots, gated by `AGENT_MEMORY_SNAPSHOT` feature flag. Add snapshot detection and copy tests to `packages/core/test/agent/memory.test.ts`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently — agents load with correct merge priority, support all expanded config fields, execute hooks and preload skills at spawn time, and validate required MCP servers.

---

## Phase 5: User Story 3 — Permission Sandboxing for Background Agents (Priority: P3)

**Goal**: Background agents silently deny permission-requiring operations. Mode inheritance prevents escalation. Tool allow-lists replace, not merge, parent permissions.

**Independent Test**: Spawn a background sub-agent invoking a permission-requiring tool, verify immediate denial without blocking. Verify tool allow-lists replace parent permissions.

### Tests for User Story 3

- [x] T029 [P] [US3] Write permission sandbox tests: background silent deny, mode inheritance precedence (parent bypass overrides child plan), tool allow-list replacement (not merge), bubble mode prompt passthrough, CLI-level rule preservation in `packages/core/test/permission/sandbox.test.ts`

### Implementation for User Story 3

- [x] T030 [US3] Implement `PermissionSandbox.apply()` in `packages/core/src/permission/sandbox.ts` — mode inheritance logic (parent elevated modes like `bypass`, `auto`, `acceptEdits` always take precedence), background silent-deny (`shouldAvoidPermissionPrompts: true`), bubble mode support, and `SandboxOptions` interface
- [x] T031 [US3] Implement tool allow-list scoping in `packages/core/src/permission/sandbox.ts` — when an agent declares `tools` as an allow-list, replace session-level tool decisions entirely (not merge); preserve CLI-level (`cliArg`) rules from SDK `--allowedTools`
- [x] T032 [US3] Extend `PermissionNext` service in `packages/core/src/permission/service.ts` to support `shouldAvoidPermissionPrompts` context flag — when true, any permission check that would prompt returns immediate denial with structured error reason
- [x] T033 [US3] Integrate `PermissionSandbox.apply()` into `runAgent()` — apply sandboxing after context forking, before query loop start in `packages/core/src/agent/runner.ts`

**Checkpoint**: At this point, User Story 3 should be fully functional — background agents never block on permissions, parent modes take precedence, and tool lists are properly scoped.

---

## Phase 6: User Story 3b — Background Agent Lifecycle & Observability (Priority: P3)

**Goal**: Background agents have structured lifecycle management: progress tracking, terminal notifications with usage metrics, partial result extraction, and isolated analytics via AsyncLocalStorage.

**Independent Test**: Spawn 3 concurrent background agents, verify isolated analytics, independent progress tracking, and correct terminal notifications with usage metrics.

### Tests for User Story 3b

- [x] T034 [P] [US3b] Write lifecycle tests: progress tracking, terminal notification status variants (completed/failed/killed), partial result extraction for killed agents, usage metrics accuracy, 3-agent concurrent ALS isolation, terminal notification timing (assert notification enqueued within 1000ms of terminal state per SC-008), and handoff security reviews (assert proper `classifyHandoffIfNeeded` warning injection logic) in `packages/core/test/agent/lifecycle.test.ts`

### Implementation for User Story 3b

- [x] T035 [US3b] Implement `ProgressTracker` in `packages/core/src/agent/lifecycle.ts` — `createActivityDescriptionResolver()` mapping tool names to human-readable descriptions, `currentActivity` tracking, per-tool-call update
- [x] T036 [US3b] Implement terminal notification system in `packages/core/src/agent/lifecycle.ts` — `enqueueAgentNotification()` with `TerminalNotification` type: status (completed/failed/killed), description, `UsageMetrics` (tokens, tool calls, duration, optional worktreeInfo), error/partialResult fields
- [x] T037 [US3b] Implement `extractPartialResult()` in `packages/core/src/agent/lifecycle.ts` — extract last meaningful assistant text from the agent's message chain for killed agents, enforce strict truncation to 2000 chars. **Replaces** the inline stub introduced in T016: move the implementation to `lifecycle.ts`, export it, update the import in `runner.ts` to point to `lifecycle.ts`, and delete the inline stub
- [x] T038 [US3b] Implement `runAsyncAgentLifecycle()` wrapper in `packages/core/src/agent/lifecycle.ts` — orchestrate background agent from spawn to terminal notification: wrap in `runWithAgentContext()`, attach `ProgressTracker`, emit Bus events, handle all terminal states, enqueue notification
- [x] T038a [US3b] Implement `classifyHandoffIfNeeded()` in `packages/core/src/agent/lifecycle.ts` — when a completed background agent was running in auto permission mode, execute a handoff security review over the sub-agent's transcript for security-relevant actions (file mutations, shell commands), gated by the `TRANSCRIPT_CLASSIFIER` feature flag (default: disabled). As part of this task, implement the new `classifyYoloAction` safety classifier logic ported from liteai2 in `packages/core/src/permission/classifier.ts`. Prepend security warning or classifier-unavailable notice to the task result text per US3b AS7
- [x] T038b [US3b] Implement `startAgentSummarization()` in `packages/core/src/agent/lifecycle.ts` — triggered via `onCacheSafeParams` callback for long-running background agents when `enableSummarization: true`. Use a **restart-after-completion loop** (not `setInterval`) so the next 30-second timer starts only after the previous summary call resolves — this prevents summary calls from overlapping. Each tick forks the agent's current transcript to produce a 3–5 word activity description and explicitly pushes it to the parent session's `rootSetAppState` (bypassing the sub-agent's no-op `setAppState` wrapper)
- [x] T038c [P] [US3b] Implement cache eviction signaling in `packages/core/src/agent/lifecycle.ts` — emit `liteai_cache_eviction_hint` bus event on agent completion to notify prompt cache layer of freed context
- [x] T039 [US3b] Integrate `runAsyncAgentLifecycle()` into `runAgent()` — when `isAsync: true`, delegate to lifecycle wrapper instead of inline execution in `packages/core/src/agent/runner.ts`

**Checkpoint**: At this point, User Story 3b should be fully functional — background agents have observable lifecycles with isolated analytics, progress, and structured notifications.

---

## Phase 7: User Story 4 — Sidechain Transcript Isolation (Priority: P4)

**Goal**: Sub-agent messages are recorded to isolated JSONL transcript files. Parent receives only the dense task result block.

**Independent Test**: Spawn a sub-agent producing 50+ messages, verify parent's chain contains only the task result block, and the full transcript exists as a separate JSONL file.

### Tests for User Story 4

- [x] T040 [P] [US4] Write sidechain transcript tests: message recording (append JSONL), file naming (`agent-<agentId>.jsonl`), subdir grouping, abort-safe partial transcript preservation, concurrent write isolation, and parent context growth verification (spawn sub-agents with 10/50/200 messages, assert parent message count delta is exactly 1 task_result block per SC-005) in `packages/core/test/session/transcript.test.ts`

### Implementation for User Story 4

- [x] T041 [US4] Implement `SidechainTranscript` namespace in `packages/core/src/session/transcript.ts` — `create()` factory, `getPath()` resolver (`<dir>/<sessionId>/subagents/<subdir>/agent-<agentId>.jsonl`), `recordMessage()` with `fs.appendFile()` for atomic appends (fire-and-forget safe, errors logged), `recordChain()` for batch append
- [x] T042 [US4] Implement `TranscriptMessage` type with `isSidechain: true` discriminator, `uuid`, `parentUuid`, `role`, `content`, `timestamp` fields in `packages/core/src/session/transcript.ts`
- [x] T043 [US4] Integrate sidechain recording into `runAgent()` — record initial messages before query loop, append each turn's messages with `lastRecordedUuid` for parent chain continuity, ensure only dense task result returns to parent in `packages/core/src/agent/runner.ts`

**Checkpoint**: At this point, User Story 4 should be fully functional — sub-agent transcripts are isolated in JSONL files, parent context stays lean.

---

## Phase 8: User Story 5 — Context Pruning for Read-Only Agents (Priority: P5)

**Goal**: Read-only agents have heavy context automatically stripped (project config, git status). Pruning is configurable and has a feature flag kill-switch.

**Independent Test**: Spawn an Explore agent with/without pruning, compare token consumption, verify pruned agent still answers correctly.

### Tests for User Story 5

- [ ] T044 [P] [US5] Write context pruning and tool filtering tests: `omitLiteaiMd` stripping, git status removal, user-provided context override preserved, feature flag kill-switch disables pruning, `filterToolsForAgent()` disallow lists, `resolveAgentTools()` wildcard expansion in `packages/core/test/agent/filter.test.ts`

### Implementation for User Story 5

- [ ] T045 [US5] Implement `filterToolsForAgent()` in `packages/core/src/agent/filter.ts` — define arrays for `ALL_AGENT_DISALLOWED_TOOLS`, `CUSTOM_AGENT_DISALLOWED_TOOLS`, and `ASYNC_AGENT_ALLOWED_TOOLS` internal to the module, then apply these allow/disallow filtering bounds; MCP tools always allowed
- [ ] T046 [US5] Implement `resolveAgentTools()` in `packages/core/src/agent/filter.ts` — validate agent tool specs against available tools, support wildcard expansion (`"*"`), extract `allowedAgentTypes` from `Agent(type1, type2)` syntax
- [ ] T047 [US5] Implement context pruning logic in `packages/core/src/agent/filter.ts` — `omitLiteaiMd` stripping (destructure out `liteaiMd` from userContext when flag set and no user override), git status stripping explicitly targeting read-only agents (`explore` and `plan` types), feature flag kill-switch (`liteai_slim_subagent_liteaimd` defaulting true)
- [ ] T048 [US5] Integrate context pruning into `runAgent()` — apply pruning after context forking based on agent config flags before entering query loop in `packages/core/src/agent/runner.ts`

**Checkpoint**: At this point, User Story 5 should be fully functional — read-only agents get pruned context, reducing token consumption.

---

## Phase 9: User Story 6 — Dynamic MCP Server Lifecycle (Priority: P6)

**Goal**: Agents declare MCP servers — string references reuse existing connections, inline definitions create new scoped connections. Only inline connections are cleaned up on exit.

**Independent Test**: Define an agent with both string ref and inline MCP, verify both active during execution, confirm only inline cleaned up on exit.

### Tests for User Story 6

- [ ] T049 [P] [US6] Write agent MCP lifecycle tests: string ref resolution (reuse existing), inline connection creation, cleanup (only inline), failed connection fail-fast, policy guard (`isRestrictedToPluginOnly`), concurrent shared connection isolation, and 1000-sequential-spawn stress test (spawn/exit with inline MCP, verify zero open connections post-test) — additionally for SC-004: assert that each inline MCP connection reports as closed within **5000ms** of `runAgent()` returning (use `Date.now()` delta between agent exit and connection closed event, assert `delta < 5000`) in `packages/core/test/mcp/agent-mcp.test.ts`

### Implementation for User Story 6

- [ ] T050 [US6] Implement `getMcpConfigByName()` lookup utility in `packages/core/src/mcp/index.ts` — resolve string MCP server references to existing project-wide connection configs
- [ ] T051 [US6] Implement `initializeAgentMcpServers()` in `packages/core/src/mcp/agent-mcp.ts` — string ref path (lookup via `getMcpConfigByName()`, reuse memoized `connectToServer()`), inline definition path (create new scoped connection, track in `newlyCreatedClients[]`), policy guard (`isRestrictedToPluginOnly('mcp')` blocks user-defined agents), return cleanup function
- [ ] T052 [US6] Implement `AgentMcpSession` cleanup function in `packages/core/src/mcp/agent-mcp.ts` — close only `newlyCreatedClients` (inline connections), leave referenced connections untouched, handle errors gracefully (log but don't throw)
- [ ] T053 [US6] Integrate `initializeAgentMcpServers()` into `runAgent()` — call after context forking, wire cleanup into finally block, fail-fast with `McpConnectionError` if any connection fails in `packages/core/src/agent/runner.ts`

**Checkpoint**: At this point, User Story 6 should be fully functional — agents bring their own MCP servers with proper lifecycle management.

---

## Phase 10: User Story 7 — Deterministic Cleanup Lifecycle (Priority: P7)

**Goal**: 12-step cleanup sequence in `finally` block: idempotent, non-throwing, releases all acquired resources (MCP, hooks, cache, file state, tracing, todos, shells, skills, debug dumps).

**Independent Test**: Spawn and kill 100 agents, verify zero resource leaks — no orphaned MCP connections, no stale perfetto entries, no zombie processes, memory within 10% of baseline.

### Tests for User Story 7

- [ ] T054 [P] [US7] Write cleanup lifecycle tests: all 11 steps execute even when individual steps fail, idempotent (double cleanup safe), non-throwing guarantee, resource release verification (file state cleared, messages released), rapid spawn/kill cycle stress test (verifying process memory strictly returns to within 10% of pre-test baseline per SC-007) in `packages/core/test/agent/cleanup.test.ts`

### Implementation for User Story 7

- [ ] T055 [US7] Implement `AgentCleanup.execute()` in `packages/core/src/agent/cleanup.ts` — 11-step sequence per contracts/agent-api.md: (1) MCP cleanup, (2) session hook removal, (3) prompt cache release, (4) file state clear, (5) context message reference release, (6) perfetto unregister, (7) transcript subdir cleanup, (8) pending todo deletion, (9) shell task killing, (10) monitor MCP cleanup, (11) invoked skill clearing — each step wrapped in try-catch
- [ ] T056 [US7] Extend perfetto tracing with `registerPerfettoAgent()` / `unregisterPerfettoAgent()` for hierarchical parent→child agent tracing in `packages/core/src/telemetry/perfetto.ts`
- [ ] T057 [US7] Extend hook system with `clearSessionHooks(agentId)` in `packages/core/src/hook/hook.ts` — remove all hooks registered by a specific agent ID from the session's hook list
- [ ] T058 [US7] Refactor `runAgent()` finally block to delegate to `AgentCleanup.execute()` with all acquired resources, replacing inline cleanup steps, in `packages/core/src/agent/runner.ts`

**Checkpoint**: At this point, User Story 7 should be fully functional — all agent exits trigger deterministic resource cleanup, no leaks.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Integration points, isolation modes, root/sub-agent gating, and documentation.

- [ ] T059 Implement `criticalSystemReminder` per-turn injection in `packages/core/src/session/engine/loop.ts` — read from `SubagentContext`, emit as `<system-reminder>` wrapped user message attachment after all other attachments on each turn
- [ ] T060 [P] Implement root vs sub-agent gating guards in `packages/core/src/session/engine/loop.ts` — use `isRootAgent()` discriminator to gate: title generation, stop hooks, MCP lifecycle notifications, attachment filtering (agent listing deltas, date change, MCP delta), compaction notifications, memory extraction
- [ ] T060a [P] Write worktree isolation tests: worktree creation from `makeWorktreeInfo()`, filesystem isolation from parent working directory, `IsolationArtifact` registration, TTL-based retention, lazy GC on session start; **US6b AS6 coverage**: assert worktree is created from current HEAD (not dirty working directory) — stage an uncommitted change in the parent repo, spawn a worktree agent, verify the staged change is absent from the worktree in `packages/core/test/isolation/worktree.test.ts`
- [ ] T060b [P] Write Docker isolation tests: container spawn via `docker run -d` (no `--rm` — TTL-based retention per FR-021), read-only project mount (assert write to project dir fails with permission error from within container), scratch workspace `<os.tmpdir()>/liteai-scratch/<agentId>` read-write (assert write succeeds), configurable container image override, Docker daemon availability check (assert `AgentSpawnError` is thrown when unreachable), TTL-based retention cleanup, lazy GC on session start in `packages/core/test/isolation/docker.test.ts`
- [ ] T061 [P] Implement `worktree` isolation mode integration in `packages/core/src/agent/runner.ts` — when agent declares `isolation: 'worktree'`, call `Worktree.makeWorktreeInfo()` + `Worktree.createFromInfo()` before agent spawn, register `IsolationArtifact` for retention-based GC
- [ ] T062 [P] Implement `remote` (Docker) isolation mode in `packages/core/src/isolation/docker.ts` — MUST verify Docker daemon availability before spawn and fail-fast with a structured `AgentSpawnError` if unreachable. Create a scratch workspace directory at `<os.tmpdir()>/liteai-scratch/<agentId>` before container spawn, and configure tool interception to route commands via `docker exec` against an established runtime container via `docker run -d` (no `--rm` — containers retained for TTL-based GC per FR-021). The project directory should be mounted read-only and the scratch workspace mounted read-write. Apply configurable container image, TTL-based retention, and lazy GC on session start, including cleanup of the scratch directory within the GC process
- [ ] T062a [P] [US6b] Modify the `shell` tool execution logic in `packages/core/src/tools/shell.ts` to accept an `execController` interception delegate from the `ToolUseContext`. Integrate with `runAgent()` so that when `isolation: 'worktree'` is active, the shell command's `cwd` is overridden to the worktree path before execution (filesystem redirection, no process-level isolation), and when `isolation: 'remote'` is active, shell commands are routed via `docker exec <containerId>` for full container-boundary execution
- [ ] T063 Implement `cleanupStaleIsolationArtifacts()` in `packages/core/src/isolation/registry.ts` — filesystem-scan-based GC following the liteai2 pattern, and wire it to `Session.create()` in `packages/core/src/session/index.ts` to trigger lazily on session start. Discover stale worktrees via naming conventions (ephemeral slug regex patterns) + `mtime` check against environment variable `LITEAI_ISOLATION_TTL_MS` (fallback to `3600000`), discover stale Docker containers via `docker ps --filter label=liteai.agent` + creation time check; safety guards (skip if git shows uncommitted changes or unpushed commits). **Depends on T061 and T062 — not parallelizable within Phase 11** (worktree artifact naming from T061 and Docker label format from T062 are required inputs for GC discovery).
- [ ] T068 [P] Write spawn latency benchmark: measure `createSubagentContext()` + `runAgent()` startup path (pre-query-loop) across 50 iterations with a standard agent config (0 inline MCP, no worktree, <50 cached files), assert p95 < 100ms per SC-001 in `packages/core/test/agent/benchmark.test.ts`
- [ ] T069 [P] Write token reduction verification: compare system prompt + context token count for an Explore agent with pruning enabled vs disabled, assert ≥30% reduction per SC-002 in `packages/core/test/agent/filter.test.ts` (extend existing)
- [ ] T070 [P] Write perfetto tracing tests: verify `registerPerfettoAgent()` records the correct `parentId` (`toolUseContext.agentId ?? getSessionId()`), verify parent-child relationship is correctly recorded in the trace tree, verify `unregisterPerfettoAgent()` removes the agent entry — covers FR-015 (hierarchical tracing metadata) in `packages/core/test/telemetry/perfetto.test.ts`
- [ ] T065 Run `bun typecheck` across all modified modules and fix any type errors
- [ ] T066 Run `bun lint:fix` across all modified modules and fix any formatting issues
- [ ] T067 Run scoped tests: `bun test test/agent/ test/mcp/ test/permission/ test/session/ test/isolation/` and verify all pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Stories (Phase 3–10)**: All depend on Foundational phase completion
  - US1 (Phase 3): No dependencies on other stories — start first
  - US2 (Phase 4): No hard dependency on US1, but benefits from runner.ts existing
  - US3 (Phase 5): Depends on US1 (context forking must exist for sandboxing)
  - US3b (Phase 6): Depends on US1 (runner.ts) + US3 (permission sandbox for async agents)
  - US4 (Phase 7): Depends on US1 (runner.ts must orchestrate recording)
  - US5 (Phase 8): No hard dependency, but benefits from US1 and US2
  - US6 (Phase 9): Depends on US1 (runner.ts for cleanup wiring)
  - US7 (Phase 10): Depends on all US1–US6 (cleans up their resources)
- **Polish (Phase 11)**: Depends on all user stories being complete
  - T061 (worktree isolation) and T062 (Docker isolation) must complete before T063 (isolation GC registry) — T063 depends on the artifact format and Docker label convention established by T061/T062

### User Story Dependencies

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundational) ──────────── BLOCKS ALL ────────────
    ↓                          ↓                           ↓
Phase 3 (US1: Spawning) ←─ MVP    Phase 8 (US5: Pruning)  │
    ↓         ↓          ↓                                 │
Phase 4    Phase 7    Phase 9                              │
(US2)     (US4:Txn)  (US6:MCP)                            │
    ↓                                                      │
Phase 5 (US3: Permissions)                                 │
    ↓                                                      │
Phase 6 (US3b: Lifecycle)                                  │
    ↓                                                      ↓
Phase 10 (US7: Cleanup) ←── depends on ALL user stories
    ↓
Phase 11 (Polish)
    ├─ T061 (worktree) ─┐
    ├─ T062 (docker)  ──┴─→ T063 (isolation GC registry)
    └─ T059, T060, T065–T069 (independent)
```

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Types/interfaces before implementations
- Core logic before integration with runner.ts
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel (T002, T003, T064). Note: T004 is NOT parallel — it runs sequentially after T003
- All Foundational tasks marked [P] can run in parallel (T006, T007, T009)
- Once Foundational completes, US5 (Pruning) can run in parallel with US1 (Spawning) since US5 is self-contained
- Test tasks within each phase marked [P] can run in parallel with each other
- T025 and T026 (hooks and skills) are independent and can run in parallel

---

## Parallel Example: User Story 1

```
# Launch all tests for US1 together:
Task T012: "Context forking tests in packages/core/test/agent/context.test.ts"
Task T013: "Runner integration tests in packages/core/test/agent/runner.test.ts"

# After T014 (core SubagentContext), these can run in parallel:
Task T015: "SubagentContextOverrides support in packages/core/src/agent/context.ts"
Task T020: "Sub-agent system prompt construction in packages/core/src/session/engine/system.ts"
```

## Parallel Example: Setup + Foundational

```
# Phase 1 — all [P] tasks in parallel:
Task T002: "Bus events in packages/core/src/agent/events.ts"
Task T003: "Config schema extension in packages/core/src/config/schema.ts"
Task T004: "knownKeys update in packages/core/src/config/schema.ts"

# Phase 2 — [P] tasks in parallel after Phase 1:
Task T006: "Root/sub-agent discriminator in packages/core/src/agent/context.ts"
Task T007: "AgentDefinition type hierarchy in packages/core/src/agent/agent.ts"
Task T009: "Source provenance tracking in packages/core/src/agent/loader.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (5 tasks)
2. Complete Phase 2: Foundational (7 tasks)
3. Complete Phase 3: User Story 1 — Context-Aware Spawning (9 tasks)
4. **STOP and VALIDATE**: Test sub-agent spawning independently
5. Deploy/demo if ready — sub-agents can spawn with isolated contexts

### Incremental Delivery

1. Setup + Foundational → Foundation ready (11 tasks)
2. Add US1 (Spawning) → Test → Deploy (MVP!)
3. Add US2 (Definitions) → Test → Deploy
4. Add US3 + US3b (Permissions + Lifecycle) → Test → Deploy
5. Add US4 (Transcripts) → Test → Deploy
6. Add US5 (Pruning) → Test → Deploy
7. Add US6 (MCP) → Test → Deploy
8. Add US7 (Cleanup) → Test → Deploy (full feature)
9. Polish → Final validation → Ship

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: US1 (Spawning) → US3 (Permissions) → US7 (Cleanup)
   - Developer B: US2 (Definitions) → US4 (Transcripts) → Polish
   - Developer C: US5 (Pruning) → US6 (MCP) → US3b (Lifecycle)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- All cleanup-related wiring in individual US phases feeds into the centralized cleanup module (US7)
- Agent memory (T028) is placed in US2 because it's an agent config extension loaded at spawn time
- Isolation modes (T061, T062) are in Polish because they require full runner + cleanup integration
