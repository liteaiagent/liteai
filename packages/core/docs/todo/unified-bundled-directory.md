# Phase 1: Unified Bundled Directory

## Context

All built-in ("bundled") assets — agents, skills, command templates, system prompts, and inline prompt strings — are scattered across 6 different directories in `src/` using 3 different loading mechanisms. This makes the codebase harder to navigate, inconsistent with the plugin system, and blocks the long-term vision of expressing all core behavior through abstract primitives (agents, skills, hooks, commands, plugins).

**Long-term vision**: The core becomes a pure runtime for abstract primitives. Everything "opinionated" lives in a default plugin — overridable, inspectable, and following the same conventions as third-party plugins (e.g. Superpowers). Phase 1 is the structural prerequisite: consolidate all bundled assets into a single directory that mirrors the `.liteai/` config folder and the plugin directory layout.

### Related docs
- [Vision: Core as Abstract Primitives + Default Plugin](file:///C:/Users/aghassan/.gemini/antigravity/brain/dc2941a3-3294-4bd0-b34b-dfde409fc580/unified_bundled_folder_analysis.md) — full architecture vision covering Phases 1–5

---

## Current State

### Inventory of all bundled assets

| # | File | Current Location | Loading Mechanism | Consumed by |
|---|---|---|---|---|
| 1 | `plan.md` | `src/agent/agents/` | `?raw` import | `agent.ts` → `parseBuiltinAgent()` |
| 2 | `build.md` | `src/agent/agents/` | `?raw` import | `agent.ts` → `parseBuiltinAgent()` |
| 3 | `general.md` | `src/agent/agents/` | `?raw` import | `agent.ts` → `parseBuiltinAgent()` |
| 4 | `explore.md` | `src/agent/agents/` | `?raw` import | `agent.ts` → `parseBuiltinAgent()` |
| 5 | `compaction.md` | `src/agent/agents/` | `?raw` import | `agent.ts` → `parseBuiltinAgent()` |
| 6 | `title.md` | `src/agent/agents/` | `?raw` import | `agent.ts` → `parseBuiltinAgent()` |
| 7 | `summary.md` | `src/agent/agents/` | `?raw` import | `agent.ts` → `parseBuiltinAgent()` |
| 8 | `generate.md` | `src/agent/prompt/` | `?raw` import | `agent.ts` → `Agent.generate()` |
| 9 | `debug/SKILL.md` | `src/skill/bundled/` | `import.meta.dir` + glob | `skill/loader.ts` |
| 10 | `simplify/SKILL.md` | `src/skill/bundled/` | `import.meta.dir` + glob | `skill/loader.ts` |
| 11 | `initialize.txt` | `src/command/template/` | Direct module import | `command/index.ts` |
| 12 | `review.txt` | `src/command/template/` | Direct module import | `command/index.ts` |
| 13 | `default.md` | `src/session/templates/` | Direct module import | `session/engine/system.ts` |
| 14 | `anthropic.md` | `src/session/templates/` | Direct module import | `session/engine/system.ts` |
| 15 | `beast.md` | `src/session/templates/` | Direct module import | `session/engine/system.ts` |
| 16 | `codex_header.md` | `src/session/templates/` | Direct module import | `session/engine/system.ts` |
| 17 | `gemini.md` | `src/session/templates/` | Direct module import | `session/engine/system.ts` |
| 18 | `google-code-assist.md` | `src/session/templates/` | Direct module import | `session/engine/system.ts` |
| 19 | `trinity.md` | `src/session/templates/` | Direct module import | `session/engine/system.ts` |
| 20 | `build-switch.md` | `src/session/templates/` | Direct module import | `session/engine/plan-reminder.ts` |
| 21 | `max-steps.md` | `src/session/templates/` | Direct module import | `session/engine/loop.ts` |

> [!IMPORTANT]
> **Out of scope for Phase 1**: The 70-line inline prompt in `plan-reminder.ts` (lines 47–116). This is hardcoded TypeScript, not a file. Extracting it is a behavioral change that belongs in Phase 3 (Plan Mode via Hooks).

### Current directory tree (before)

```
src/
├── agent/
│   ├── agents/              ← 7 agent .md files
│   │   ├── build.md
│   │   ├── compaction.md
│   │   ├── explore.md
│   │   ├── general.md
│   │   ├── plan.md
│   │   ├── summary.md
│   │   └── title.md
│   └── prompt/              ← 1 prompt .md file
│       └── generate.md
├── command/
│   └── template/            ← 2 command templates
│       ├── initialize.txt
│       └── review.txt
├── session/
│   └── templates/           ← 9 system/misc prompt files  
│       ├── anthropic.md
│       ├── beast.md
│       ├── build-switch.md
│       ├── codex_header.md
│       ├── default.md
│       ├── gemini.md
│       ├── google-code-assist.md
│       ├── max-steps.md
│       └── trinity.md
└── skill/
    └── bundled/             ← 2 bundled skill directories
        ├── debug/SKILL.md
        └── simplify/SKILL.md
```

---

## Target State

### New directory tree (after)

```
src/bundled/
├── agents/
│   ├── build.md
│   ├── compaction.md
│   ├── explore.md
│   ├── general.md
│   ├── plan.md
│   ├── summary.md
│   └── title.md
├── skills/
│   ├── debug/
│   │   └── SKILL.md
│   └── simplify/
│       └── SKILL.md
├── commands/
│   ├── initialize.md        ← renamed from .txt
│   └── review.md            ← renamed from .txt
└── prompts/
    ├── agents/
    │   └── generate.md       ← used by Agent.generate()
    ├── system/
    │   ├── anthropic.md
    │   ├── beast.md
    │   ├── codex_header.md
    │   ├── default.md
    │   ├── gemini.md
    │   ├── google-code-assist.md
    │   └── trinity.md
    └── misc/
        ├── build-switch.md
        └── max-steps.md
```

### Loading mechanism

**All files loaded via runtime filesystem scan** using `import.meta.dir` — the same mechanism already proven for bundled skills. Bun's `--compile` embeds files discovered through `import.meta.dir` into the single-file executable.

A single entry point `src/bundled/index.ts` provides typed accessors for each category.

---

## Implementation Tasks

### Task 1: Create directory structure

Create `src/bundled/` and all subdirectories. Move all 21 files to their new locations.

**Files to move:**
```
src/agent/agents/*.md                    → src/bundled/agents/
src/agent/prompt/generate.md             → src/bundled/prompts/agents/generate.md
src/skill/bundled/debug/SKILL.md         → src/bundled/skills/debug/SKILL.md
src/skill/bundled/simplify/SKILL.md      → src/bundled/skills/simplify/SKILL.md
src/command/template/initialize.txt      → src/bundled/commands/initialize.md
src/command/template/review.txt          → src/bundled/commands/review.md
src/session/templates/anthropic.md       → src/bundled/prompts/system/anthropic.md
src/session/templates/beast.md           → src/bundled/prompts/system/beast.md
src/session/templates/codex_header.md    → src/bundled/prompts/system/codex_header.md
src/session/templates/default.md         → src/bundled/prompts/system/default.md
src/session/templates/gemini.md          → src/bundled/prompts/system/gemini.md
src/session/templates/google-code-assist.md → src/bundled/prompts/system/google-code-assist.md
src/session/templates/trinity.md         → src/bundled/prompts/system/trinity.md
src/session/templates/build-switch.md    → src/bundled/prompts/misc/build-switch.md
src/session/templates/max-steps.md       → src/bundled/prompts/misc/max-steps.md
```

**Delete empty directories after moving:**
- `src/agent/agents/`
- `src/agent/prompt/`
- `src/command/template/`
- `src/session/templates/`
- `src/skill/bundled/`

### Task 2: Create `src/bundled/index.ts`

The unified loader module. Uses `import.meta.dir` to resolve paths and reads files from disk at runtime.

```typescript
import fs from "node:fs/promises"
import path from "node:path"

const ROOT = path.join(import.meta.dir, "bundled")

export namespace Bundled {
  // ----- Agents -----
  export function agentsDir() {
    return path.join(ROOT, "agents")
  }

  /** Read a single agent .md file as raw string */
  export async function agent(name: string): Promise<string> {
    return fs.readFile(path.join(ROOT, "agents", `${name}.md`), "utf-8")
  }

  // ----- Skills -----
  export function skillsDir() {
    return path.join(ROOT, "skills")
  }

  // ----- Commands -----
  export function commandsDir() {
    return path.join(ROOT, "commands")
  }

  export async function command(name: string): Promise<string> {
    return fs.readFile(path.join(ROOT, "commands", `${name}.md`), "utf-8")
  }

  // ----- Prompts -----
  export async function systemPrompt(name: string): Promise<string> {
    return fs.readFile(path.join(ROOT, "prompts", "system", `${name}.md`), "utf-8")
  }

  export async function miscPrompt(name: string): Promise<string> {
    return fs.readFile(path.join(ROOT, "prompts", "misc", `${name}.md`), "utf-8")
  }

  export async function agentPrompt(name: string): Promise<string> {
    return fs.readFile(path.join(ROOT, "prompts", "agents", `${name}.md`), "utf-8")
  }
}
```

> [!NOTE]
> The exact API shape is a suggestion — the implementer should refine based on actual consumption patterns. The key constraint is that all reads go through `import.meta.dir`-relative paths.

### Task 3: Update `src/agent/agent.ts`

**Remove** the 8 `?raw` imports:
```diff
-import AGENT_BUILD from "./agents/build.md?raw"
-import AGENT_COMPACTION from "./agents/compaction.md?raw"
-import AGENT_EXPLORE from "./agents/explore.md?raw"
-import AGENT_GENERAL from "./agents/general.md?raw"
-import AGENT_PLAN from "./agents/plan.md?raw"
-import AGENT_SUMMARY from "./agents/summary.md?raw"
-import AGENT_TITLE from "./agents/title.md?raw"
-import PROMPT_GENERATE from "./prompt/generate.md?raw"
```

**Replace** `parseBuiltinAgent()` and `builtinAgents` with a loader that reads from `Bundled.agentsDir()`.

The `builtinAgents` object must still be populated **before** `Agent.state()` runs — either by:
- (a) Making `builtinAgents` population async (called once at startup), or
- (b) Using `ConfigMarkdown.parse()` which is already the standard for user agents

Both approaches produce identical `Config.Agent` objects — the frontmatter + content extraction is the same whether from `gray-matter(rawString)` or `ConfigMarkdown.parse(filePath)`.

**Critical detail**: The `Agent.generate()` function uses `PROMPT_GENERATE`. Replace with `Bundled.agentPrompt("generate")` (now async — but `generate()` is already async, so this is fine).

### Task 4: Update `src/skill/loader.ts`

**Change** the bundled skills path from `import.meta.dir` (relative to `skill/loader.ts`) to `Bundled.skillsDir()`:

```diff
-    const bundled = path.join(import.meta.dir, "bundled")
+    const bundled = Bundled.skillsDir()
```

No other changes needed — the scanning logic (`Glob.scan(SKILL_PATTERN, ...)`) works identically on the new path.

### Task 5: Update `src/command/index.ts`

**Remove** the direct template imports:
```diff
-import PROMPT_INITIALIZE from "./template/initialize.txt"
-import PROMPT_REVIEW from "./template/review.txt"
```

**Replace** with async reads from `Bundled.command()`. Since command templates are accessed via `get template()` getters, and `Command.Info.template` already supports `Promise<string>`, this is a straightforward change:

```typescript
[Default.INIT]: {
  name: Default.INIT,
  description: "create/update AGENTS.md",
  source: "command",
  get template() {
    return Bundled.command("initialize").then(t =>
      t.replace(PATH_PLACEHOLDER, Instance.worktree)
    )
  },
  // hints need to be computed differently since we can't read sync anymore
  // Option: compute hints lazily, or hardcode the known hints for built-ins
  hints: ["$ARGUMENTS"],
},
```

> [!WARNING]
> The current `hints()` function parses the template string synchronously to extract `$1`, `$ARGUMENTS` etc. Since template reading becomes async, either:  
> (a) Hardcode hints for built-in commands (there are only 2, and they're stable), or  
> (b) Make hints lazy/async (used only for autocomplete, so async is acceptable), or  
> (c) Read templates eagerly in `Command.state()` (it's already async)

Option (c) is cleanest — read the template once during state initialization, store it, and use the stored value in the getter.

### Task 6: Update `src/session/engine/system.ts`

**Remove** the 7 system prompt imports:
```diff
-import PROMPT_ANTHROPIC from "../templates/anthropic.md"
-import PROMPT_BEAST from "../templates/beast.md"
-import PROMPT_CODEX from "../templates/codex_header.md"
-import PROMPT_DEFAULT from "../templates/default.md"
-import PROMPT_GEMINI from "../templates/gemini.md"
-import PROMPT_CODE_ASSIST from "../templates/google-code-assist.md"
-import PROMPT_TRINITY from "../templates/trinity.md"
```

**Replace** `SystemPrompt.provider()` to read from `Bundled.systemPrompt()`. This function is already called from an async context (`LLM.stream()`), so making it async is fine:

```typescript
export async function provider(model: Provider.Model): Promise<string[]> {
  if (model.api.id.includes("gpt-5")) return [await Bundled.systemPrompt("codex_header")]
  if (model.api.id.includes("gemini-")) return [await Bundled.systemPrompt("gemini")]
  if (model.api.id.includes("claude")) return [await Bundled.systemPrompt("anthropic")]
  // ...
  return [await Bundled.systemPrompt("default")]
}
```

**Also update** `SystemPrompt.instructions()` — currently returns `PROMPT_CODEX.trim()`, needs a cached async version.

**Callers to update:**
- `llm.ts:76` — already async (`LLM.stream()`)
- `agent.ts:238` — already async (`Agent.generate()`)

### Task 7: Update `src/session/engine/plan-reminder.ts`

**Remove** the build-switch import:
```diff
-import BUILD_SWITCH from "../templates/build-switch.md"
```

**Replace** with `Bundled.miscPrompt("build-switch")`. The `insertPlanReminder()` function is already async, so this is straightforward.

> [!NOTE]
> The 70-line inline prompt string in this file stays as-is in Phase 1. Extracting it to a file and wiring through hooks is Phase 3 work.

### Task 8: Update `src/session/engine/loop.ts`

**Remove** the max-steps import:
```diff
-import MAX_STEPS from "../templates/max-steps.md"
```

**Replace** with `Bundled.miscPrompt("max-steps")`. Load it once at the top of the loop function (it's inside an async function already).

### Task 9: Delete empty old directories

After all moves and import updates:
```
rm -rf src/agent/agents/
rm -rf src/agent/prompt/
rm -rf src/command/template/
rm -rf src/session/templates/
rm -rf src/skill/bundled/
```

Verify no remaining imports reference these paths.

### Task 10: Update `src/md.d.ts`

If no `?raw` imports remain in the codebase, remove the declaration:
```diff
-declare module "*.md?raw" {
-  const content: string
-  export default content
-}
```

Check whether other packages still use `?raw` imports before removing.

### Task 11: Verify Bun compile embedding

Run `bun build --compile` and verify:
1. The `src/bundled/` directory is embedded in the executable
2. All agent, skill, command, and prompt loading works correctly
3. No runtime file-not-found errors

### Task 12: Run tests

Ensure all existing tests pass. Key test areas:
- Agent loading and parsing (especially plan, compaction, title, summary — hidden agents)
- Skill loading (bundled skills appear with lowest priority)
- Command template substitution (`$ARGUMENTS`, `${path}`)
- System prompt selection per model
- Plan mode enter/exit flow (plan-reminder injection)

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Bun `--compile` doesn't embed `src/bundled/` | exe fails at runtime | `import.meta.dir` is already proven for bundled skills; test early |
| Sync→async change breaks callers | Build errors | All consumption points are already in async contexts; verify in Task 6 |
| `SystemPrompt.instructions()` is called sync | Runtime error | Cache the value at startup or make it lazy with a sync fallback |
| Performance regression from disk reads | Slower startup | Files are tiny (<15KB each); Bun's fs is fast; can add caching if needed |
| Missing file at runtime | Agent/skill not found | Add clear error messages with the expected path |

---

## What This Does NOT Change

- **No behavioral changes** — all prompts, agents, skills, and commands function identically
- **No new features** — this is purely structural
- **`plan-reminder.ts` inline prompt stays** — Phase 3 concern
- **`SystemPrompt.provider()` model-matching logic stays** — Phase 4 concern
- **No hook system changes** — Phase 2 concern
- **Plugin loader unchanged** — it already follows the target convention

---

## Validation Checklist

- [ ] All 21 files moved to `src/bundled/`
- [ ] Zero `?raw` imports remain for bundled assets
- [ ] Zero direct module imports from old template directories
- [ ] `src/bundled/index.ts` exists and exports typed accessors
- [ ] Old directories deleted (`agents/`, `prompt/`, `template/`, `templates/`, `skill/bundled/`)
- [ ] `bun dev` starts without errors
- [ ] All tests pass
- [ ] `bun build --compile` produces working executable
- [ ] Plan mode enter/exit works correctly end-to-end
- [ ] Bundled skills (debug, simplify) appear in skill list
- [ ] `/init` and `/review` commands work with proper template substitution
- [ ] System prompt varies correctly by model (Gemini vs Claude vs default)
