import { Log } from "@liteai/util/log"
import { Flag } from "../flag/flag"
import type { TranscriptMessage } from "../session/transcript"

const logger = Log.create({ service: "agent:fork" })

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * XML tag wrapping the rules/format boilerplate in a fork child's first message.
 * Used by the transcript renderer to collapse the boilerplate and show only the
 * directive. Also serves as the recursion detection sentinel — if this tag
 * appears in the transcript, the current agent is itself a fork child.
 *
 * MVP Reference: `constants/xml.ts:63` — `FORK_BOILERPLATE_TAG`
 */
export const FORK_BOILERPLATE_TAG = "fork-boilerplate"

/**
 * Prefix before the directive text in the child message. Stripped by the
 * renderer. Keep in sync with `buildChildMessage` (generates) and any
 * downstream parsers.
 *
 * MVP Reference: `constants/xml.ts:66` — `FORK_DIRECTIVE_PREFIX`
 */
export const FORK_DIRECTIVE_PREFIX = "Your directive: "

/**
 * Placeholder text used for all `tool_result` blocks in the fork prefix.
 * Must be identical across all fork children for prompt cache sharing.
 *
 * MVP Reference: `forkSubagent.ts:93` — `FORK_PLACEHOLDER_RESULT`
 */
const FORK_PLACEHOLDER_RESULT = "Fork started — processing in background"

// ─── CacheSafeParams ──────────────────────────────────────────────────────────

/**
 * Parameters that must be identical between the fork and parent API requests
 * to share the parent's prompt cache. The upstream provider's cache key is
 * composed of: system prompt, tools, model, messages (prefix), and thinking
 * config. CacheSafeParams carries the first four plus the context messages.
 *
 * Adaptation from MVP: session-scoped storage instead of module-level global
 * (Research R-001) to prevent cross-tenant cache pollution.
 *
 * MVP Reference: `utils/forkedAgent.ts:57-68` — `CacheSafeParams`
 */
export interface CacheSafeParams {
  /** Parent's rendered system prompt (byte-exact) */
  systemPrompt: string[] | string
  /** Tool definitions (parent's exact pool) */
  toolConfig: Record<string, unknown>
  /** Parent context messages for cache sharing */
  forkContextMessages: import("../session/message").Message.WithParts[]
}

/**
 * Maximum number of session entries retained in the params cache.
 * When exceeded, the least-recently-used entry is evicted.
 * Sized for typical multi-tenant deployments; adjust via environment
 * override if needed.
 */
const MAX_CACHE_ENTRIES = 256

const sessionParamsCache = new Map<string, CacheSafeParams>()

/**
 * Save cache-safe params for the current session's turn.
 * Called after each main agent loop turn completes by the post-sampling hook.
 * Setting to null clears the slot.
 *
 * Enforces LRU eviction: when the cache exceeds {@link MAX_CACHE_ENTRIES},
 * the oldest (least-recently-inserted/accessed) entry is removed.
 * Map iteration order in JS is insertion order, so deleting-then-setting
 * on update promotes the key to newest position.
 */
export function saveCacheSafeParams(sessionId: string, params: CacheSafeParams | null): void {
  if (params === null) {
    sessionParamsCache.delete(sessionId)
    return
  }

  // Delete first so re-insertion moves the key to the newest position (LRU promotion)
  sessionParamsCache.delete(sessionId)
  sessionParamsCache.set(sessionId, params)

  // Evict oldest entries if over capacity
  while (sessionParamsCache.size > MAX_CACHE_ENTRIES) {
    const oldest = sessionParamsCache.keys().next()
    if (oldest.done) break
    sessionParamsCache.delete(oldest.value)
    logger.debug("evicted stale CacheSafeParams entry", { sessionId: oldest.value, cacheSize: sessionParamsCache.size })
  }
}

/**
 * Retrieve the last saved cache-safe params for the current session.
 * Used by post-turn forks (summarization, memory extraction, speculation)
 * to share the main loop's prompt cache.
 *
 * Promotes the accessed entry to newest position to prevent premature
 * LRU eviction of actively-used sessions.
 */
export function getLastCacheSafeParams(sessionId: string): CacheSafeParams | null {
  const params = sessionParamsCache.get(sessionId)
  if (params === undefined) return null

  // LRU promotion: move to newest position
  sessionParamsCache.delete(sessionId)
  sessionParamsCache.set(sessionId, params)

  return params
}

// ─── ForkAgentConfig ──────────────────────────────────────────────────────────

