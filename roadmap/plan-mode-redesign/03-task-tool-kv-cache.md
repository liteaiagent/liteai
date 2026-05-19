# Agent Tool: KV Cache Optimization

## Problem

Every `task` tool call creates a fresh session via `Session.create()`. The subagent starts with zero conversation history, meaning:

1. **No KV cache reuse** — the model must re-process system prompt + agent prompt from scratch every call
2. **No continuity** — if a subagent needs to be resumed, the caller must manually pass `task_id`
3. **Context waste** — for multi-turn subagent interactions (plan subagent exploring code), each turn rebuilds the full prefix

## Solution

### Default `keepHistory: true` on subagent sessions

When `SessionPrompt.runSubagent()` is called, the session should default to persisting its message history. This means:

1. **First call**: Creates new session, builds KV cache from system prompt + agent prompt
2. **Subsequent turns within the same subagent run**: Reuses the session's KV cache prefix
3. **Resume via task_id**: Full history is available, KV cache hits on the entire prior conversation

### Changes Required

#### `tool/agent.ts`

```diff
 const result = await SessionPrompt.runSubagent({
   messageID,
   sessionID: session.id,
   model: { modelID: model.modelID, providerID: model.providerID },
   agent: agent.name,
   parts: promptParts,
+  keepHistory: true,
 })
```

#### `session/engine.ts` (or wherever `runSubagent` is defined)

Ensure the `keepHistory` flag is propagated to the session's message storage layer. When `true`:
- Messages are persisted to the session store after each turn
- The KV cache prefix is maintained across turns
- The session is resumable via its ID

#### Remove yield_turn parsing

```diff
- const yieldTurnPart = completedMessage?.parts.findLast(
-   (x: { type?: string; tool?: string }) => x.type === "tool" && x.tool === "yield_turn",
- ) as { args?: { summary?: string } } | undefined
-
- const taskResultContent = yieldTurnPart?.args?.summary
-   ? `[Yield] ${yieldTurnPart.args.summary}`
-   : textPart
+ const taskResultContent = textPart
```

## Impact

| Metric | Before | After |
|--------|--------|-------|
| First-turn latency | Full prefix computation | Full prefix computation (same) |
| Subsequent turns | Full prefix re-computation | KV cache hit (near-zero prefix cost) |
| Resume capability | Manual task_id required | Automatic via session persistence |
| Memory per session | Transient (GC'd) | Persisted (small overhead) |

## Risk

- **Memory**: Persisted sessions accumulate. Mitigate with TTL-based cleanup for subagent sessions (e.g., 1 hour after last activity).
- **Stale context**: Long-lived subagent sessions may have outdated file contents in history. Mitigate by making subagents re-read files on resume rather than trusting cached reads.
