# Contract: Cache-Safe Params

**Feature**: 003-fork-subagent-durability
**Date**: 2026-04-14
**Type**: Internal API Contract

## MVP Grounding

> This contract is derived from `utils/forkedAgent.ts:57-81`. The critical adaptation is session-scoped storage instead of the MVP's module-level global.

---

## Overview

Defines the parameters that must be identical between a parent and fork child's API requests to share the parent's prompt cache with the upstream provider. Also defines the session-scoped storage slot for post-turn forks.

## Type Definition

```typescript
interface CacheSafeParams {
  /** Parent's rendered system prompt (byte-exact) */
  systemPrompt: string
  /** User context prepended to messages */
  userContext: Record<string, unknown>
  /** System context appended to system prompt */
  systemContext: Record<string, unknown>
  /** Tool definitions (parent's exact pool) */
  toolConfig: unknown[]
  /** Parent context messages for cache sharing */
  forkContextMessages: TranscriptMessage[]
}
```

## Session-Scoped Storage

```typescript
/**
 * Save cache-safe params for the current session's turn.
 * Called after each main agent loop turn completes by the post-sampling hook.
 * Setting to null clears the slot.
 */
function saveCacheSafeParams(sessionId: string, params: CacheSafeParams | null): void

/**
 * Retrieve the last saved cache-safe params for the current session.
 * Used by post-turn forks (summarization, memory extraction, speculation)
 * to share the main loop's prompt cache.
 */
function getLastCacheSafeParams(sessionId: string): CacheSafeParams | null
```

## Invariants

1. **Cache key identity**: All fields in CacheSafeParams are part of the upstream provider's cache key. Divergence in any field between parent and child causes a cache miss.
2. **Session isolation**: Params are scoped per-session. Cross-session reads return null (no cross-tenant pollution).
3. **Turn lifecycle**: Params are set once per main loop turn and consumed by zero or more post-turn forks. Cleared on session end.
4. **Immutability**: Once saved, params must not be mutated. Consumers must treat them as read-only. The fork spawn path clones the `forkContextMessages` array to prevent mutation.

## Consumers

| Consumer | Use Case | MVP Reference |
|----------|----------|---------------|
| Fork child spawn | Shares parent's cache prefix | `AgentTool.ts` fork path |
| Post-turn summarization | Summarizes agent work cheaply | `utils/forkedAgent.ts:73-77` |
| Post-turn memory extraction | Extracts memories using parent cache | `utils/forkedAgent.ts:73-77` |
| Post-turn prompt suggestion | Generates follow-up suggestions | `utils/forkedAgent.ts:73-77` |