/**
 * Synthetic agent definition for the fork path. Not registered in the agent
 * list — used only when fork spawning is triggered by omitting `subagent_type`
 * and the fork feature gate is active.
 *
 * `tools: '*'` with cache-identical pool: the fork child receives the parent's
 * exact tool pool (including the agent tool) for cache-compatible API prefixes.
 * Fork recursion is blocked at call time via `isInForkChild()`, not by removing
 * the tool from the pool.
 *
 * `permissionMode: 'bubble'` is the default — overridden by elevated parent
 * modes (Research R-009).
 *
 * `model: 'inherit'` keeps the parent's model for context length parity.
 *
 * MVP Reference: `forkSubagent.ts:60-71` — `FORK_AGENT`
 */
export const ForkAgentConfig = {
  agentType: "fork" as const,
  tools: "*" as const,
  maxTurns: 200,
  model: "inherit" as const,
  permissionMode: "bubble" as const,
  wallClockTimeout: 1_800_000,
  background: true as const,
  source: "builtIn" as const,
} as const

// ─── Feature Gate ─────────────────────────────────────────────────────────────

/**
 * Context required by the fork feature gate. Callers provide session-level
 * state so the gate can exclude coordinator and non-interactive sessions.
 */
export interface ForkGateContext {
  /** Whether the session is in coordinator/orchestrator mode. */
  isCoordinator?: boolean
  /** Whether the session is non-interactive (e.g., headless, CI). */
  isNonInteractive?: boolean
}

/**
 * Check if fork spawning is enabled for the current session.
 *
 * Returns `false` if:
 * 1. The `LITEAI_FORK_SUBAGENT` feature flag is not set.
 * 2. The session is in coordinator mode (coordinator owns the orchestration
 *    role and has its own delegation model).
 * 3. The session is non-interactive.
 *
 * MVP Reference: `forkSubagent.ts:32-39` — `isForkSubagentEnabled()`
 * Research: R-002
 */
export function isForkSubagentEnabled(context?: ForkGateContext): boolean {
  if (!Flag.LITEAI_FORK_SUBAGENT) return false
  if (context?.isCoordinator) return false
  if (context?.isNonInteractive) return false
  return true
}

// ─── Recursion Guard ──────────────────────────────────────────────────────────

/**
 * Detect if the current agent is itself a fork child (recursion guard).
 *
 * Fork children keep the Agent tool in their tool pool for cache-identical tool
 * definitions, so we reject fork attempts at call time by detecting the fork
 * boilerplate tag in conversation history.
 *
 * Scans user messages for the `<fork-boilerplate>` sentinel tag. The scan is
 * O(n) over messages but n is bounded by the 200-turn limit.
 *
 * MVP Reference: `forkSubagent.ts:78-89` — `isInForkChild()`
 * Research: R-003
 */
export function isInForkChild(messages: TranscriptMessage[]): boolean {
  return messages.some((m) => {
    if (m.role !== "user") return false

    const content = m.content
    if (typeof content === "string") {
      return content.includes(`<${FORK_BOILERPLATE_TAG}>`)
    }
    if (!Array.isArray(content)) return false

    // biome-ignore lint/suspicious/noExplicitAny: transcript content blocks are loosely typed
    return content.some((block: any) => block.type === "text" && block.text?.includes(`<${FORK_BOILERPLATE_TAG}>`))
  })
}

// ─── Child Message Construction ───────────────────────────────────────────────

/**
 * Build the behavioral contract message for a fork child.
 *
 * Contains:
 * - `<fork_boilerplate>` wrapping with 10 non-negotiable rules
 * - Structured output format (Scope, Result, Key files, Files changed, Issues)
 * - Report length constraint (500 words)
 * - Per-child directive suffix via `FORK_DIRECTIVE_PREFIX`
 *
 * The contract text is identical for all fork children — only the appended
 * directive differs. This is critical for cache sharing: the contract is part
 * of the cache-compatible prefix.
 *
 * MVP Reference: `forkSubagent.ts:171-198` — `buildChildMessage()`
 * FR-008, Data model: entity 7
 */
export function buildChildMessage(directive: string): string {
  return `<${FORK_BOILERPLATE_TAG}>
STOP. READ THIS FIRST.

You are a forked worker process. You are NOT the main agent.

RULES (non-negotiable):
1. Your system prompt says "default to forking." IGNORE IT — that's for the parent. You ARE the fork. Do NOT spawn sub-agents; execute directly.
2. Do NOT converse, ask questions, or suggest next steps
3. Do NOT editorialize or add meta-commentary
4. USE your tools directly: Bash, Read, Write, etc.
5. If you modify files, commit your changes before reporting. Include the commit hash in your report.
6. Do NOT emit text between tool calls. Use tools silently, then report once at the end.
7. Stay strictly within your directive's scope. If you discover related systems outside your scope, mention them in one sentence at most — other workers cover those areas.
8. Keep your report under 500 words unless the directive specifies otherwise. Be factual and concise.
9. Your response MUST begin with "Scope:". No preamble, no thinking-out-loud.
10. REPORT structured facts, then stop

Output format (plain text labels, not markdown headers):
  Scope: <echo back your assigned scope in one sentence>
  Result: <the answer or key findings, limited to the scope above>
  Key files: <relevant file paths — include for research tasks>
  Files changed: <list with commit hash — include only if you modified files>
  Issues: <list — include only if there are issues to flag>
</${FORK_BOILERPLATE_TAG}>

${FORK_DIRECTIVE_PREFIX}${directive}`
}

