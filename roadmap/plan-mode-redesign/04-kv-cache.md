# Phase 6: KV Cache Hardening

> **Goal**: Maximize provider-level KV cache hit rates across ALL agent types. Ensure parallel agents share cache prefixes, detect/prevent cache breaks, and handle reasoning tokens correctly for multi-model scenarios.

---

## How Provider-Level KV Caching Works

The LLM provider maintains a KV cache keyed by the **byte-exact prefix** of each API request:

```
[system_prompt_bytes] + [tool_definitions_bytes] + [message_1] + [message_2] + ...
                       ↑ must be byte-identical for cache HIT
```

### What Invalidates the Cache

1. **Changing system prompt** → upper bytes change → **entire cache invalidated**
2. **Changing tool definitions** → bytes after system prompt change → cache from tools onward lost
3. **Changing model** → different model = different cache entirely
4. **Changing message order/content** → everything from that point onward invalidated
5. **Reordering tools** → byte prefix changes → cache broken
6. **Dynamic content** (timestamps, random IDs) in system prompt → different bytes per call

### Cache Sharing Across Agents — ALL Agents, Not Just Explore

**Key insight**: Cache sharing applies to ANY agent that inherits the parent's system prompt + tools via the fork pattern. This includes plan agents, general agents, and explore agents.

**Example — root + plan agent cache sharing (fork path)**:

```
Root Agent - Turn 1: [sys] + [tools] + [user_msg1] → cache MISS, creates entry
Root Agent - Turn 2: [sys] + [tools] + [user_msg1] + [assistant_1] + [user_msg2]
                     ↑── cache HIT on prefix! ─────────────────────↑ MISS here
plan_enter BLOCKS → spawns plan subagent

Plan Agent - Turn 1: [sys] + [tools] + [user_msg1] + [assistant_1] + [user_msg2] + [plan_enter_result] + [plan_prompt]
                     ↑── cache HIT on shared prefix! ──────────────────────────────↑ MISS here

Plan Agent - Turn 2: [sys] + [tools] + [...all_msgs] + [plan_turn1_result] + [plan_turn2_prompt]
                     ↑── cache HIT on prefix! ─────────────────────────────↑ MISS here

plan_enter returns → root resumes

Root Agent - Turn 3: [sys] + [tools] + [user_msg1] + [assistant_1] + [user_msg2] + [plan_enter_result]
                     ↑── cache HIT on prefix! (root's entry still in provider cache) ──↑ MISS here
Root Agent - Turn 4: cache HIT ✅
```

**Example — 3 parallel explore agents cache sharing**:

```
┌─────────────────────────────────────────────────────────┐
│ Provider KV Cache (shared resource per API key)         │
│                                                         │
│ If 3 explore agents share IDENTICAL system_prompt+tools:│
│                                                         │
│ Agent 1: [sys_prompt] + [tools] + [explore_msg_1]       │
│          ↑─── cache MISS, creates entry ───↑            │
│ Agent 2: [sys_prompt] + [tools] + [explore_msg_2]       │
│          ↑── cache HIT on prefix! ────↑  MISS here      │
│ Agent 3: [sys_prompt] + [tools] + [explore_msg_3]       │
│          ↑── cache HIT on prefix! ────↑  MISS here      │
│                                                         │
│ If each agent has DIFFERENT system prompts:             │
│ Agent 1: [sys_A] + [tools] + [msg]  → cache MISS       │
│ Agent 2: [sys_B] + [tools] + [msg]  → cache MISS       │
│ Agent 3: [sys_C] + [tools] + [msg]  → cache MISS       │
│          ↑ all different → 3× cold starts               │
└─────────────────────────────────────────────────────────┘
```

---

## Claude Code's Multi-Layer Cache Strategy (Reference)

### 1. `splitSysPromptPrefix()` (`utils/api.ts:321-435`)

