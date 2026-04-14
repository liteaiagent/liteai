# Quickstart: Fork Subagent + Agent Durability

**Feature**: 003-fork-subagent-durability
**Date**: 2026-04-14

## MVP Grounding

> This quickstart demonstrates the critical paths that must achieve parity with the MVP reference implementation. Each example maps to a specific user story from the spec.

---

## 1. Fork Spawn Flow (User Story 1)

The fork spawn path is triggered when the agent tool omits `subagent_type` and the fork feature gate is active.

```typescript
// Entry: Agent tool handler detects fork path
import { isForkSubagentEnabled, buildForkedMessages, isInForkChild, FORK_AGENT_CONFIG } from "@/agent/fork"

// 1. Check gate
if (!isForkSubagentEnabled(sessionContext)) {
  // Fallback to standard spawning
}

// 2. Check recursion guard
if (isInForkChild(currentTranscript)) {
  // Block fork, fallback to standard spawning
}

// 3. Build forked messages
const forkedMessages = buildForkedMessages(
  directive,            // "Refactor the authentication module..."
  lastAssistantMessage, // Parent's last message with tool_use blocks
)

// 4. Spawn fork child with parent's rendered system prompt
const childContext = createSubagentContext(parentContext, FORK_AGENT_CONFIG, agentId, {
  cwd: worktreePath ?? parentCwd,
})

// 5. Run async lifecycle (all spawns are async when fork is enabled)
await runAsyncAgentLifecycle(...)
```

## 2. Agent Resume Flow (User Story 2)

Resume a previously-interrupted agent from its persisted sidechain transcript.

```typescript
import { resumeAgentBackground } from "@/agent/resume"

const result = await resumeAgentBackground({
  agentId: "ag-abc123",
  prompt: "Continue from where you left off and also check the test coverage",
  sessionContext,
})
// result.agentId = "ag-abc123"
// result.description = "(resumed)"
```

### Resume internals:

```typescript
// 1. Load transcript + metadata
const transcript = await SidechainTranscript.read(dir, sessionId, subdir, agentId)
const metadata = await readAgentMetadata(agentId)

// 2. Filter orphaned messages (3-pass pipeline)
const cleaned = filterWhitespaceOnlyAssistantMessages(
  filterOrphanedThinkingOnlyMessages(
    filterUnresolvedToolUses(transcript.messages)
  )
)

// 3. Reconstruct content optimization state
const resumedReplacementState = reconstructContentOptimizationState(
  parentReplacementState,
  cleaned,
  transcript.contentReplacements,
)

// 4. Validate worktree (if applicable)
if (metadata.worktreePath) {
  const exists = await stat(metadata.worktreePath).catch(() => false)
  if (exists) {
    await utimes(metadata.worktreePath, now, now) // Refresh mtime BEFORE execution
  } else {
    logger.warn("Worktree GC'd, falling back to parent cwd")
  }
}

// 5. Resolve system prompt (fork resume only)
if (metadata.agentType === 'fork') {
  // Tier 1: Parent's live rendered prompt
  // Tier 2: Rebuild from session config
  // Tier 3: THROW
}

// 6. Launch with invocationKind: 'resume'
```

## 3. Teammate Re-engagement (User Story 5)

Send a follow-up message to a previously-completed agent.

```typescript
// Via SendMessage tool:
// Input: { to: "refactor-auth", message: "Also update the test mocks" }

// 3-way routing:
// Case 1: Agent "refactor-auth" is running → queue message
// Case 2: Agent "refactor-auth" is stopped → auto-resume with message
// Case 3: Agent "refactor-auth" is evicted → resume from disk transcript
```

## 4. Post-Turn Cache Sharing (User Story 7)

After the main loop completes a turn, post-turn forks share the cache.

```typescript
import { saveCacheSafeParams, getLastCacheSafeParams } from "@/agent/fork"

// In main loop post-turn hook:
saveCacheSafeParams(sessionId, {
  systemPrompt: renderedSystemPrompt,
  userContext,
  systemContext,
  toolConfig: tools,
  forkContextMessages: messages,
})

// In post-turn summarization fork:
const params = getLastCacheSafeParams(sessionId)
if (params) {
  const result = await runForkedAgent({
    promptMessages: [createUserMessage({ content: summarizationPrompt })],
    cacheSafeParams: params,
    skipTranscript: true, // Ephemeral fork (FR-026)
  })
}
```

## 5. Fork Behavioral Contract (User Story 3)

Fork children receive a strict behavioral contract.

```
<fork_boilerplate>
STOP. READ THIS FIRST.

You are a forked worker process. You are NOT the main agent.

RULES (non-negotiable):
1. Do NOT spawn sub-agents; execute directly.
2. Do NOT converse, ask questions, or suggest next steps
3. Do NOT editorialize or add meta-commentary
4. USE your tools directly: Bash, Read, Write, etc.
5. If you modify files, commit changes before reporting. Include commit hash.
6. Do NOT emit text between tool calls. Use tools silently, then report once.
7. Stay strictly within your directive's scope.
8. Keep your report under 500 words.
9. Your response MUST begin with "Scope:". No preamble.
10. REPORT structured facts, then stop.

Output format:
  Scope: <echo back your assigned scope>
  Result: <the answer or key findings>
  Key files: <relevant file paths>
  Files changed: <list with commit hash>
  Issues: <list — only if there are issues>
</fork_boilerplate>
```

## Key Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LITEAI_FORK_SUBAGENT` | Enable fork spawning (`1`/`0`) | `0` (disabled) |
| `LITEAI_FORK_TIMEOUT_MS` | Wall-clock timeout for fork children | `1800000` (30 min) |
| `LITEAI_CLASSIFIER_MODE` | Handoff classifier mode | `enforce` |
