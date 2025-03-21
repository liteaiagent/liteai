# System Prompt Pipeline

This document describes how the system prompt is assembled, transformed, and recorded across the session prompt pipeline. Understanding this pipeline is critical for debugging issues where the trace shows a different system prompt than what the LLM actually receives.

> **Related:**
> - [session.md](./session.md) — session lifecycle and prompt loop overview
> - [tracing.md](./tracing.md) — trace recording and viewing
> - [prompt-engineering.md](./prompt-engineering.md) — provider-specific prompt templates

---

## Architecture

The system prompt flows through three layers before reaching the LLM:

```
loop.ts (orchestrator)
  │  builds: [environment, skills, instructions]
  │
  ▼
processor.ts (stream manager)
  │  passes system[] to LLM.stream()
  │  captures resolvedSystem via onSystem callback
  │
  ▼
llm.ts (LLM interface)
     prepends: agent.prompt OR SystemPrompt.provider(model)
     appends:  user.system (per-message)
     applies:  plugin transforms, hook dispatch
     outputs:  final system[] sent to model
```

### Why Three Layers?

- **`loop.ts`** owns the session context — it knows the agent, model, skills, and instructions. It builds the "body" of the system prompt.
- **`llm.ts`** owns the LLM integration — it resolves the provider SDK, auth, and Codex detection. It determines whether to use the agent's custom prompt or the provider-specific prompt as the "header."
- **`processor.ts`** bridges the two — it manages the streaming lifecycle and captures the resolved system for trace recording.

---

## System Prompt Components

The final system prompt sent to the LLM is assembled from these components, in order:

### 1. Header (added by `llm.ts`)

One of the following, chosen by priority:

| Condition | Header |
|---|---|
| Agent has `prompt` field | `agent.prompt` (custom agent prompt) |
| Codex session (OpenAI OAuth) | *(skipped — sent via `options.instructions` instead)* |
| Provider is `google-code-assist` | `prompt/google-code-assist.txt` |
| Model ID contains `gemini-` | `prompt/gemini.txt` |
| Model ID contains `claude` | `prompt/anthropic.txt` |
| Model ID contains `gpt-5` | `prompt/codex_header.txt` |
| Model ID contains `gpt-` / `o1` / `o3` | `prompt/beast.txt` |
| Model ID contains `trinity` (case-insensitive) | `prompt/trinity.txt` |
| Default | `prompt/default.txt` |

**Source:** `SystemPrompt.provider()` in `src/session/system.ts`

### 2. Body (built by `loop.ts`, passed as `input.system`)

| Component | Source |
|---|---|
| Environment info | `SystemPrompt.environment(model)` — model name, working directory, platform, date |
| Skills | `SystemPrompt.skills(agent)` — available skill descriptions for the agent |
| Instructions | `InstructionPrompt.system()` — AGENTS.md, .claude/ instructions, etc. |
| Structured output | Appended if `format.type === "json_schema"` |

### 3. Per-message system prompt (added by `llm.ts`)

If the user message has a `system` field, it's appended to the system prompt.

---

## Assembly in `llm.ts`

All components are joined into a single string:

```typescript
system.push(
  [
    ...(agent.prompt ? [agent.prompt] : isCodex ? [] : SystemPrompt.provider(model)),
    ...input.system,        // body from loop.ts
    ...(user.system ? [user.system] : []),
  ]
    .filter((x) => x)
    .join("\n"),
)
```

After assembly, two transforms are applied:

1. **Plugin transform** — `experimental.chat.system.transform` hook allows plugins to modify the system array.
2. **Hook dispatch** — `InstructionsLoaded` hook notifies external integrations.

Finally, for prompt caching (Anthropic), the system is restructured into a 2-part array if the header is unchanged after transforms:

```typescript
// [header, rest] — header is cached, rest varies per request
if (system.length > 2 && system[0] === header) {
  system = [header, rest.join("\n")]
}
```

---

## Trace Recording

The trace captures the system prompt **after** the LLM stream completes, using the resolved system from `llm.ts`:

```typescript
// loop.ts — trace capture
const text = (processor.resolvedSystem ?? system).join("\n\n")
const hash = createHash("sha256").update(text).digest("hex")
```

- `processor.resolvedSystem` contains the full system prompt as sent to the LLM (including the header).
- Falls back to the `loop.ts` system array if the resolved system is not available (e.g., stream setup failure).
- The system prompt is **deduplicated** across trace steps using a SHA-256 hash — if the hash matches the previous step, `null` is stored and the `resolve()` function looks up the most recent non-null value.

### How the trace viewer resolves null systems

```
Trace.get(sessionID, traceID):
  row.system ?? resolve(sessionID, row.step, "system")
    → SELECT system FROM trace
       WHERE session_id = ? AND system IS NOT NULL AND step <= ?
       ORDER BY step DESC LIMIT 1
```

---

## Common Pitfalls

### Provider prompt not showing in trace

**Symptom:** The trace shows environment/skills/instructions but not the provider-specific prompt (e.g., `google-code-assist.txt`).

**Cause:** The provider prompt is added by `llm.ts`, not `loop.ts`. If the trace records the `loop.ts` system instead of the resolved system, the header is missing.

**Fix:** The trace now uses `processor.resolvedSystem` which captures the full system prompt via the `onSystem` callback from `LLM.stream()`.

### Agent prompt overrides provider prompt

**Symptom:** When using a custom agent (e.g., `code-improver` with its own prompt), the provider-specific prompt is not sent.

**Expected behavior:** This is intentional — `agent.prompt` replaces the provider prompt, not supplements it. If an agent needs provider-specific behavior, it should include relevant instructions in its own prompt.

### Duplicate provider prompt

**Symptom:** The provider prompt appears twice in the system.

**Cause:** Adding `SystemPrompt.provider()` to both `loop.ts` AND `llm.ts`. Only `llm.ts` should add the header — `loop.ts` provides the body only.

### Fire-and-forget title generation

**Symptom:** Unhandled `ProviderModelNotFoundError` rejection from `ensureTitle()`.

**Cause:** `ensureTitle()` is called without `await` at `loop.ts:272`. It internally calls `Provider.getModel()` and `LLM.stream()`. If either throws, the rejection is unhandled.

**Fix:** `ensureTitle()` now has a `.catch()` that logs the error instead of letting it become an unhandled rejection.

---

## Sub-agent System Prompt

Sub-agents (via the task tool) follow the same pipeline but with their own agent config:

1. **Model resolution** (`task.ts`): If the agent's configured model is invalid, falls back to the parent session's model.
2. **Agent prompt**: The sub-agent's `prompt` field (from its `.md` file) is used as the header, replacing the provider prompt.
3. **Isolation**: Sub-agent sessions have `parentID` set, which causes `ensureTitle()` to skip (the parent session handles titling).
4. **Permissions**: Sub-agent sessions inherit the parent's permission ruleset, merged with the agent-specific permissions.
