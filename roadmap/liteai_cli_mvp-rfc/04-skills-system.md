# Skills System — liteai_cli_mvp

> Source: `~\Documents\workspace\liteai_cli_mvp\src\skills\`, `src\tools\SkillTool\`

---

## Overview

liteai_cli_mvp's skill system is a **two-tier architecture**: skills are registered as metadata in the main agent's context, but their actual execution happens in a **forked sub-agent** — not in the main conversation loop. This prevents skill output from polluting the primary context window.

---

## 1. Skill Registration

### Bundled Skills (`bundledSkills.ts`)

Built-in skills are declared programmatically with:

```ts
type BundledSkillDefinition = {
  name: string
  description: string
  whenToUse: string
  
  // Reference files lazily extracted to disk on first invocation
  referenceFiles?: Record<string, string>
  
  // Dynamic prompt generation
  getCommandPrompt: (args: string, context: ToolUseContext) => Promise<ContentBlock[]>
  
  // Metadata
  disableModelInvocation?: boolean  // Hidden from model — user-only
  source: 'bundled'
}
```

**Lazy file extraction:** Bundled skills can declare `referenceFiles` — a map of `{ relativePath: fileContent }`. On first invocation, these are written to disk under a deterministic directory, giving the model a "base directory" for Read/Grep operations without shipping actual files in the prompt.

### Custom Skills (`loadSkillsDir.ts`)

User/project/plugin skills are loaded from markdown files with frontmatter:

```yaml
---
name: my-skill
description: What this skill does
whenToUse: When the AI should consider using this skill
tools: [Read, Edit, Bash]  # optional tool whitelist
agent: general-purpose      # optional: which agent type to use
allowedTools: [tool1, tool2] # permissions granted during execution
---

# Skill prompt content
```

**Loading pipeline:**

```
loadMarkdownFilesForSubdir('skills', cwd)
  → parse frontmatter + body
    → deduplicate by name (later sources override earlier)
      → register as Command objects
```

### Deduplication Order

Same as agents: `built-in < plugin < userSettings < projectSettings < flagSettings`

---

## 2. Skill Prompt in System Context

Skills are NOT listed verbatim in the system prompt. Instead:

### Budget-Constrained Listing

The skill listing gets **1% of the context window** (in characters) as a budget:

```ts
const SKILL_BUDGET_CONTEXT_PERCENT = 0.01  // 1% of context window
const MAX_LISTING_DESC_CHARS = 250          // Per-entry cap

function formatCommandsWithinBudget(commands, contextWindowTokens?) {
  // 1. Try full descriptions
  // 2. If over budget: bundled skills keep full descriptions
  // 3. Non-bundled skills get truncated descriptions
  // 4. Extreme case: non-bundled go names-only
}
```

### Attachment-Based Discovery

Skills are surfaced via `system-reminder` attachments each turn:

```
Skills relevant to your task:
- commit: Create a conventional commit with staged changes
- review-pr: Review a pull request for code quality
- dream: Memory consolidation - synthesize recent learnings
```

The model is instructed: _"When a skill matches the user's request, invoke the relevant Skill tool BEFORE generating any other response about the task"_

### Experimental Skill Search (`DiscoverSkillsTool`)

When `EXPERIMENTAL_SKILL_SEARCH` is enabled:
- Skills are automatically surfaced each turn based on task relevance
- `DiscoverSkillsTool` allows the model to search for relevant skills mid-task
- Already-visible/loaded skills are filtered automatically

---

## 3. Skill Execution — The Critical Pattern

**This is the key architectural insight:**

Skills do NOT run in the main conversation context. Instead:

### SkillTool Execution Path

```
User: "use /commit"
  → SkillTool.call()
    → getPromptForCommand(args, context)    ← Get skill content
    → prepareForkedCommandContext()          ← Setup fork params
    → runForkedAgent()                       ← Execute in isolated sub-agent
      → createSubagentContext()              ← Fresh isolated context
      → query() loop                         ← Runs the skill prompt
      → recordSidechainTranscript()          ← Record separately
    → extractResultText()                    ← Return dense summary
  → Return result to main conversation
```

### Why This Matters

1. **Context protection**: Skill execution (which may involve many tool calls, file reads, etc.) stays out of the main context window
2. **Prompt cache stability**: The main thread's CacheSafeParams are shared with the fork for cache hits
3. **Tool permissions**: Skills can grant their own tool permissions via `allowedTools` in frontmatter
4. **Agent selection**: Skills can specify which agent type to use via `agent` field

### Forked Context Setup

```ts
async function prepareForkedCommandContext(command, args, context) {
  const skillPrompt = await command.getPromptForCommand(args, context)
  const allowedTools = parseToolListFromCLI(command.allowedTools ?? [])
  const modifiedGetAppState = createGetAppStateWithAllowedTools(context.getAppState, allowedTools)
  
  // Use command.agent if specified, otherwise 'general-purpose'
  const agentTypeName = command.agent ?? 'general-purpose'
  const baseAgent = agents.find(a => a.agentType === agentTypeName) ?? ...
}
```

---

## 4. Agent Skill Preloading

Agents can declare skills to preload in their frontmatter:

```yaml
---
name: my-agent
skills: [commit, review-pr]
---
```

On agent start, these skills are resolved, loaded, and injected as user messages:

```ts
// runAgent.ts:L578-L646
for (const { skillName, skill, content } of loaded) {
  initialMessages.push(
    createUserMessage({
      content: [{ type: 'text', text: metadata }, ...content],
      isMeta: true,
    }),
  )
}
```

This gives the agent immediate context about the skill's capabilities without needing to invoke `SkillTool` first.

---

## 5. Skill Name Resolution

Skills support multiple name resolution strategies:

```ts
function resolveSkillName(skillName, allSkills, agentDefinition) {
  // 1. Exact match (checks name, userFacingName, aliases)
  // 2. Fully-qualified with agent's plugin prefix (e.g., "my-skill" → "plugin:my-skill")
  // 3. Suffix match on ":skillName" for plugin-namespaced skills
}
```

---

## Comparison: liteai vs liteai_cli_mvp (Skills)

| Dimension | liteai | liteai_cli_mvp |
|---|---|---|
| Execution model | In main context | Forked sub-agent (isolated) |
| Context impact | Pollutes main window | Dense result only returns |
| Skill listing | Static list in prompt | Budget-constrained + attachment-based |
| Discovery | Manual | Automatic turn-by-turn + DiscoverSkillsTool |
| Tool permissions | Agent-wide only | Per-skill allowedTools |
| Agent selection | N/A | Skills can choose their agent type |
| File extraction | N/A | Lazy extraction of reference files to disk |
| Preloading | N/A | Agent frontmatter `skills:` field |
