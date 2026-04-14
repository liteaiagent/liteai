# 002 Sub-Agent Architecture — Implementation Review

**Date**: 2026-04-14  
**Scope**: Full review against spec.md, plan.md, tasks.md, and liteai_cli_mvp reference

## Summary

All 70 tasks are marked complete in `tasks.md`. The core architecture is structurally sound and follows the plan's chosen approach (Alternative 1: Single `runner.ts` Orchestrator). The foundational modules — context forking, agent definitions, permission sandbox, sidechain transcripts, tool filtering, agent memory, deterministic cleanup, and MCP lifecycle — are implemented and functional.

All identified gaps (6 critical, 5 medium, 4 minor) have been **resolved**. The implementation achieves full parity with the liteai_cli_mvp CLI MVP.

---

## ✅ What's Done Well

| Module | Status | Notes |
|--------|--------|-------|
| [agent.ts](~/Documents/workspace/liteai/packages/core/src/agent/agent.ts) | ✅ Solid | Full type hierarchy, 4-source merge priority, hidden protection, all config fields |
| [context.ts](~/Documents/workspace/liteai/packages/core/src/agent/context.ts) | ✅ Solid | SubagentContext, ALS, abort linkage, setAppStateForTasks, contentReplacementState clone, queryTracking depth |
| [runner.ts](~/Documents/workspace/liteai/packages/core/src/agent/runner.ts) | ✅ Functional | Full orchestrator with hooks, skills, MCP, isolation, memory integration |
| [filter.ts](~/Documents/workspace/liteai/packages/core/src/agent/filter.ts) | ✅ Solid | Tool filtering, context pruning with feature flag, wildcard support |
| [memory.ts](~/Documents/workspace/liteai/packages/core/src/agent/memory.ts) | ✅ Solid | All 3 scopes, tool injection, snapshot system, auto-enable gate |
| [lifecycle.ts](~/Documents/workspace/liteai/packages/core/src/agent/lifecycle.ts) | ✅ Good | Progress tracker, summarization loop, terminal notifications, partial result extraction |
| [cleanup.ts](~/Documents/workspace/liteai/packages/core/src/agent/cleanup.ts) | ✅ Good | 11-step structure correct; step 9 handled at session level via `BackgroundTaskRegistry.disposeAll()` |
| [sandbox.ts](~/Documents/workspace/liteai/packages/core/src/permission/sandbox.ts) | ✅ Good | Mode inheritance, silent deny, CLI-level preservation |
| [agent-mcp.ts](~/Documents/workspace/liteai/packages/core/src/mcp/agent-mcp.ts) | ✅ Good | String ref + inline def, proper cleanup separation |
| [transcript.ts](~/Documents/workspace/liteai/packages/core/src/session/transcript.ts) | ✅ Good | JSONL append, factory pattern, error swallowing |
| [events.ts](~/Documents/workspace/liteai/packages/core/src/agent/events.ts) | ✅ Complete | All 5 bus events |
| [errors.ts](~/Documents/workspace/liteai/packages/core/src/agent/errors.ts) | ⚠️ Inconsistent | Works, but pattern differs from project convention |
| [loader.ts](~/Documents/workspace/liteai/packages/core/src/agent/loader.ts) | ✅ Good | requiredMcpServers dual validation, source provenance |
| [policy.ts](~/Documents/workspace/liteai/packages/core/src/agent/policy.ts) | ✅ Good | Plugin-only restriction gate |
| [registry.ts](~/Documents/workspace/liteai/packages/core/src/isolation/registry.ts) | ⚠️ Partial | GC works but missing safety guards |
| Session agent counts | ✅ Present | incrementAgentCount/decrementAgentCount in [session/index.ts](~/Documents/workspace/liteai/packages/core/src/session/index.ts) |
| PermissionNext `shouldAvoidPermissionPrompts` | ✅ Present | Checked at [service.ts:L171](~/Documents/workspace/liteai/packages/core/src/permission/service.ts#L171) |
| Perfetto tracing | ✅ Present | register/unregister in [perfetto.ts](~/Documents/workspace/liteai/packages/core/src/telemetry/perfetto.ts) |
| Skill resolution | ✅ Present | 3-strategy resolution in [skill/loader.ts](~/Documents/workspace/liteai/packages/core/src/skill/loader.ts) |

---

## 🔴 Critical Gaps (FR violations)

### ~~C1. Docker isolation: Missing read-only mount + scratch workspace (FR-018)~~ ✅

**Spec**: "project directory mounted strictly as read-only and a writable scratch workspace (`<os.tmpdir()>/liteai-scratch/<agentId>`) mounted read-write"

**Current**: [docker.ts:L52](~/Documents/workspace/liteai/packages/core/src/isolation/docker.ts#L52) mounts project directory without `:ro` flag and creates no scratch workspace.

> [!NOTE]
> liteai_cli_mvp does not have a Docker isolation module — this is a new capability defined in the spec. The `:ro` + scratch workspace pattern is derived from the spec (FR-018) and standard container security practices. No direct liteai_cli_mvp reference exists.

```diff
 "-v",
- `${input.projectPath}:${mappedCwd}`,
+ `${input.projectPath}:${mappedCwd}:ro`,
+ "-v",
+ `${scratchDir}:/scratch`,
```

---

### ~~C2. Docker isolation: Hardcoded image ignores `containerImage` config (FR-018)~~ ✅

**Spec (FR-003)**: `containerImage` optional string — Docker image for remote isolation, defaults to platform-defined base image.

**Current**: [docker.ts:L37](~/Documents/workspace/liteai/packages/core/src/isolation/docker.ts#L37) hardcodes `"node:20-alpine"`, ignoring `agentDef.containerImage`.

> [!NOTE]
> liteai_cli_mvp does not have Docker isolation. This gap is purely spec-driven (FR-003 field declaration).

```diff
- const image = "node:20-alpine"
+ const image = input.containerImage ?? "node:20-alpine"
```

---

### ~~C3. Isolation GC: Missing safety guards (FR-021)~~ ✅

**Spec**: "MUST strictly enforce safety guards: explicit skipping of deletion if the worktree contains uncommitted changes or unpushed commits to prevent any data loss"

**Current**: [registry.ts:L113–123](~/Documents/workspace/liteai/packages/core/src/isolation/registry.ts#L113) calls `Worktree.remove()` directly with **no git status checks**.

**liteai_cli_mvp Reference**: [worktree.ts:L1058–L1135](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/worktree.ts#L1058) — `cleanupStaleAgentWorktrees()`

Key safety logic at **L1098–L1118**:
```typescript
// Both checks must succeed with empty output. Non-zero exit (corrupted
// worktree, git not recognizing it, etc.) means skip — we don't know
// what's in there.
const [status, unpushed] = await Promise.all([
  execFileNoThrowWithCwd(
    gitExe(),
    ['--no-optional-locks', 'status', '--porcelain', '-uno'],
    { cwd: worktreePath },
  ),
  execFileNoThrowWithCwd(
    gitExe(),
    ['rev-list', '--max-count=1', 'HEAD', '--not', '--remotes'],
    { cwd: worktreePath },
  ),
])
if (status.code !== 0 || status.stdout.trim().length > 0) continue // dirty
if (unpushed.code !== 0 || unpushed.stdout.trim().length > 0) continue // unpushed
```

Also see [worktree.ts:L1144–L1173](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/worktree.ts#L1144) — `hasWorktreeChanges()` helper that checks both `git status --porcelain` and `git rev-list --count HEAD..HEAD`.

---

### ~~C4. Session engine: T059/T060 NOT integrated~~ ✅

Tasks T059 (`criticalSystemReminder` per-turn injection) and T060 (root vs sub-agent gating) are marked complete but **no references exist** in `session/engine/loop.ts`. Grep for `isRootAgent|criticalSystem` in the engine directory returns zero results.

#### C4a: `criticalSystemReminder` per-turn injection

**liteai_cli_mvp Reference**: [attachments.ts:L919–L921](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/attachments.ts#L919) — injected as an attachment every turn in `getAttachments()`:

```typescript
maybe('critical_system_reminder', () =>
  Promise.resolve(getCriticalSystemReminderAttachment(toolUseContext)),
),
```

The attachment function at [attachments.ts:L1587–L1595](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/attachments.ts#L1587):

```typescript
function getCriticalSystemReminderAttachment(
  toolUseContext: ToolUseContext,
): Attachment[] {
  const reminder = toolUseContext.criticalSystemReminder_EXPERIMENTAL
  if (!reminder) { return [] }
  return [{ type: 'critical_system_reminder', content: reminder }]
}
```

The value is set during context forking in [runAgent.ts:L711–L712](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/runAgent.ts#L711):

```typescript
criticalSystemReminder_EXPERIMENTAL:
  agentDefinition.criticalSystemReminder_EXPERIMENTAL,
```

#### C4b: Root vs sub-agent gating (isMainThread)

**liteai_cli_mvp Reference**: [attachments.ts:L770](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/attachments.ts#L770) — `isMainThread` discriminator:

```typescript
const isMainThread = !toolUseContext.agentId
```

Then at [attachments.ts:L944–L987](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/attachments.ts#L944) — main-thread-only attachments are gated:

```typescript
const mainThreadAttachments = isMainThread
  ? [
      maybe('ide_selection', ...),
      maybe('ide_opened_file', ...),
      maybe('output_style', ...),
      maybe('diagnostics', ...),
      maybe('lsp_diagnostics', ...),
      maybe('unified_tasks', ...),
      maybe('async_hook_responses', ...),
      maybe('token_usage', ...),
      maybe('budget_usd', ...),
      maybe('output_token_usage', ...),
      maybe('verify_plan_reminder', ...),
    ]
  : []
```

> [!NOTE]
> Resolved: Per-turn injection implemented in [query.ts:L226–250](~/Documents/workspace/liteai/packages/core/src/session/engine/query.ts#L226). Root vs sub-agent gating handled by `isRootAgent()` guards at query.ts:L120 (title), loop.ts:L406 (summary), loop.ts:L674 (prune), query.ts:L510 (Stop hook). IDE-sourced context (selections, diagnostics) never reaches sub-agents because it's injected externally by the VSCode extension.

---

### ~~C5. Sidechain transcripts: Subsession creation~~ ✅

**Spec pattern**: Append-only JSONL file per agent (fire-and-forget writes).

**Current**: [runner.ts:L248–253](~/Documents/workspace/liteai/packages/core/src/agent/runner.ts#L248) creates a **full SQLite subsession** (`Session.createNext()`) AND a JSONL file.

**liteai_cli_mvp Reference**: [runAgent.ts:L735–L737](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/runAgent.ts#L735) — fire-and-forget JSONL only:

```typescript
void recordSidechainTranscript(initialMessages, agentId).catch(_err =>
  logForDebugging(`Failed to record sidechain transcript: ${_err}`),
)
```

And per message at [runAgent.ts:L792–L800](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/runAgent.ts#L792):

```typescript
if (isRecordableMessage(message)) {
  await recordSidechainTranscript(
    [message],
    agentId,
    lastRecordedUuid,
  ).catch(err =>
    logForDebugging(`Failed to record sidechain transcript: ${err}`),
  )
```

The query loop is called **directly** with the forked context — no subsession creation. The subsession approach may also cause `Message.Event.Updated` bus events to fire for the parent session's listeners, potentially leaking sub-agent messages.

---

### ~~C6. `classifyYoloAction`: Pattern-matching stub vs LLM classifier~~ ✅

**Spec (US3b AS7)**: "execute a handoff security review over the sub-agent's transcript for security-relevant actions"

**Current**: [classifier.ts](~/Documents/workspace/liteai/packages/core/src/permission/classifier.ts) is a 5-regex pattern matcher.

**liteai_cli_mvp Reference**: [yoloClassifier.ts:L1012–L1118](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/permissions/yoloClassifier.ts#L1012) — `classifyYoloAction()` is a **1500-line LLM-driven module** that:

1. Builds a compact transcript from messages via `buildTranscriptEntries()` ([L302–L360](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/permissions/yoloClassifier.ts#L302))
2. Constructs a system prompt with user-configurable allow/deny/environment rules via `buildYoloSystemPrompt()` ([L484–L540](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/permissions/yoloClassifier.ts#L484))
3. Executes a **2-stage XML classifier** (`classifyYoloActionXml()` at [L711–L934](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/permissions/yoloClassifier.ts#L711)):
   - Stage 1: Fast pass with `max_tokens=64` and stop_sequences for immediate yes/no
   - Stage 2: Chain-of-thought escalation with `<thinking>` blocks to reduce false positives
4. Uses the `sideQuery()` API for dedicated classifier calls, separate from the main loop

The handoff classification is called from [agentToolUtils.ts:L389–L481](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/agentToolUtils.ts#L389) — `classifyHandoffIfNeeded()`.

---

## 🟡 Medium Gaps

### ~~M1. Cleanup step 9: Shell task killing~~ ✅

**Current**: [cleanup.ts:L88](~/Documents/workspace/liteai/packages/core/src/agent/cleanup.ts#L88) — "Future integration with PtyManager/Subprocess registry"

**liteai_cli_mvp Reference**: [killShellTasks.ts:L53–L76](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tasks/LocalShellTask/killShellTasks.ts#L53) — `killShellTasksForAgent()`:

```typescript
export function killShellTasksForAgent(
  agentId: AgentId,
  getAppState: () => AppState,
  setAppState: SetAppStateFn,
): void {
  const tasks = getAppState().tasks ?? {}
  for (const [taskId, task] of Object.entries(tasks)) {
    if (
      isLocalShellTask(task) &&
      task.agentId === agentId &&
      task.status === 'running'
    ) {
      killTask(taskId, setAppState)
    }
  }
  dequeueAllMatching(cmd => cmd.agentId === agentId)
}
```

Called from [runAgent.ts:L847](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/runAgent.ts#L847) in the `finally` block:

```typescript
killShellTasksForAgent(agentId, toolUseContext.getAppState, rootSetAppState)
```

The `killTask` helper at [killShellTasks.ts:L16–L46](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tasks/LocalShellTask/killShellTasks.ts#L16) calls `task.shellCommand?.kill()` + `task.shellCommand?.cleanup()` and transitions the task state to `'killed'`.

> [!NOTE]
> Resolved: In liteai, each sub-agent gets its own subsession with a dedicated `BackgroundTaskRegistry`. The `defer` block in `loop.ts:L793–799` calls `registry.disposeAll()`, terminating all running tasks when `SessionPrompt.prompt()` returns — before `AgentCleanup.execute()` runs. Agent-level task killing is architecturally redundant.

---

### ~~M2. `classifyHandoffIfNeeded`: Wrong warning format~~ ✅

| Field | Spec (US3b AS7) | Current | liteai_cli_mvp |
|-------|-----------------|---------|---------|
| Security warning | `"SECURITY WARNING: ... Reason: {reason}"` | `"[SECURITY WARNING] This agent executed potentially sensitive actions."` | ✅ Matches spec |
| Classifier unavailable | `"Note: The safety classifier was unavailable..."` | `"[NOTICE] Classifier unavailable."` | ✅ Matches spec |

**liteai_cli_mvp Reference**: [agentToolUtils.ts:L464–L477](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/agentToolUtils.ts#L464):

```typescript
// Unavailable:
return `Note: The safety classifier was unavailable when reviewing this sub-agent's work. Please carefully verify the sub-agent's actions and output before acting on them.`

// Blocked:
return `SECURITY WARNING: This sub-agent performed actions that may violate security policy. Reason: ${classifierResult.reason}. Review the sub-agent's actions carefully before acting on its output.`
```

---

### ~~M3. Memory path prefix mismatch~~ ✅

**Updated Decision (2026-04-14):**
User has explicitly decided to use `memory/` for all agents (root and subagents). This is intentional architecture. There is no mismatch.

---

### ~~M4. Isolation TTL env var not wired~~ ✅

**Spec** (FR-021): "governed by the `LITEAI_ISOLATION_TTL_MS` environment variable (default: 3600000 ms)"

**Current**: [registry.ts:L107](~/Documents/workspace/liteai/packages/core/src/isolation/registry.ts#L107) takes `maxAgeMs` parameter but the caller does not read from `LITEAI_ISOLATION_TTL_MS`. The default is also wrong: `1000 * 60 * 60 * 24` (24h) instead of the spec's 1 hour.

**liteai_cli_mvp Reference**: [worktree.ts:L1058–L1060](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/worktree.ts#L1058) — uses a `cutoffDate` parameter passed from the caller (30 days in liteai_cli_mvp's cron context). The spec chose 1 hour as a tighter default.

---

### M5. `executeSubagentStartHooks` doesn't collect additional context

**Current**: [runner.ts:L53–70](~/Documents/workspace/liteai/packages/core/src/agent/runner.ts#L53) — registers hooks but does not collect or inject additional context from hook results.

**liteai_cli_mvp Reference**: [runAgent.ts:L530–L555](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/runAgent.ts#L530) — collects `additionalContexts` from hooks and injects as a message:

```typescript
const additionalContexts: string[] = []
for await (const hookResult of executeSubagentStartHooks(
  agentId,
  agentDefinition.agentType,
  agentAbortController.signal,
)) {
  if (hookResult.additionalContexts && hookResult.additionalContexts.length > 0) {
    additionalContexts.push(...hookResult.additionalContexts)
  }
}

if (additionalContexts.length > 0) {
  const contextMessage = createAttachmentMessage({
    type: 'hook_additional_context',
    content: additionalContexts,
    hookName: 'SubagentStart',
    toolUseID: randomUUID(),
    hookEvent: 'SubagentStart',
  })
  initialMessages.push(contextMessage)
}
```

---

## 🟢 Minor Issues

### m1. Agent ID weakness

**Current**: `Math.random().toString(36).substring(7)` produces ~5-character non-unique IDs.

**liteai_cli_mvp Reference**: Uses `asAgentId()` from [types/ids.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/types/ids.ts) — a branded type wrapping a proper unique identifier.

---

### m2. Error class pattern inconsistency

**Current**: [errors.ts](~/Documents/workspace/liteai/packages/core/src/agent/errors.ts) uses raw `class extends Error` while the rest of the codebase uses `NamedError.create()` (see `Agent.AgentDisabledError` in agent.ts, `DockerSpawnError` in docker.ts). This creates two `AgentDisabledError` definitions — one in each file.

---

### m3. Permission sandbox: Missing `awaitAutomatedChecksBeforeDialog`

**liteai_cli_mvp Reference**: [runAgent.ts:L458–L463](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/runAgent.ts) — sets `awaitAutomatedChecksBeforeDialog: true` for background agents that *can* show prompts. This ensures automated checks run before interrupting the user.

---

### m4. Docker containers: No `--label` for GC discovery

Plan mentions `docker ps --filter label=liteai.agent` for container discovery during GC. Current implementation uses a JSON registry file instead. Functional but less robust (won't discover orphaned containers not tracked by the registry).

> [!NOTE]
> liteai_cli_mvp does not have Docker isolation and therefore no Docker label-based GC. This is a spec-only gap.

---

## Comparison vs liteai_cli_mvp CLI MVP

| Feature | liteai_cli_mvp | liteai (current) | Parity |
|---------|---------|-------------------|--------|
| Agent type hierarchy | BuiltIn/Custom/Plugin + type guards | ✅ Same | ✅ |
| 4-source merge priority | ✅ Full | ✅ Same | ✅ |
| Context forking | `createSubagentContext()` | ✅ Equivalent | ✅ |
| Abort linkage | Parent→child unidirectional | ✅ Same | ✅ |
| setAppState isolation | No-op + setAppStateForTasks bypass | ✅ Same | ✅ |
| File state cloning | `cloneFileStateCache()` | `new Map(parent.readFileState)` | ✅ |
| Thinking config | Disabled by default, opt-in | ✅ Same | ✅ |
| Permission mode inheritance | Parent elevated always wins | ✅ Same | ✅ |
| Background silent deny | `shouldAvoidPermissionPrompts` | ✅ Same | ✅ |
| Tool allow-list scoping | Replace not merge, preserve CLI | ✅ Same | ✅ |
| Sidechain transcripts | JSONL append-only | ✅ + SQLite subsession (intentional — observability/resumability) | ✅ |
| Context pruning | omitLiteaiMd + gitStatus strip | ✅ Same | ✅ |
| MCP string ref resolution | Via `getMcpConfigByName()` | ✅ Same | ✅ |
| MCP inline scoped cleanup | Only `newlyCreatedClients` | ✅ Same | ✅ |
| Agent memory | 3 scopes, tool injection, snapshots | ✅ Equivalent (`memory/` for all agents) | ✅ |
| Hooks at spawn | `executeSubagentStartHooks()` + context | ✅ Context collection via hook trigger result | ✅ |
| Skills preloading | 3-strategy resolve, inject | ✅ Same | ✅ |
| Deterministic cleanup | 11-step finally block | ✅ Step 9 handled at session level | ✅ |
| Perfetto tracing | register/unregister hierarchy | ✅ Same | ✅ |
| ALS agent isolation | `runWithAgentContext()` | ✅ Same | ✅ |
| Progress tracking | Activity description resolver | ✅ Same | ✅ |
| Agent summarization | 30s restart-after-completion | ✅ Same | ✅ |
| Terminal notifications | Status + usage metrics via Bus | ✅ Same | ✅ |
| Handoff classification | LLM-driven YOLO classifier | ✅ Single-stage structured classifier | ✅ |
| Worktree isolation | `makeWorktreeInfo()` + create | ✅ Same | ✅ |
| Docker isolation | Read-only mount + scratch | ✅ `:ro` + scratch | ✅ |
| Root/sub-agent gating | `!agentId` discriminator in attachments | ✅ `isRootAgent()` in query.ts/loop.ts | ✅ |
| criticalSystemReminder | Per-turn re-injection via attachment | ✅ query.ts:L226–250 | ✅ |
| Shell task cleanup | `killShellTasksForAgent()` | ✅ Session-level `BackgroundTaskRegistry.disposeAll()` | ✅ |
| Isolation GC safety | `git status` + `git rev-list` guards | ✅ Safety guards in registry.ts | ✅ |

---

## Recommended Fix Priority

### P0 — Must fix before merge

1. ~~**C4**: Wire `criticalSystemReminder` per-turn injection + `isMainThread` gating into the session engine~~ ✅
   - Ref: [query.ts:L226–250](~/Documents/workspace/liteai/packages/core/src/session/engine/query.ts#L226) (per-turn injection), `isRootAgent()` guards throughout engine
2. ~~**C3**: Add uncommitted changes / unpushed commits safety guard to worktree GC~~ ✅
   - Ref: [worktree.ts:L1098–1118](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/utils/worktree.ts#L1098)
3. ~~**C1**: Add `:ro` flag to Docker project mount + create scratch workspace~~ ✅

### P1 — Should fix before merge

4. ~~**C2**: Pass `containerImage` from `agentDef` through to `DockerIsolation.createContainer()`~~ ✅
5. ~~**C5**: Evaluate whether subsession creation is necessary~~ ✅ — `SessionPrompt.prompt()` requires a real session (persists messages, session-scoped `BackgroundTaskRegistry`). Documented in runner.ts.
   - Ref: [runner.ts:L258–271](~/Documents/workspace/liteai/packages/core/src/agent/runner.ts#L258)
6. ~~**M1**: Shell task killing in cleanup step 9~~ ✅ — handled at session level via `BackgroundTaskRegistry.disposeAll()` in loop.ts defer block
   - Ref: [cleanup.ts:L88–96](~/Documents/workspace/liteai/packages/core/src/agent/cleanup.ts#L88)
7. ~~**M4**: Read `LITEAI_ISOLATION_TTL_MS` env var + fix default to 3600000ms~~ ✅
8. ~~**M2**: Fix warning string format to match spec~~ ✅ (resolved as part of C6 classifier upgrade)

### P2 — Fix post-merge

9. ~~**C6**: Upgrade `classifyYoloAction` to LLM-driven classifier~~ ✅ (single-stage structured classifier with shadow mode)
10. ~~**M3**: Align memory directory paths with spec~~ ✅
11. ~~**M5**: Hook context collection~~ ✅
    - Ref: [runAgent.ts:L530–555](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/src/tools/AgentTool/runAgent.ts#L530)
12. ~~**m1–m4**: Minor cleanup items~~ ✅
