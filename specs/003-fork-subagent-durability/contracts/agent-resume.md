# Contract: Agent Resume

**Feature**: 003-fork-subagent-durability
**Date**: 2026-04-14
**Type**: Internal API Contract

## MVP Grounding

> This contract is derived from `tools/AgentTool/resumeAgent.ts`. The three-tier system prompt resolution, orphan filtering pipeline, and worktree mtime refresh are critical behavioral contracts.

---

## Overview

Defines the interface for resuming a previously-interrupted background agent from its persisted sidechain transcript. Handles transcript loading, orphaned message filtering, content optimization state reconstruction, worktree validation, and system prompt re-threading.

## Entry Point

```typescript
/**
 * Resume a previously-interrupted agent in the background.
 *
 * @param agentId - ID of the agent to resume
 * @param prompt - New user prompt to append to the resumed transcript
 * @param sessionContext - Current session's context (for system prompt resolution)
 * @returns Resume result with agent ID, description, and output path
 * @throws If no transcript found, or if fork resume fails system prompt resolution
 */
async function resumeAgentBackground(params: {
  agentId: string
  prompt: string
  sessionContext: SessionContext
  invokingRequestId?: string
}): Promise<ResumeAgentResult>

interface ResumeAgentResult {
  agentId: string
  description: string
}
```

## Resume Pipeline

```
1. Load transcript + metadata from disk
   ↓
2. Filter orphaned messages (3-pass pipeline)
   ├── filterUnresolvedToolUses()
   ├── filterOrphanedThinkingOnlyMessages()
   └── filterWhitespaceOnlyAssistantMessages()
   ↓
3. Reconstruct content optimization state
   ↓
4. Validate worktree (if applicable)
   ├── stat check → exists? proceed : fallback to parent cwd
   └── refresh mtime (BEFORE agent begins execution)
   ↓
5. Resolve system prompt (fork resume only)
   ├── Tier 1: Parent's live rendered prompt
   ├── Tier 2: Rebuild from session config
   └── Tier 3: THROW (fail-fast, no mismatched prompt)
   ↓
6. Assemble resume state
   ↓
7. Skip permission re-gating (original spawn already passed)
   ↓
8. Launch async agent lifecycle with invocationKind: 'resume'
```

## Preconditions

1. Agent has a persisted sidechain transcript on disk
2. Agent metadata is loadable (at minimum: agentType)
3. Session context is available for system prompt resolution (fork resume)

## Postconditions

1. Resumed agent receives cleaned transcript + new prompt as messages
2. Content optimization state matches original run (cache stability)
3. Worktree mtime is refreshed before agent begins execution
4. Agent context has `invocationKind: 'resume'` for telemetry
5. Permission checks are skipped (original spawn was already authorized)
6. Agent name registry is NOT re-written (original entry persists)

## Error Conditions

| Condition | Behavior | MVP Reference |
|-----------|----------|---------------|
| No transcript found | Throw structured error | `resumeAgent.ts:67-69` |
| Worktree GC'd during interruption | Fallback to parent cwd with diagnostic log | `resumeAgent.ts:82-92` |
| Cannot resolve fork parent system prompt | Throw explicit error (fail-fast) | `resumeAgent.ts:143-147` |
| Metadata missing | Fallback to GENERAL_PURPOSE_AGENT | `resumeAgent.ts:105-112` |