Splits system prompt into cache-scoped segments:
- **Attribution header** (`cacheScope: null`) — changes per user
- **System prompt prefix** (`cacheScope: 'global'`) — shared across ALL users
- **Static content before `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker** (`cacheScope: 'global'`)
- **Dynamic content after boundary** (`cacheScope: null`) — changes per session

### 2. Deterministic tool sorting (`tools.ts:362-364`)

```typescript
const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
return uniqBy([...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)), 'name')
```

Built-ins sorted first, MCP tools sorted separately and appended → prefix stability.

### 3. Global cache breakpoint on tools (`tools.ts:356`)

Server-side policy places a breakpoint after the last built-in tool, so MCP tool additions don't invalidate built-in tool cache.

### 4. `promptCacheBreakDetection.ts` (728 lines)

Monitors EVERY API call:
- Hashes `system + tools + model` before each call
- Compares `cache_read_tokens` between turns
- Detects and logs exactly what caused a cache break (system prompt changed, tool schema changed, model changed, etc.)
- Event: `tengu_prompt_cache_break`

### 5. Tool schema caching (`toolSchemaCache.ts`)

Session-stable tool schemas — prevents GrowthBook feature flag flips from mid-session tool description changes.

### 6. Fork-path cache sharing (`AgentTool.tsx:622-633`)

```typescript
// Fork path: pass parent's system prompt AND parent's exact tool
// array (cache-identical prefix). workerTools is rebuilt under
// permissionMode 'bubble' which differs from the parent's mode, so
// its tool-def serialization diverges and breaks cache at the first
// differing tool. useExactTools also inherits the parent's
// thinkingConfig and isNonInteractiveSession (see runAgent.ts).
override: isForkPath ? {
  systemPrompt: forkParentSystemPrompt
} : ...,
availableTools: isForkPath ? toolUseContext.options.tools : workerTools,
forkContextMessages: isForkPath ? toolUseContext.messages : undefined,
```

**Critical detail**: `workerTools` (rebuilt with `permissionMode: 'bubble'`) has DIFFERENT tool serialization than the parent's tools. So Claude Code explicitly passes the parent's EXACT tool array to preserve byte-identical prefix.

---

## LiteAI's Current Cache Strategy

### What exists

1. **`applyCaching()`** (`transform/message.ts:165-203`): Places `cache_control: { type: "ephemeral" }` on first 2 system messages + last 2 conversation messages — simple but effective
2. **`systemBoundary`** (`LLM.StreamInput.systemBoundary`): Places cache_control at a specific system message index for Anthropic — **exists but underutilized**. Only Anthropic provider
3. **`promptCacheKey`** (`transform/options.ts:87`): Session-level cache key for OpenAI/Copilot providers
4. **`CacheSafeParams`** (`agent/fork.ts`): Mechanism for sharing parent's prompt cache with subagents

### What's missing

1. **No deterministic tool ordering** → tool reordering can break cache
2. **No cache break detection** → no visibility into unexpected cache misses
3. **No static/dynamic system prompt split** → entire system prompt treated as one block
4. **Fork-path doesn't enforce byte-identical prefix** → subagent tools may be serialized differently
5. **No reasoning token handling** for multi-model scenarios (see below)

---

## Phase 6A: Deterministic Tool Ordering

| Change | Scope |
|--------|-------|
| `ToolRegistry.tools()` or equivalent | Sort built-in tools alphabetically by ID before returning |
| Agent-specific tool filtering | Sort AFTER filtering to prevent reordering when tools are added/removed |
| MCP tools | Sort separately and append after built-ins (like Claude Code's `assembleToolPool`) |

**Rationale**: Currently, tool order depends on registration order + agent filtering. Different agents with the same tool set may get different tool orderings → different prefix bytes → cache miss.

**Implementation sketch**:

```typescript
function resolveTools(agent: Agent, mcpTools: Tool[]): Tool[] {
  const builtins = getBuiltinToolsForAgent(agent)
  const byName = (a: Tool, b: Tool) => a.id.localeCompare(b.id)
  return [
    ...builtins.sort(byName),
    ...mcpTools.sort(byName)
  ]
}
```

---

## Phase 6B: Static/Dynamic System Prompt Boundary

| Change | Scope |
|--------|-------|
| System prompt builder | Split into STATIC (agent instructions, tool descriptions) and DYNAMIC (user context, git status, working directory) blocks |
| `LLM.StreamInput.systemBoundary` | Already exists — ensure it's set correctly for all agent types, not just Anthropic |
| `applyCaching()` | Place `cache_control: ephemeral` at the static/dynamic boundary |
| All agents | Ensure STATIC prefix is byte-identical across instances of the same agent type |

**LiteAI's existing `systemBoundary`** (from `session/llm.ts`):

```typescript
// Already exists in StreamInput:
systemBoundary?: number  // index in system[] array where static ends
```

This is used by `SystemPrompt.resolveSystemPromptSections()` which returns `{ parts, boundary }`. The boundary is passed through to the LLM stream setup.

**What we need to change**:
1. Ensure `boundary` is set for ALL providers, not just Anthropic
2. Identify exactly which system prompt sections are static vs dynamic
3. Ensure no dynamic content (timestamps, random session IDs, git status) appears in the static section

**Static sections** (should be identical across same-agent instances):
- Agent markdown instructions (`liteai.md`, `explore.md`, etc.)
- Tool descriptions
- Skill instructions

**Dynamic sections** (change per session/turn):
- Git status
- Working directory
- User context/environment
- Plan reminders

---

## Phase 6C: Cache Break Detection

| Change | Scope |
|--------|-------|
| New `CacheBreakDetector` class | Hash system prompt + tools + model before each API call |
| Post-call verification | Compare `usage.cachedTokens` (from AI SDK response) between turns |
| Logging | Log warnings when cache breaks unexpectedly |
| Metrics | Track cache hit rate per session, per agent type |

**Implementation**:

```typescript
type CacheState = {
  systemHash: string    // SHA-256 of serialized system prompt
  toolsHash: string     // SHA-256 of serialized tool definitions
  model: string         // providerID/modelID
  prevCacheReadTokens: number | null
}

