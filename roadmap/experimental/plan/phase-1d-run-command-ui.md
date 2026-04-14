# Phase 1d — `run_command` UI Progress & Timer Display

**Scope:** `packages/ui`, `packages/cli` — UI rendering for async command lifecycle.

> Both `packages/web` and `packages/vscode` consume `packages/ui` components — they get updates for free. Only `packages/cli` has its own TUI rendering that needs separate work.
**Depends on:** Phase 1c (core backend).
**Goal:** Show "Running… (3s)" timer, "Waiting for command…" status, background task indicators.

## What liteai_cli_mvp Shows

liteai_cli_mvp's `ShellProgressMessage` renders during command execution:

```
last 5 lines of output         ← dimColor, truncated
~200 lines                     ← line count estimate
(3s · timeout 2m)              ← ShellTimeDisplay: elapsed + timeout
12.3 KB                        ← output size
```

- `ShellTimeDisplay` shows `(elapsed)` or `(elapsed · timeout Xm)` 
- While queued: `Waiting…`
- While no output yet: `Running…`
- After backgrounding: task moves out of foreground, agent gets notified

## What We Need

### `packages/ui` (`message-tools/run_command.tsx`)

The existing UI already has `pending()` state (shimmer) and shows `ShellSubmessage` after completion. We need to enhance it for the async lifecycle:

1. **Timer display:** When `status === "running"`, show elapsed time via `metadata.elapsed` or computed from `metadata.startTime`
2. **Background indicator:** When metadata includes `commandId` + `status: "running"`, show "Backgrounded — waiting for status" with commandId badge
3. **Output streaming:** Show last few lines of output from `metadata.output` while running (already partially works via `ctx.metadata()`)
4. **Command status results:** When `command_status` tool returns, render same style as `run_command` result

### `packages/ui` (`message-tools/command_status.tsx`) — NEW

Renderer for `command_status` tool results:
- Show status badge (running/done/error)  
- Show output snippet with elapsed time
- "Waiting for command..." shimmer when pending

### `packages/ui` (`message-tools/send_command_input.tsx`) — NEW

Renderer for `send_command_input` tool results:
- Show what was sent (stdin text or terminate)
- Show response output

### `packages/cli` (TUI parts.tsx)

CLI tool parts rendering needs to handle:
- `command_status` and `send_command_input` tool display
- Timer display in terminal (already shows tool results)

### SSE / Event System

**Assessment:** No engine changes needed for Phase 1d.

The existing `ctx.metadata()` → `Session.updatePart()` pipeline already streams metadata to the web UI via SSE. The `metadata` object in `run_command.ts` already sends `{ output, description }`. We just need to add `{ elapsed, commandId, status }` to the metadata payload — the existing SSE event plumbing (`EngineEvent.BlockEvent` → `call/tool`, `result/tool`) carries this transparently.

The UI just reads `partMetadata()` from the `ToolPart.state.metadata` — no new event types needed.

## Files Changed

| File | Action | Package | Consumers |
|------|--------|---------|----------|
| `ui/src/components/message-tools/run_command.tsx` | MODIFY (timer, background indicator) | ui | web, vscode |
| `ui/src/components/message-tools/command_status.tsx` | NEW | ui | web, vscode |
| `ui/src/components/message-tools/send_command_input.tsx` | NEW | ui | web, vscode |
| `ui/src/components/message-tools/index.ts` | MODIFY (register new tools) | ui | web, vscode |
| `cli/src/cli/cmd/tui/routes/session/tools.tsx` | MODIFY (new tool handlers) | cli | — |

## Session Estimate: **1 session**
