# System Prompt Architecture & Resolution in liteai2

This document provides an in-depth technical analysis of how `liteai2` dynamically determines, constructs, and caches system prompts across different execution phases and subagents.

Unlike traditional setups that rely on static Markdown prompts, `liteai2` builds its system prompts as structured arrays, utilizing memoization, strict boundaries for Anthropic prompt caching, and priority-based overrides.

---

## 1. Composition Mechanics: The Default Prompt

The primary construction of the baseline system prompt occurs in `src/constants/prompts.ts` via the `getSystemPrompt` function. Instead of concatenating a single monolith, the prompt is divided into **static core sections** and **dynamic registry-managed sections**.

### 1a. The Static Core
The very beginning of the prompt array is formed by direct function calls that rarely change across an organization's executions:
*   `getSimpleIntroSection()`: Base identity.
*   `getSimpleSystemSection()`: Permissions and reminders.
*   `getSimpleDoingTasksSection()`: Coding standards.
*   `getActionsSection()`: Blast radius limits for shell execution.

### 1b. The `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`
To heavily optimize Anthropic API caching, the array inserts an explicit string marker: `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`. 
* Everything **before** this marker is static and scoped to `global` cache behavior (hitting across identical installations). 
* Everything **after** this marker contains session-specific data that must not fragment the upstream cache map.

### 1c. Dynamic Memoized Sections
After the boundary, the array is populated via the `systemPromptSection` utility (from `src/constants/systemPromptSections.ts`). 
```typescript
type SystemPromptSection = { name: string, compute: () => string | null, cacheBreak: boolean }
```
Using `resolveSystemPromptSections()`, these segments are asynchronously resolved and memoized. Sections are only re-computed if explicitly flagged (like `DANGEROUS_uncachedSystemPromptSection` used for MCP connection injection, which busts the prompt cache if a server connects mid-turn).

---

## 2. Priority Resolution: `buildEffectiveSystemPrompt`

When a session turn begins, `src/utils/systemPrompt.ts` evaluates `buildEffectiveSystemPrompt` to decide which prompt array takes precedence. 

### Priority 0: `overrideSystemPrompt`
If provided, it returns `asSystemPrompt([overrideSystemPrompt])`. All default assemblies and environment concatenations are entirely discarded.

### Priority 1: Coordinator Mode
If the user is running the main session (`CLAUDE_CODE_COORDINATOR_MODE` is truthy) and there is no active `mainThreadAgentDefinition`, the engine **bypasses the default prompt entirely**. 
It executes:
`import('../coordinator/coordinatorMode').getCoordinatorSystemPrompt()`

Instead of getting `getSimpleIntroSection`, the AI gets a completely customized orchestrator identity (see *Effective Prompts* below). The result is directly wrapped with the environmental state (`appendSystemPrompt`).

### Priority 2: Sub-Agent Overrides
If a `mainThreadAgentDefinition` exists (e.g. `Plan` or `Explore` agent):
*   **Standard Operation:** It calls `mainThreadAgentDefinition.getSystemPrompt()` and completely replaces the default prompt array.
*   **Proactive Mode:** If KAIROS is active, it takes the `defaultSystemPrompt` array and appends the agent's definitions at the end under `# Custom Agent Instructions`, preventing the agent from losing its base autonomous directives.

### Priority 3 & 4: Custom Flags and Default Fallback
If priority 1 and 2 fail, it falls back to a user-provided `--system-prompt` OR the `defaultSystemPrompt` calculated in Section 1. Note: `appendSystemPrompt` (OS environment, current directory, shell) is always appended unless blocked by Priority 0.

---

## 3. Effective Prompts: Architectural Breakdown

### A. Main Thread (The Coordinator)
*Resolved via `src/coordinator/coordinatorMode.ts`*
Because `buildEffectiveSystemPrompt` skips the default prompt arrays when no agent definition exists, the main session takes on the identity of a pure project manager.
*   **The Identity:** *"You are Claude Code, an AI assistant that orchestrates software engineering tasks across multiple workers."*
*   **Core Mechanics:** The system prompt explicitly trains the model to parse `<task-notification>` XML blocks (which arrive asynchronously as pseudo-user-messages from background workers). 
*   **Directives:** It is aggressively instructed to parallelize tasks ("Parallelism is your superpower"), write synthesized instructions to workers, and determine whether to inherit context via a `SendMessageTool` or fork a clean slate via the `AgentTool`.

### B. The Plan Sub-Agent (`src/tools/AgentTool/built-in/planAgent.ts`)
*Resolved via Priority 2 Replacement*
*   **The Identity:** *"You are a software architect and planning specialist for Claude Code... Your role is to explore the codebase and design implementation plans."*
*   **Restricted Tooling:** The prompt dictates `"=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ==="`. The agent is denied access to `FILE_WRITE_TOOL_NAME` and `FILE_EDIT_TOOL_NAME`, and explicitly instructed that `mkdir`, `touch`, and `rm` will fail to execute.
*   **Context Safety (`omitClaudeMd: true`):** The Plan definition actively excludes `CLAUDE.md` ingestion from its context window, as project formatting and commit rules are deemed irrelevant visual noise for pure architectural planning.

### C. The Explore Sub-Agent (`src/tools/AgentTool/built-in/exploreAgent.ts`)
*Resolved via Priority 2 Replacement*
*   **The Identity:** *"You are a file search specialist for Claude Code... "*
*   **Speed Optimization:** Instructed to use `Explore` with a focus on parallelism (`"Wherever possible you should try to spawn multiple parallel tool calls for grepping and reading files"`).
*   **Embedded vs Global:** The prompt executes a runtime check (`hasEmbeddedSearchTools()`). If it finds built-in standard binaries, it instructs the agent to use `find` and `grep` exclusively via `BashTool` rather than proxying through generic `GlobTool` or `GrepTool` endpoints.
*   **Token Economics:** Anthropic personnel receive full model inheritance (`inherit`), while public deployments fallback strictly to `claude-3-5-haiku` to execute massive multi-file scans cheaply and rapidly before returning data to the Coordinator.