class CacheBreakDetector {
  private state: CacheState | null = null
  
  preCall(system: string[], tools: Record<string, unknown>, model: string): void {
    const newState: CacheState = {
      systemHash: hash(JSON.stringify(system)),
      toolsHash: hash(JSON.stringify(tools)),
      model,
      prevCacheReadTokens: this.state?.prevCacheReadTokens ?? null
    }
    
    if (this.state) {
      if (this.state.systemHash !== newState.systemHash) {
        log.warn("cache break: system prompt changed", { 
          prev: this.state.systemHash, 
          next: newState.systemHash 
        })
      }
      if (this.state.toolsHash !== newState.toolsHash) {
        log.warn("cache break: tool definitions changed", {
          prev: this.state.toolsHash,
          next: newState.toolsHash
        })
      }
      if (this.state.model !== newState.model) {
        log.warn("cache break: model changed", {
          prev: this.state.model,
          next: newState.model
        })
      }
    }
    
    this.state = newState
  }
  
  postCall(cacheReadTokens: number): void {
    if (!this.state) return
    
    if (this.state.prevCacheReadTokens !== null) {
      const drop = this.state.prevCacheReadTokens - cacheReadTokens
      if (drop > 2000) {  // ignore small fluctuations
        log.warn("cache break detected", {
          prev: this.state.prevCacheReadTokens,
          current: cacheReadTokens,
          drop,
          model: this.state.model
        })
      }
    }
    
    this.state.prevCacheReadTokens = cacheReadTokens
  }
}
```

---

## Phase 6D: Reasoning Token Handling

### Current State

**LiteAI** (`message.ts:749-754`): Reasoning parts ARE included in model messages:

```typescript
// toModelMessages() — reasoning parts are preserved in history
if (part.type === "reasoning") {
  assistantMessage.parts.push({
    type: "reasoning",
    text: part.text,
    ...(differentModel ? {} : { providerMetadata: part.metadata }),
  })
}
```

Key detail at line 668: When model differs from the generating model, `providerMetadata` is stripped:
```typescript
const differentModel = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
```

**Claude Code** handles thinking tokens with multiple safeguards:

| Function | File | Purpose |
|----------|------|---------|
| `filterTrailingThinkingFromLastAssistant()` | `messages.ts:4781-4828` | API rejects assistant messages ending with thinking blocks |
| `filterOrphanedThinkingOnlyMessages()` | `messages.ts:4991-5058` | Removes thinking-only assistant messages without non-thinking siblings |
| `stripSignatureBlocks()` | `messages.ts:5066-5099` | Strips ALL thinking + redacted_thinking when API key changes (signatures are key-bound) |
| `isThinkingMessage()` | `messages.ts:4679-4685` | Detects messages containing only thinking blocks |

### KV Cache Implications of Reasoning Tokens

Reasoning tokens in conversation history have significant cache implications:

**Positive**: They INCREASE the shared prefix length between turns:
```
Turn N:   [sys] + [tools] + [msgs] + [assistant_with_reasoning] → cache MISS
Turn N+1: [sys] + [tools] + [msgs] + [assistant_with_reasoning] + [user_msg]
           ↑──── cache HIT on prefix including reasoning! ────↑  MISS here
