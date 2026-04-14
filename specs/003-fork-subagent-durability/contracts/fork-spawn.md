# Contract: Fork Spawn

**Feature**: 003-fork-subagent-durability
**Date**: 2026-04-14
**Type**: Internal API Contract

## MVP Grounding

> This contract is derived from `tools/AgentTool/forkSubagent.ts` and the fork path in `tools/AgentTool/AgentTool.ts`. The behavioral output must match MVP for equivalent inputs.

---

## Overview

Defines the interface between the agent spawning system and the fork subsystem. When a sub-agent spawn request omits `subagent_type` and the fork feature gate is active, the fork path is triggered instead of standard sub-agent spawning.

## Entry Point

```typescript
/**
 * Check if fork spawning is enabled for the current session.
 * Returns false if fork gate is disabled, coordinator mode is active,
 * or the session is non-interactive.
 */
function isForkSubagentEnabled(sessionContext: SessionContext): boolean

/**
 * Build the forked conversation messages for a child agent.
 * Produces a cache-compatible message set where only the per-child
 * directive differs between siblings.
 *
 * @param directive - The task directive for this specific child
 * @param assistantMessage - The parent's last assistant message (with tool_use blocks)
 * @returns ForkedMessageSet ready for the child's query loop
 */
function buildForkedMessages(
  directive: string,
  assistantMessage: TranscriptMessage,
): TranscriptMessage[]

/**
 * Detect if the current agent is itself a fork child (recursion guard).
 * Scans the transcript for the fork boilerplate tag.
 *
 * @param messages - Current agent's transcript
 * @returns true if this agent was spawned via fork
 */
function isInForkChild(messages: TranscriptMessage[]): boolean
```

## Preconditions

1. `isForkSubagentEnabled()` returns `true`
2. The parent agent has an active conversation with at least one assistant message
3. The parent is NOT itself a fork child (recursion guard)

## Postconditions

1. Fork child receives:
   - Parent's rendered system prompt (byte-exact, not recomputed)
   - Parent's exact tool pool (including agent tool for cache compatibility)
   - Behavioral contract injected as a user message
   - Worktree path translation notice (if worktree isolation active)
2. ALL agent spawns are forced to async mode (FR-005)
3. Fork child is registered in the agent name registry
4. Sidechain transcript recording begins immediately

## Error Conditions

| Condition | Behavior | MVP Reference |
|-----------|----------|---------------|
| Fork gate disabled | Silent fallback to standard spawning | `forkSubagent.ts:33-38` |
| No assistant message (no tool_use blocks) | Fallback to directive-only messages | `forkSubagent.ts:127-139` |
| Recursion detected (child is a fork) | Block fork, fallback to standard spawning | `forkSubagent.ts:78-89` |
| Non-retryable API error (400 context overflow) | Structured failure notification to parent | Spec FR-022 |
| Context construction exception | Structured failure notification to parent | Spec edge case |

## Cache Sharing Contract

The fork message construction MUST produce byte-identical API request prefixes across all fork children of the same parent. Specifically:

1. `system` parameter: Parent's rendered system prompt (threaded, not recomputed)
2. `tools` parameter: Parent's exact tool definitions (no filtering)
3. `messages[0..n-1]` (prefix): Identical across siblings
4. `messages[n]` (tail user message): Only the directive text block differs

The `toolResultPlaceholders` in the prefix MUST use the identical placeholder text for all tool_use blocks: `"Fork started — processing in background"`.