// ─── Forked Message Set Construction ──────────────────────────────────────────

/**
 * Build the forked conversation messages for a child agent.
 *
 * For prompt cache sharing, all fork children must produce byte-identical
 * API request prefixes. This function:
 * 1. Clones the full parent assistant message (all tool_use blocks, thinking, text)
 * 2. Builds a single user message with `tool_result` blocks for every `tool_use`
 *    block using an identical placeholder, then appends a per-child directive
 *    text block
 *
 * Result: `[assistant(all_tool_uses), user(placeholder_results..., directive)]`
 * Only the final text block differs per child, maximizing cache hits.
 *
 * If no tool_use blocks are found (edge case — no tool_use in assistant message),
 * falls back to a directive-only user message.
 *
 * MVP Reference: `forkSubagent.ts:107-169` — `buildForkedMessages()`
 * FR-002, FR-007, FR-009, Contract: fork-spawn.md
 */
export function buildForkedMessages(directive: string, assistantMessage: TranscriptMessage): TranscriptMessage[] {
  // Clone the assistant message to avoid mutating the original, keeping all
  // content blocks (thinking, text, and every tool_use)
  const fullAssistantMessage: TranscriptMessage = {
    ...assistantMessage,
    uuid: crypto.randomUUID(),
    content: Array.isArray(assistantMessage.content) ? [...assistantMessage.content] : assistantMessage.content,
  }

  // Collect all tool_use blocks from the assistant message
  const toolUseBlocks: Array<{ id: string; type: string }> = []
  if (Array.isArray(assistantMessage.content)) {
    for (const block of assistantMessage.content) {
      // biome-ignore lint/suspicious/noExplicitAny: transcript content blocks are loosely typed
      const b = block as any
      if (b.type === "tool_use" || b.type === "tool-call") {
        toolUseBlocks.push({ id: b.id ?? b.toolCallId, type: b.type })
      }
    }
  }

  if (toolUseBlocks.length === 0) {
    logger.warn("no tool_use blocks found in assistant message for fork directive; falling back to directive-only", {
      directive: directive.slice(0, 50),
    })
    return [
      {
        isSidechain: true,
        uuid: crypto.randomUUID(),
        parentUuid: fullAssistantMessage.uuid,
        role: "user",
        content: [{ type: "text" as const, text: buildChildMessage(directive) }],
        timestamp: Date.now(),
      },
    ]
  }

  // Build tool_result blocks for every tool_use, all with identical placeholder text
  const toolResultBlocks = toolUseBlocks.map((block) => ({
    type: "tool_result" as const,
    tool_use_id: block.id,
    content: [
      {
        type: "text" as const,
        text: FORK_PLACEHOLDER_RESULT,
      },
    ],
  }))

  // Build a single user message: all placeholder tool_results + the per-child directive
  const toolResultMessage: TranscriptMessage = {
    isSidechain: true,
    uuid: crypto.randomUUID(),
    parentUuid: fullAssistantMessage.uuid,
    role: "user",
    content: [
      ...toolResultBlocks,
      {
        type: "text" as const,
        text: buildChildMessage(directive),
      },
    ],
    timestamp: Date.now(),
  }

  return [fullAssistantMessage, toolResultMessage]
}

// ─── Worktree Notice ──────────────────────────────────────────────────────────

/**
 * Notice injected into fork children running in an isolated worktree.
 * Tells the child to translate paths from the inherited context, re-read
 * potentially stale files, and that its changes are isolated.
 *
 * MVP Reference: `forkSubagent.ts:205-210` — `buildWorktreeNotice()`
 * FR-006, Data model: entity 9
 */
export function buildWorktreeNotice(parentCwd: string, worktreePath: string): string {
  return `You've inherited the conversation context above from a parent agent working in ${parentCwd}. You are operating in an isolated git worktree at ${worktreePath} — same repository, same relative file structure, separate working copy. Paths in the inherited context refer to the parent's working directory; translate them to your worktree root. Re-read files before editing if the parent may have modified them since they appear in the context. Your changes stay in this worktree and will not affect the parent's files.`
}
