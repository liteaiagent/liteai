# Modular Prompt System & System Reminders — liteai_cli_mvp

> Source: `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\src\constants\systemPromptSections.ts`, `prompts.ts`, `utils\systemPrompt.ts`

---

## Overview

liteai_cli_mvp's prompt system is divided into **cached** and **uncached** sections, with a precise boundary (`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`) that separates globally-cacheable static content from per-session dynamic content. The `DANGEROUS_uncachedSystemPromptSection()` function is the mechanism for injecting volatile content that must recompute every turn.

---

## 1. System Prompt Sections Registry

**Source:** [`systemPromptSections.ts`](../../liteai_cli_mvp/src/constants/systemPromptSections.ts)

### The Section Types

```ts
// Normal section — cached, recomputed only when hash changes
function systemPromptSection(
  name: string,
  compute: () => string | null | Promise<string | null>
): SystemPromptSection

// DANGEROUS section — breaks prompt cache intentionally
function DANGEROUS_uncachedSystemPromptSection(
  name: string,
  compute: () => string | null | Promise<string | null>,
  reason: string  // REQUIRED: why this needs to be uncached
): SystemPromptSection
```

### Resolution

```ts
async function resolveSystemPromptSections(
  sections: SystemPromptSection[]
): Promise<string[]> {
  // Resolves all sections concurrently
  // Filters out null results
  // Returns array of prompt strings
}
```

### Why `DANGEROUS_`?

The naming convention is **intentionally alarming**. Breaking the prompt cache has measurable fleet-wide cost. The required `reason` parameter forces developers to document WHY the cache break is necessary.

---

## 2. Cache Boundary

```ts
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'
```

Everything **before** increases `cacheScope: 'global'` hit rate. Everything **after** is per-session/per-turn.

### Prompt Structure

```ts
return [
  // --- Static content (cacheable globally) ---
  getSimpleIntroSection(outputStyleConfig),       // Identity + cyber risk
  getSimpleSystemSection(),                        // Hook/tag/permission rules
  getSimpleDoingTasksSection(),                    // Code style + task guidance
  getActionsSection(),                             // Reversibility/risk guidance
  getUsingYourToolsSection(enabledTools),           // Tool preference hierarchy
  getSimpleToneAndStyleSection(),                  // Emojis, formatting, references
  getOutputEfficiencySection(),                    // Conciseness rules
  
  // === BOUNDARY MARKER ===
  ...(shouldUseGlobalCacheScope() ? [SYSTEM_PROMPT_DYNAMIC_BOUNDARY] : []),
  
  // --- Dynamic content (registry-managed) ---
  ...resolvedDynamicSections,
].filter(s => s !== null)
```

---

## 3. Dynamic Sections — What Lives After the Boundary

| Section Name | Cached? | Purpose |
|---|---|---|
| `session_guidance` | Yes (normal) | Agent tool tips, skill guidance, fork behavior |
| `memory` | Yes (normal) | CLAUDE.md / memory files |
| `ant_model_override` | Yes (normal) | Ant-only model override text |
| `env_info_simple` | Yes (normal) | CWD, platform, model info |
| `language` | Yes (normal) | Language preference |
| `output_style` | Yes (normal) | Custom output style config |
| **`mcp_instructions`** | **UNCACHED** | MCP server instructions — servers connect/disconnect between turns |
| `scratchpad` | Yes (normal) | Scratchpad directory instructions |
| `frc` | Yes (normal) | Function result clearing guidance |
| `summarize_tool_results` | Yes (normal) | Tool result summarization |
| `numeric_length_anchors` | Yes (normal) | Word count limits (ant-only) |
| `token_budget` | Yes (normal) | Token budget tracking |
| `brief` | Yes (normal) | Kairos brief section |

### The One DANGEROUS Section: MCP Instructions

```ts
DANGEROUS_uncachedSystemPromptSection(
  'mcp_instructions',
  () => isMcpInstructionsDeltaEnabled()
    ? null  // New delta path — instructions arrive via attachments
    : getMcpInstructionsSection(mcpClients),
  'MCP servers connect/disconnect between turns',
)
```

MCP servers can connect/disconnect between turns (e.g., late-connecting servers). The instructions section must reflect the current state, even if it means breaking the cache.

**Migration path:** The `mcp_instructions_delta` feature flag switches to announcing MCP instructions via persisted attachments instead, **restoring cache stability** for this section.

---

## 4. System Reminders via Attachments

**Not part of the system prompt.** These are injected into **user messages** via the attachment system:

### `system-reminder` Tags

```xml
<system-reminder>
Skills relevant to your task:
- commit: Create a conventional commit
- review-pr: Review a pull request
</system-reminder>
```

The system prompt tells the model:

> _"Tool results and user messages may include `<system-reminder>` tags. These contain useful information and reminders. They are automatically added by the system, and bear no direct relation to the specific tool results or user messages in which they appear."_

### Attachment Types

| Attachment Type | Purpose | Frequency |
|---|---|---|
| `plan_full` | Full plan text | Every 5 turns in plan mode |
| `plan_sparse` | Plan path + "stay on track" | Every turn in plan mode |
| `skill_discovery` | Relevant skills for current task | Every turn |
| `mcp_instructions_delta` | New/changed MCP instructions | On connect/disconnect |
| `hook_additional_context` | Hook-injected context | On event triggers |
| `memory_saved` | Memory save notification | After auto-memory |

---

## 5. `criticalSystemReminder_EXPERIMENTAL`

Agents can define a short string that gets re-injected at **every user turn**:

```ts
type BaseAgentDefinition = {
  criticalSystemReminder_EXPERIMENTAL?: string
  // ...
}
```

This is NOT a DANGEROUS_uncached section — it's injected via the context, not the system prompt. Use case: anchoring agent behavior that must not drift (e.g., "You are a code reviewer. Never approve code with security vulnerabilities.").

---

## 6. Proactive/KAIROS Override

When `PROACTIVE` or `KAIROS` feature flags are active and the proactive module is running, the **entire system prompt is replaced** with a minimal autonomous-agent prompt:

```ts
if (proactiveModule?.isProactiveActive()) {
  return [
    `You are an autonomous agent. Use the available tools to do useful work.\n\n${CYBER_RISK_INSTRUCTION}`,
    getSystemRemindersSection(),
    await loadMemoryPrompt(),
    envInfo,
    // ... minimal sections only
  ]
}
```

---

## Comparison: liteai vs liteai_cli_mvp (Prompt System)

| Dimension | liteai | liteai_cli_mvp |
|---|---|---|
| Prompt structure | Single template string | Section registry with compute functions |
| Caching | No boundary | Explicit static/dynamic boundary |
| Cache-breaking | Not considered | Named DANGEROUS_ mechanism with reasons |
| Reminders | None | Attachment-based system-reminders |
| Critical reminders | None | Per-agent `criticalSystemReminder_EXPERIMENTAL` |
| MCP instructions | Static at start | Dynamic — uncached or delta-based |
| Tool-aware prompts | Static per-tool hints | Dynamic based on enabled tool set |
| Proactive mode | N/A | Full prompt override for autonomous agents |