```

The reasoning tokens become part of the cached prefix, so subsequent turns that share this history get a larger cache hit.

**Negative**: They increase token cost and reduce context window budget:
- Reasoning tokens can be 2-10x the output text length
- They consume context window space
- If context is compacted, reasoning tokens are lost and must be regenerated

**Multi-model scenarios**:
- Reasoning tokens from Model A in history, but now using Model B
- Different models have different reasoning formats (Anthropic `thinking`/`redacted_thinking` vs OpenAI `reasoning`, vs Google `thinking`)
- `providerMetadata` on reasoning tokens may be provider-specific (signatures, thought signatures)

**Provider-specific handling**:

| Provider | Reasoning Format | In History | Signature Bound? |
|----------|------------------|------------|-------------------|
| Anthropic (Claude) | `thinking` + `redacted_thinking` blocks | Yes, required | Yes — `thoughtSignature` field |
| OpenAI (o-series) | `reasoning` content | Not returned to API | N/A — server-side only |
| Google (Gemini) | `thinking` block | Yes | No |
| AI SDK (LiteAI) | `reasoning` part type | Yes — stored in `ReasoningPart` | Depends on provider metadata |

### Proposed Reasoning Token Strategy

1. **Keep reasoning tokens in history by default** — they improve cache hit rates
2. **Strip reasoning on model switch** — if `msg.providerID !== currentModel.providerID`, strip reasoning parts (they won't be understood and may cause errors)
3. **Respect provider signatures** — for Anthropic, preserve `thoughtSignature` in metadata for same-model replay
4. **Handle LiteAI's `loop.ts:1139` check**:
   ```typescript
   // Already exists: strips unsigned reasoning parts on resume
   if (part.type === "reasoning" && !part.time?.end && !part.metadata?.thoughtSignature) {
     // incomplete reasoning — strip
   }
   ```
5. **Budget control** — configurable max reasoning tokens per session to prevent context exhaustion

### LiteAI Implementation Sketch

```typescript
// In toModelMessages() — enhanced reasoning handling
if (part.type === "reasoning") {
  // Strip reasoning from different providers (incompatible formats)
  if (differentModel && differentProvider) {
    continue  // skip — reasoning format won't be understood
  }
  
  // Strip reasoning from different models on same provider (signature mismatch)
  if (differentModel && part.metadata?.thoughtSignature) {
    continue  // skip — signed thinking blocks from different model
  }
  
  // Keep reasoning for same model (cache benefit + API requirement)
  assistantMessage.parts.push({
    type: "reasoning",
    text: part.text,
    providerMetadata: part.metadata,
  })
}
```

---

## Phase 6E: Fork-Path Cache Sharing for ALL Agents

| Change | Scope |
|--------|-------|
| `agent/fork.ts` | Ensure `CacheSafeParams` captures byte-identical system prompt + tools |
| `tool/agent.ts` (was task.ts) | When spawning subagent, pass parent's exact serialized tools (not re-resolved tools) |
| `session/engine/query.ts` | Tool resolution must produce stable serialization |
| All agent types | Verify that plan, explore, general agents all get cache hits when forked |

**Claude Code's fork path** (the pattern to follow):

```typescript
// AgentTool.tsx:622-633 — fork path explicitly passes parent's exact tools
availableTools: isForkPath ? toolUseContext.options.tools : workerTools,
// IMPORTANT: workerTools is rebuilt under permissionMode 'bubble' which differs
// from the parent's mode, so its tool-def serialization diverges and breaks cache
```

**LiteAI's `CacheSafeParams`** (`agent/fork.ts`) already exists:
```typescript
type CacheSafeParams = {
  system: string[]           // parent's system prompt
  tools: Record<string, unknown>  // parent's tool definitions
  messages: ModelMessage[]    // parent's conversation history
}
```

**What needs verification**:
1. When `runSubagent()` creates a new session for the plan/explore agent, does it reuse `CacheSafeParams`?
2. Are the tools re-resolved (potentially different ordering/filtering) or passed through?
3. Is the system prompt rebuilt for the subagent or inherited from parent?

**Expected outcome — ALL agents benefit**:

```
Root turn N:     [sys_root] + [tools] + [msgs...] → cache HIT on prefix
plan_enter:      [sys_root] + [tools] + [msgs...] + [plan_context]
                 ↑── fork inherits parent prefix ──↑ → cache HIT!
