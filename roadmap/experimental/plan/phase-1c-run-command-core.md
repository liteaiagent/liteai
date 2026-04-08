# Phase 1c — `run_command` Async Lifecycle (Core Backend)

**Scope:** `packages/core` only — no UI, no SSE event changes, no engine rewiring.
**Goal:** Refactor run_command from blocking spawn-and-wait to async-first with three tools.

## What liteai2 Does (Reference)

liteai2's BashTool shows a rich terminal UI during command execution:

```
Running… (2s · timeout 2m)     ← ShellTimeDisplay: elapsed + timeout countdown
~200 lines                     ← line count estimate  
12.3 KB                        ← output size
(ctrl+b to run in background)  ← BackgroundHint
```

After backgrounding:
```
⏳ Waiting for background task cmd_abc123...
```

Agent gets notified via `task_notification` injection into the conversation when the task completes.

## What We're Building

Three tools backed by a session-scoped task registry:

### 1. Refactored `run_command`
- **New params:** `WaitMsBeforeAsync` (max 10s, replaces `timeout`), `cwd` (replaces `workdir`), `run_in_background`
- Spawn → race completion vs WaitMsBeforeAsync → return inline or background
- `ctx.metadata()` heartbeat while command runs (unchanged, already exists)

### 2. New `command_status` tool
- **Params:** `CommandId`, `WaitDurationSeconds` (max 300s), `OutputCharacterCount`
- Efficient sleep-until-done via completion waiter (no polling loop)

### 3. New `send_command_input` tool  
- **Params:** `CommandId`, `Input` XOR `Terminate`, `WaitMs`
- stdin interaction / process termination

### Supporting modules

#### `BackgroundTaskRegistry` (`src/command/background.ts`)
- In-memory `Map<string, BackgroundTask>` keyed by `cmd_<nanoid>`
- Output accumulation with 100KB ring buffer (20KB head + 80KB tail)
- Completion waiter pattern for `command_status`'s `WaitDurationSeconds`
- `disposeAll()` for session cleanup

#### Command Semantics (`src/command/semantics.ts`)
- Port `commandSemantics.ts` from liteai2
- grep/rg exit 1 = no match (not error), diff exit 1 = files differ

#### Tool prompt update (`src/bundled/prompts/tools/run_command.txt`)
- Adapted from liteai2's `prompt.ts` — teach async workflow, `run_in_background`, no sleep loops
- Document `command_status` and `send_command_input` usage patterns

## Files Changed

| File | Action | Package |
|------|--------|---------|
| `src/command/background.ts` | NEW | core |
| `src/command/semantics.ts` | NEW | core |
| `src/tool/run_command.ts` | MODIFY | core |
| `src/tool/command_status.ts` | NEW | core |
| `src/tool/send_command_input.ts` | NEW | core |
| `src/tool/registry.ts` | MODIFY (add 2 tools) | core |
| `src/bundled/prompts/tools/run_command.txt` | MODIFY | core |
| `test/tool/run_command.test.ts` | MODIFY | core |
| `test/tool/command_status.test.ts` | NEW | core |
| `test/command/background.test.ts` | NEW | core |

## Verification
```
bun test test/command/background
bun test test/tool/run_command
bun test test/tool/command_status
bun typecheck
bun lint:fix
```

## Session Estimate: **1 session**
