# Prompt Construction Architecture

This document analyzes how system prompts are constructed for standard execution versus when the Plan Agent is selected in LiteAI.

## The `<directories>` Section

The `<directories>` section is currently injected as part of the environment context. 
It is defined in `packages/core/src/session/engine/system.ts` within the `SystemPrompt.environment(model)` function. Currently, it is hardcoded to return an empty string block:

```typescript
// From packages/core/src/session/engine/system.ts
[
  ...
  `<directories>`,
  `  `,
  `</directories>`,
].join("\n")
```

## Normal Mode Prompt Construction

In standard execution, the prompt is dynamically assembled in `packages/core/src/session/llm.ts` and `packages/core/src/session/engine/loop.ts`. The order of construction is:

1. **Provider Instructions (`llm.ts`)**: The prompt begins with `SystemPrompt.provider(model)`. This injects base behavioral rules tailored to the specific LLM provider (e.g., Anthropic, Gemini, OpenAI) utilizing templates from `packages/core/src/session/templates/`.
2. **Environment Context (`loop.ts` -> `system.ts`)**: Appends the environment status (`SystemPrompt.environment(model)`). This includes the current working directory, workspace root, OS platform, active shell, date, and the `<directories>` block.
3. **Skills Definition (`loop.ts` -> `system.ts`)**: Compiles and appends formatting for all permitted workspace skills (`SystemPrompt.skills(agent)`).
4. **User/Project Instructions (`loop.ts` -> `instruction.ts`)**: Appends user-defined systemic instructions via `InstructionPrompt.system()`.
5. **Structured Output Constraints (`loop.ts`)**: If the current turn requires structured JSON, the `STRUCTURED_OUTPUT_SYSTEM_PROMPT` is appended to force schema compliance.

## Plan Agent Mode Prompt Construction

When the "plan" agent is active, the engine alters the standard assembly sequence to enforce strict read-only execution and structured planning phases.

1. **Agent-Specific Override (`llm.ts` & `plan.md`)**:
   Instead of falling back to standard provider prompts, `llm.ts` detects the agent definition and swaps the primary system prompt. It injects the contents of `packages/core/src/agent/agents/plan.md`. This file contains a `<system-reminder>` that restricts the agent strictly to **Read-Only** tool usage and designates `.liteai/plans/*.md` as the exclusively editable target.

2. **Environment & Skills**: 
   These remain identical to Normal Mode and form the core middle sections of the context.

3. **In-Flight Plan Reminders (`plan-reminder.ts`)**:
   Before the prompt context resolves, `insertPlanReminder()` intercepts the pending message stack. If it detects that Plan Mode was just activated, it artificially injects a `synthetic` text part appended to the latest user message. This piece acts as an ephemeral reminder defining the **Plan Workflow**:
   - Updates the model on whether a `.liteai/plans/` markdown file currently exists or needs to be drafted.
   - Mandates a strict 5-Phase workflow (Phase 1: Initial Understanding, Phase 2: Design, Phase 3: Review, Phase 4: Final Plan, Phase 5: Call plan_exit target).
   - Instructs the AI on utilizing concurrent `explore` sub-agents to map the codebase.

By sandwiching the agent with `plan.md` at the top of the context and `plan-reminder.ts` synthetically at the bottom, LiteAI strictly scopes the LLM into a safe exploration state before any code execution can transpire.