explore (fork):  [sys_root] + [tools] + [msgs...] + [explore_context]  
                 ↑── fork inherits parent prefix ──↑ → cache HIT!
general (fork):  [sys_root] + [tools] + [msgs...] + [general_context]
                 ↑── fork inherits parent prefix ──↑ → cache HIT!
```

---

## Code References

| File | Lines | What |
|------|-------|------|
| `d:\liteai\packages\core\src\provider\transform\message.ts` | 165-203 | `applyCaching()` — current cache control placement |
| `d:\liteai\packages\core\src\session\llm.ts` | 1-411 | `systemBoundary` usage in LLM stream setup |
| `d:\liteai\packages\core\src\agent\fork.ts` | 1-357 | `CacheSafeParams` mechanism |
| `d:\liteai\packages\core\src\session\message.ts` | 749-754 | Reasoning part handling in `toModelMessages()` |
| `d:\liteai\packages\core\src\session\message.ts` | 668 | `differentModel` detection for providerMetadata stripping |
| `d:\liteai\packages\core\src\session\engine\loop.ts` | 1139 | Unsigned reasoning part stripping on resume |
| `d:\liteai\packages\core\src\session\engine\query.ts` | 417-418 | `resolveSystemPromptSections()` returning `{ parts, boundary }` |
| `d:\claude-code\src\utils\forkedAgent.ts` | 1-690 | Claude Code's fork + CacheSafeParams strategy |
| `d:\claude-code\src\tools\AgentTool\AgentTool.tsx` | 622-633 | Fork path: explicit parent tool passthrough |
| `d:\claude-code\src\utils\messages.ts` | 4781-5099 | Thinking block filters (trailing, orphan, signature) |

## Deliverables

- Deterministic tool ordering in tool resolution pipeline
- Static/dynamic system prompt boundary set for all providers
- `CacheBreakDetector` class monitoring every API call
- Reasoning token handling for multi-model scenarios
- Fork-path verified for plan, explore, and general agents (all get cache hits)
- Cache hit rate metrics logged per session and agent type
