# Prompt Engineering

How the system prompt is assembled, how agent vs provider prompts are selected, and how
tools, skills, and instruction files are woven into the final prompt sent to the LLM.

---

## 1. Architecture Overview

Every LLM call goes through `LLM.stream()` in [`llm.ts`](file:///src/session/llm.ts).
This function **assembles the system prompt** from multiple layers, applies provider
transforms, and sends the request. The final message array looks like this:

```
┌────────────────────────────────────────────────────────┐
│  System Message 1 (single string, stable for caching)  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Part A: Agent prompt  OR  Provider prompt       │  │
│  │          ↓ joined with "\n"                      │  │
│  │  Part B: Environment block     (§3.2)            │  │
│  │  Part C: Skills block          (§3.3)            │  │
│  │  Part D: Instruction files     (§3.4)            │  │
│  │  Part E: User system prompt    (§3.5)            │  │
│  └──────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────┤
│  System Message 2+ — Plugin transforms         (§4)    │
├────────────────────────────────────────────────────────┤
│  Conversation messages + inline injections     (§5)    │
├────────────────────────────────────────────────────────┤
│  Tool definitions                              (§6)    │
└────────────────────────────────────────────────────────┘
```

Key design principle: the first system message is kept **stable across turns** so
providers that support prompt caching (Anthropic, OpenAI) can cache it. Dynamic parts
(plugin transforms) are pushed to subsequent system messages. If a plugin does not modify
the first message, the two-part split is preserved.

---

## 2. Agent Prompt vs Provider Prompt

This is the central routing decision and happens at
[`llm.ts:72`](file:///src/session/llm.ts#L72):

```typescript
...(input.agent.prompt
  ? [input.agent.prompt]
  : isCodex
    ? []
    : SystemPrompt.provider(input.model)),
```

### 2.1 Decision rules

| Condition | Prompt source |
|---|---|
| Agent has a `prompt` field set | Use the **agent prompt** (verbatim text from config or native definition) |
| Provider is OpenAI with OAuth (Codex) | **No provider prompt** — the Codex instructions are sent via `options.instructions` instead of as a system message |
| Neither of the above | **Provider prompt** — selected by `SystemPrompt.provider()` based on model ID pattern matching |

### 2.2 Provider prompt selection

`SystemPrompt.provider()` in [`system.ts`](file:///src/session/system.ts) dispatches
based on substrings in the model's API ID:

| Model ID pattern | Prompt template | File |
|---|---|---|
| `gpt-5` | codex_header | [`codex_header.txt`](file:///src/session/prompt/codex_header.txt) |
| `gpt-*`, `o1*`, `o3*` | beast | [`beast.txt`](file:///src/session/prompt/beast.txt) |
| `gemini-*` | gemini | [`gemini.txt`](file:///src/session/prompt/gemini.txt) |
| `claude*` | anthropic | [`anthropic.txt`](file:///src/session/prompt/anthropic.txt) |
| `*trinity*` (case-insensitive) | trinity | [`trinity.txt`](file:///src/session/prompt/trinity.txt) |
| *(anything else)* | qwen (fallback) | [`qwen.txt`](file:///src/session/prompt/qwen.txt) |

The matching is evaluated top-to-bottom — the first match wins.

### 2.3 Native agent prompts (override provider prompt)

Native agents can set a `prompt` field directly in their definition. When set, this
**completely replaces** the provider prompt. The provider prompt is not appended.

| Agent | Has prompt? | Source |
|---|---|---|
| `build` | No | Uses provider prompt |
| `plan` | No | Uses provider prompt |
| `general` | No | Uses provider prompt |
| `explore` | **Yes** | [`agent/prompt/explore.txt`](file:///src/agent/prompt/explore.txt) |
| `compaction` | **Yes** | [`agent/prompt/compaction.txt`](file:///src/agent/prompt/compaction.txt) |
| `title` | **Yes** | [`agent/prompt/title.txt`](file:///src/agent/prompt/title.txt) |
| `summary` | **Yes** | [`agent/prompt/summary.txt`](file:///src/agent/prompt/summary.txt) |

### 2.4 User-defined agents via markdown files

Agents can be defined as markdown files instead of (or in addition to) JSON config.
This is the primary way users create custom agents with entirely custom prompts.

#### Discovery

`Config.loadAgent()` in [`config.ts`](file:///src/config/config.ts) scans for
`agents/*.md` in each `.liteai` config directory. The directories searched
are (in precedence order, lowest first):

1. Global: `~/.liteai/`
2. Project-level: `.liteai/` directories from workspace root to current working directory

Agent files from higher-precedence directories overwrite lower ones with the same name.

#### File format

Agent markdown files use **YAML frontmatter** (parsed by `gray-matter`) for configuration
and the **markdown body** as the agent's system prompt:

```markdown
---
description: Code review specialist
model: anthropic/claude-sonnet-4-20250514
mode: subagent
temperature: 0.3
---
You are a code review specialist. Focus on:
- Security vulnerabilities
- Performance issues
- Code style consistency

Review the code provided and give detailed feedback.
```

The filename (without `.md`) becomes the agent's name. For example,
`.liteai/agents/reviewer.md` creates an agent named `reviewer`.

#### Supported frontmatter fields

| Field | Type | Description |
|---|---|---|
| `description` | string | When to use the agent (shown in task tool and UI) |
| `model` | string | Default model in `provider/model-id` format |
| `variant` | string | Model variant to use |
| `mode` | `"subagent"` \| `"primary"` \| `"all"` | Whether the agent is a primary agent, sub-agent, or both |
| `temperature` | number | LLM sampling temperature |
| `top_p` | number | Top-p sampling parameter |
| `steps` | number | Maximum agentic iterations before forcing text-only |
| `color` | string | Hex color (`#FF5733`) or theme color (`primary`) |
| `hidden` | boolean | Hide from the `@` autocomplete menu |
| `permission` | object | Tool/action permission ruleset (see below) |

Any unknown frontmatter keys are passed through as `options` (provider-specific settings).

#### Tool permissions

User-defined agents **have access to all tools by default**. They inherit the same
default permission set as `build` (`"*": "allow"`), merged with any global
`permission` config from `liteai.json`.

To restrict tool access, set the `permission` field in the frontmatter. The format
matches the top-level `permission` config schema — keys are tool names (or `"*"` for
all), values are `"allow"`, `"deny"`, or `"ask"`. For tools that accept arguments
(like `bash` or `skill`), values can be objects with **pattern-based rules**:

```markdown
---
description: CI/CD specialist that deploys and tests but cannot edit source code
mode: subagent
model: anthropic/claude-sonnet-4-20250514
permission:
  # Start by denying all tools
  "*": deny
  # Allow read-only exploration
  read: allow
  grep: allow
  glob: allow
  list: allow
  # Allow shell, but only specific commands
  bash:
    "npm test*": allow
    "npm run build*": allow
    "docker *": allow
    "kubectl *": allow
    "*": deny
  # Allow only the deploy skill
  skill:
    "deploy": allow
    "*": deny
  # Allow reading Kubernetes manifests outside the project
  external_directory:
    "/etc/kubernetes/*": allow
    "*": deny
---
You are a CI/CD specialist. You can run tests, build, and deploy
but you cannot edit source code. Use the `deploy` skill when asked
to deploy the application.
```

Permission keys correspond to tool names: `bash`, `edit`, `read`, `grep`, `glob`,
`list`, `task`, `skill`, `webfetch`, `websearch`, `external_directory`, etc.

The `skill` permission has a **dual effect**: when denied entirely (`skill: deny`), it
removes both the `skill` tool AND the skills block from the system prompt (§3.3). The
LLM won't know skills exist at all. With pattern-based rules (as shown above), only
matching skills appear. See [skills.md](file:///docs/skills.md) for full details.

#### How it integrates with the prompt pipeline

The markdown body is stored as the agent's `prompt` field. This means it follows the
same rule as native agent prompts (§2.3): **it completely replaces the provider prompt**.
The agent still receives the environment block, skills, and instruction files — only the
base prompt layer is overridden.

User-defined agents via `liteai.json` can also set a `prompt` field (as a string),
which works identically. The markdown file approach is more ergonomic for long prompts.

### 2.5 Codex (OpenAI OAuth) special path

When the provider is OpenAI and authentication is via OAuth (Codex sessions), the system
works differently:

1. The **provider prompt is skipped** from the system messages.
2. Instead, `SystemPrompt.instructions()` (which returns `codex_header.txt`) is sent
   via the `options.instructions` parameter — a Codex-specific API field.

This allows the Codex API to handle the instructions natively rather than as a system
message.

---

## 3. System Message 1 — Internal Parts

System Message 1 is a **single concatenated string**. It is built in `LLM.stream()` by
joining multiple parts with `"\n"`. These parts are not separate messages — they are
sub-sections within one string. The parts are described below in concatenation order.

### 3.1 Part A — Base prompt (agent or provider)

As described in §2. This is the largest block and defines the LLM's identity, tone,
tool usage policies, task workflows, and behavioral guidelines. Each provider prompt is
tailored to the model family's strengths and conventions.

### 3.2 Part B — Environment block

`SystemPrompt.environment()` in [`system.ts`](file:///src/session/system.ts) generates
a structured environment description:

```xml
You are powered by the model named <model-id>. The exact model ID is <provider>/<model>
Here is some useful information about the environment you are running in:
<env>
  Working directory: /path/to/cwd
  Workspace root folder: /path/to/root
  Is directory a git repo: yes
  Platform: linux
  Today's date: Sun Mar 15 2026
</env>
```

This gives the LLM awareness of its runtime context — platform, paths, date, and
VCS status.

### 3.3 Part C — Skills block

`SystemPrompt.skills()` in [`system.ts`](file:///src/session/system.ts) lists available
skills for the agent. Skills are only included if the agent's permission rules do not
deny the `skill` permission.

The skills block appears as:

```xml
Skills provide specialized instructions and workflows for specific tasks.
Use the skill tool to load a skill when a task matches its description.
<available_skills>
  <skill>
    <name>my-skill</name>
    <description>Does something useful</description>
    <location>file:///path/to/SKILL.md</location>
  </skill>
</available_skills>
```

Skills are **not** loaded into the system prompt directly. Instead, the system prompt
tells the LLM about their existence, and the LLM uses the `skill` tool to load one
on demand. When loaded, the skill's content is injected into the tool output, not into
the system prompt.

### 3.4 Part D — Instruction files (AGENTS.md, CLAUDE.md)

`InstructionPrompt.system()` in [`instruction.ts`](file:///src/session/instruction.ts)
gathers user-authored instruction files from multiple locations. All discovered files
from all sources are **merged together** into the system prompt.

#### Search sources

1. **Project-level** — tries each filename in order: `AGENTS.md`, `CLAUDE.md`,
   `CONTEXT.md` *(deprecated)*. The first **filename** that has any matches wins (the
   others are not searched). For that filename, `findUp` walks from `cwd` to the
   workspace root and returns **every instance found at each directory level**. For
   example, if both `src/AGENTS.md` and `./AGENTS.md` exist, both are included.

2. **Global-level** — checks the following paths in order and includes only the
   **first** match:
   - `$LITEAI_CONFIG_DIR/AGENTS.md` (if env var is set)
   - `~/.config/liteai/AGENTS.md`
   - `~/.claude/CLAUDE.md` (only when `$LITEAI_ENABLE_CLAUDE_CODE` is set)

3. **Config `instructions` array** — **all** entries from `liteai.json` are loaded:
   - File paths (absolute or relative) are resolved and their content is read.
   - URLs (`https://...`) are fetched with a 5-second timeout.

Results from all three sources are collected and concatenated. Each loaded file is
prefixed with `Instructions from: <path>` to give the LLM context about where the
instructions came from.

#### Subdirectory instruction files

In addition to the system-level files above, `InstructionPrompt.resolve()` is called
when the LLM reads a file via the `read` tool. It walks up from the read file's
directory to the project root, looking for `AGENTS.md`/`CLAUDE.md`/`CONTEXT.md` files
that are:
- Not already loaded as system instructions
- Not already in the conversation history
- Not already claimed by the current message

These are injected alongside the file read output, providing directory-scoped
instructions.

### 3.5 Part E — User-provided system prompt

The prompt input can include a `system` field (e.g. when using the SDK). This is appended
after all other layers.

---

## 4. System Message 2+ — Plugin Transforms

System Message 2 only exists when plugins modify or extend the system prompt. It is
produced by the `experimental.chat.system.transform` plugin hook, which runs after
System Message 1 is assembled.

### 4.1 How it works

After System Message 1 is built, `LLM.stream()` passes the `system[]` array to any
registered plugin transforms. Plugins can:

- **Append** new system messages (most common)
- **Modify** existing messages
- **Reorder** the array

After the transform runs, `LLM.stream()` checks whether System Message 1 was modified.
If it was **not** modified, any new entries from the plugin are pushed into System
Message 2 (preserving the stable first message for caching). If it **was** modified,
the entire array is sent as-is.

### 4.2 Prompt caching strategy

The two-message split exists to maximize cache hits. Providers with prefix-based caching
(Anthropic's prompt caching, OpenAI's response API) can cache the stable System Message 1
across turns. System Message 2 contains only the dynamic plugin additions, which may
change between turns without invalidating the cache.

If no plugins are registered or if the plugin transform is a no-op, System Message 2
does not exist and only System Message 1 is sent.

### 4.3 Other plugin hooks

Beyond the system prompt transform, plugins can also modify other parts of the request:

| Hook | When | What it modifies |
|---|---|---|
| `experimental.chat.system.transform` | After system prompt assembly | The `system[]` array |
| `experimental.chat.messages.transform` | Before building the LLM call | The full message history array |
| `chat.params` | Before `streamText()` | temperature, topP, topK, and provider options |
| `chat.headers` | Before `streamText()` | HTTP headers sent to the provider |
| `tool.definition` | During tool resolution | Tool description and parameters |

---

## 5. Conversation Messages — Inline Injections

The conversation history (user ↔ assistant turns) is sent after the system messages.
Beyond the raw message history, certain prompts are injected inline as **synthetic
message parts** during the conversation loop.

### 5.1 Plan mode reminder

When the active agent is `plan`, the `PROMPT_PLAN` text is appended to the last user
message. This reminds the LLM that it must not make edits:

```xml
<system-reminder>
Plan mode ACTIVE - you are in READ-ONLY phase. STRICTLY FORBIDDEN:
ANY file edits, modifications, or system changes...
</system-reminder>
```

### 5.2 Build-switch reminder

When switching from `plan` to `build` agent mid-session, `BUILD_SWITCH` is injected:

```xml
<system-reminder>
Your operational mode has changed from plan to build.
You are no longer in read-only mode...
</system-reminder>
```

### 5.3 Max-steps reminder

When the agent reaches its configured step limit, the `MAX_STEPS` text is injected as
an assistant message prefix, telling the LLM that tools are disabled and it must respond
with text only.

### 5.4 Mid-loop user message wrapping

If a user sends a message while the LLM is mid-loop (after step 1), the user message
text is wrapped in `<system-reminder>` tags to remind the LLM to address it and continue
with its current task:

```xml
<system-reminder>
The user sent the following message:
<original message>

Please address this message and continue with your tasks.
</system-reminder>
```

---

## 6. Tool Definitions

Tools are passed as a **top-level API parameter** in the `streamText()` call — they are
not system messages, user messages, or assistant messages. The AI SDK serializes them into
the provider's native tool format (e.g. OpenAI's `tools` JSON field, Anthropic's `tools`
field). The LLM provider decides internally how the model "sees" them.

Tools are **re-computed and re-sent with every turn**. They are not persisted across
turns — each `streamText()` call builds the full tool set fresh based on the current
agent, model, and user overrides.

### 6.1 Dynamic tool descriptions

Some tool descriptions are generated at runtime based on the agent context:

| Tool | Dynamic description? | Description source |
|---|---|---|
| `task` | **Yes** | Lists available sub-agents and their descriptions from [`task.txt`](file:///src/tool/task.txt), with `{agents}` placeholder replaced at runtime |
| `skill` | **Yes** | Lists available skills with a condensed format (less verbose than the system prompt version) |
| MCP tools | No | Descriptions come from the MCP server |
| All others | No | Static descriptions from each tool's `.txt` file |

### 6.2 Tool filtering

The tool set is not the same for every agent or model. Filtering happens in two stages:

**Stage 1 — `ToolRegistry.tools()`** in [`registry.ts`](file:///src/tool/registry.ts)
builds the initial tool set based on model capabilities:

- **Model ID**: GPT-5+ models get `apply_patch` instead of `edit`/`write`. WebSearch
  and CodeSearch are only available for `liteai` provider or when the Exa flag is set.

**Stage 2 — `LLM.resolveTools()`** in [`llm.ts`](file:///src/session/llm.ts) removes
tools that should not be available for this specific call:

- **Agent `permission` field**: if the agent's permission ruleset denies a tool (e.g.
  `permission.task = "deny"`), the tool is removed. There is no separate "tools" config
  on agents — tool access is controlled entirely through the `permission` field (§2.4).
- **User overrides**: the `tools` field on the user message can disable specific tools
  (e.g. `{ task: false }`).

The result is that the LLM never sees tools it cannot use.

### 6.3 Structured output tool

When `format.type === "json_schema"` is set on the user message, two things happen:

1. A `StructuredOutput` tool is dynamically added to the tool set with the user's JSON
   schema as its input schema.
2. A system-level instruction is appended: *"You MUST use the StructuredOutput tool to
   provide your final response."*

This converts the free-form LLM output into validated structured data via tool calling.

---

## 7. Sub-agent Prompt Flow

When the LLM calls the `task` tool, a new **child session** is created and the sub-agent
runs independently. The prompt flow for sub-agents is:

```
Parent session (e.g. build agent)
  │
  └── task tool call
        │
        ├── Creates a new Session
        ├── Selects the sub-agent (e.g. explore, general)
        └── Calls SessionPrompt.prompt() with:
              ├── agent = sub-agent name
              ├── model = sub-agent's model OR parent's model
              └── parts = the prompt text from the task tool call
```

The sub-agent session goes through the same `LLM.stream()` path. This means:
- If the sub-agent has a custom `prompt` (like `explore`), it uses that.
- If not (like `general`), it falls back to the provider prompt.
- Environment, skills, and instruction files are all assembled fresh.
- The sub-agent has its own permission ruleset (merged from the agent definition and
  the child session's restrictions).

### 7.1 Sub-agent permission restrictions

By default, child sessions disable:
- `todowrite` and `todoread` (to-do list tools)
- `task` (prevents recursive sub-agent spawning, unless the sub-agent explicitly has
  task permission)

### 7.2 Sub-agent model selection

The sub-agent uses its own model if configured (`agent.model`), otherwise it inherits the
parent session's model.

---

## 8. Source Reference

| Component | File | Responsibility |
|---|---|---|
| Prompt loop & tool resolution | [`session/prompt.ts`](file:///src/session/prompt.ts) | Main session loop, tool assembly, inline reminders |
| LLM streaming | [`session/llm.ts`](file:///src/session/llm.ts) | System prompt assembly, streamText call |
| Provider prompt dispatch | [`session/system.ts`](file:///src/session/system.ts) | Model-based prompt selection, environment, skills |
| Instruction files | [`session/instruction.ts`](file:///src/session/instruction.ts) | AGENTS.md/CLAUDE.md discovery and loading |
| Agent definitions | [`agent/agent.ts`](file:///src/agent/agent.ts) | Native + user-defined agent config |
| Tool registry | [`tool/registry.ts`](file:///src/tool/registry.ts) | Tool list, filtering, plugin tools |
| Skill system | [`skill/skill.ts`](file:///src/skill/skill.ts) | Skill discovery, loading, formatting |
| Skill tool | [`tool/skill.ts`](file:///src/tool/skill.ts) | On-demand skill injection via tool call |
| Task tool (sub-agents) | [`tool/task.ts`](file:///src/tool/task.ts) | Child session creation, sub-agent dispatch |
| Provider prompts | [`session/prompt/*.txt`](file:///src/session/prompt/) | Model-family-specific base prompts |
| Agent prompts | [`agent/prompt/*.txt`](file:///src/agent/prompt/) | Agent-specific base prompts |
