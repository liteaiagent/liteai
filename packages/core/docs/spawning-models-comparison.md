# Subagent Spawning Models: Standard vs. Fork

> **Looking for the full picture?** See [Agent Execution Modes](./agent-execution-modes.md) for a comprehensive guide to all agent modes (Normal, Fork, Plan, Coordinator, Swarm), their relationships, and how to switch between them. This document focuses specifically on the **spawning mechanics** comparison.

LiteAI supports two distinct architectural models for spawning subagents. While both are triggered using the same `task` tool from the agent's perspective, they serve completely different purposes behind the scenes.

This document breaks down the differences between the **Standard Subagent Spawn** (the default behavior) and the **Fork Subagent Model** (a cost/performance optimization).

---

## 1. Standard Subagent Spawn (The Default)

The Standard Spawn model is designed for **clean isolation and flexibility**. It is the default behavior for delegating tasks when `LITEAI_FORK_SUBAGENT` is disabled.

*   **Goal:** Provide the subagent with a clean slate to solve an isolated problem without inheriting the parent's conversational baggage.
*   **Conversation History:** **Clean.** The subagent starts with an empty `messages` array. It has no memory of the conversation that took place in the parent session.
*   **System Prompt:** **Fresh.** The subagent receives a newly generated system prompt tailored specifically to its `agentType` (e.g., `explore`, `plan`, `code`). It does **not** get the parent's system prompt.
*   **Context Rules (`.liteai.md`):** **Appended by default.** By default, both built-in agents and custom user agents *will* receive the project's `.liteai.md` rules appended to their system prompt. This omission is **not** up to the parent AI to choose dynamically at spawn time. Instead, it is hardcoded in the subagent's definition file. To prune this context and save tokens, the subagent's markdown definition file must explicitly declare `omitLiteaiMd: true` in its YAML frontmatter.
*   **LLM API Prefix:** Because the system prompt and conversation history are completely different, the API request sent to the upstream LLM provider is entirely unique. **This means no prompt cache sharing with the parent.**
*   **Tool Execution:** The subagent makes its own independent decisions regarding which tools it needs and requires its own permission approvals.

## 2. Fork Subagent Model (Opt-In Optimization)

The Fork Subagent Model is a highly specialized architectural path designed strictly for **extreme cost and performance optimization**. It is gated by the `LITEAI_FORK_SUBAGENT` feature flag.

*   **Goal:** Maximize LLM upstream prompt caching (e.g., Anthropic Prompt Caching) to reduce per-spawn token costs by ≥80% and drastically improve time-to-first-token.
*   **Conversation History:** **Inherited (Byte-for-Byte).** The fork child inherits the *exact* conversation context of the parent up to the moment it was spawned. 
*   **System Prompt:** **Inherited (Byte-for-Byte).** The fork child skips standard system prompt generation and instead uses the parent's exact rendered system prompt.
*   **LLM API Prefix (The Cache Trick):** By ensuring the System Prompt + Conversation History are byte-identical to the parent's preceding turn, the LLM provider hits its prompt cache. The only difference is the *very last* user message (the "directive"), which tells the fork child what it needs to accomplish.
*   **Behavioral Contract:** Because the fork child shares the entire context and prompt of the parent, it is bound by a strict internal contract:
    *   Do not chat or converse.
    *   Do not spawn other subagents (recursion is blocked).
    *   Accomplish the directive silently in the background.
    *   Report back using a strict format in under 500 words.

## 3. The `task` Tool Abstraction

From the perspective of an active agent, **there is no difference in how these models are invoked.** 

You always use the **`task`** tool to spawn a subagent. The underlying execution engine handles the routing dynamically:

1. The agent invokes the `task` tool with a `subagent_type`.
2. The engine evaluates the execution environment (e.g., is the `LITEAI_FORK_SUBAGENT` flag enabled? Is this an interactive session?).
3. If the criteria are met, the engine performs a **Fork Spawn** under the hood.
4. If not, it falls back to a **Standard Spawn**.

This abstraction allows the core orchestration logic to seamlessly upgrade subagents to cost-optimized forks without requiring changes to how agents issue tools.
