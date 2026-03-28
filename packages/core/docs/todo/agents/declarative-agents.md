# Converting Native Agents to Declarative Agents

## Overview

Native agents are hardcoded in `packages/core/src/agent/agent.ts` within the `state()` function. Declarative agents are defined via config files (YAML/JSON `agent:` section) or `.md` files in agent directories. Both produce identical `Agent.Info` objects — the `native` flag is cosmetic (only affects sort order in `liteai agent list`).

This document outlines what's needed to make all agents declarative.

## Current Native Agents

| Agent | Mode | Complexity to Convert |
|---|---|---|
| `build` | primary | Medium — uses runtime paths |
| `plan` | primary | Medium — uses `Global.Path.data`, `Brand.dir`, `Instance.worktree` |
| `general` | subagent | Easy — static permissions |
| `explore` | subagent | Easy — static permissions + prompt file |
| `compaction` | primary (hidden) | Easy — static permissions + prompt file |
| `title` | primary (hidden) | Easy — static permissions + prompt file |
| `summary` | primary (hidden) | Easy — static permissions + prompt file |

## Easy Conversions

Agents with static permissions can be converted directly. For example, `general`:

```yaml
agent:
  general:
    mode: subagent
    description: "General-purpose agent for researching complex questions and executing multi-step tasks."
    permission:
      todoread: deny
      todowrite: deny
```

And `explore`:

```yaml
agent:
  explore:
    mode: subagent
    description: "Fast agent specialized for exploring codebases..."
    prompt: "<contents of prompt/explore.txt>"
    permission:
      "*": deny
      grep: allow
      glob: allow
      list: allow
      bash: allow
      webfetch: allow
      websearch: allow
      codesearch: allow
      read: allow
```

These agents inherit the `defaults` ruleset (which includes skill directory allowlists) automatically.

## Runtime-Computed Permission Paths

Three categories of paths are resolved at runtime and cannot be expressed as static strings in config:

### 1. Skill Directories

```ts
const skillDirs = await Skill.dirs()
const whitelistedDirs = [Truncate.GLOB, ...skillDirs.map((dir) => path.join(dir, "*"))]
```

These are injected into the `defaults` permission ruleset as `external_directory` allowlists. **All agents (including declarative ones) already inherit these**, so this is not a blocker.

### 2. Global Data Paths (`plan` agent)

```ts
external_directory: {
  [path.join(Global.Path.data, "plans", "*")]: "allow",
},
edit: {
  "*": "deny",
  [path.join(Brand.dir, "plans", "*.md")]: "allow",
  [path.relative(Instance.worktree, path.join(Global.Path.data, "plans", "*.md"))]: "allow",
},
```

- `Global.Path.data` → platform-dependent (e.g. `~/.liteai/data`)
- `Brand.dir` → brand-specific dotfolder (e.g. `.liteai`)
- `Instance.worktree` → current project root

These change per machine and per project.

### 3. Truncation Cache (`Truncate.GLOB`)

Force-added to every agent (lines 296–308) unless explicitly denied. Also a runtime path.

## Possible Solutions for Runtime Paths

### Option A: Variable Interpolation in Config

Support template variables in permission paths:

```yaml
agent:
  plan:
    permission:
      external_directory:
        "${data}/plans/*": allow
      edit:
        "*": deny
        "${brand}/plans/*.md": allow
```

**Pros:** Fully declarative, no special-casing.
**Cons:** Adds complexity to the config parser. Need to define and document all available variables.

### Option B: Symbolic Tokens

Predefined tokens resolved at load time:

```yaml
permission:
  external_directory:
    "$DATA/plans/*": allow
```

Similar to Option A but with a simpler `$TOKEN` syntax instead of full interpolation.

### Option C: Keep Computed Defaults (Recommended)

Leave the `defaults` permission construction in `agent.ts` as-is. Declarative agents already inherit defaults via `PermissionNext.merge(defaults, user)`. Only the `plan` and `build` agents add computed paths *beyond* defaults — keep those as special cases in the loading logic rather than trying to express them in config.

This is the path of least resistance: no config schema changes, no interpolation engine, and declarative agents already work correctly today.

### Option D: Hybrid

Allow native agents to be *overridden* by config (already works) while keeping their computed base permissions. This is essentially what happens today — config-defined properties overlay the native defaults.

## Skill Support for Declarative Agents

Declarative agents can use skills via two mechanisms:

1. **`skills` field** — preloads specific skills on agent init:
   ```yaml
   agent:
     my_agent:
       skills:
         - "my-skill-name"
   ```

2. **`skill` permission rule** — controls which skills the agent can invoke:
   ```yaml
   agent:
     my_agent:
       permission:
         skill:
           "*": allow
           # or pattern-based:
           # "specific-skill": allow
   ```

3. **Inherited defaults** — all agents automatically get `external_directory` access to skill directories via the `defaults` ruleset, so file reads within skill folders work without extra config.

## Recommendation

1. **Phase 1:** Convert `general`, `explore`, `compaction`, `title`, `summary` to declarative definitions (as bundled `.md` files or default config entries). These have no runtime path dependencies beyond inherited defaults.

2. **Phase 2:** Decide on a variable interpolation strategy (Option A or B) for `build` and `plan`, or keep them as computed defaults (Option C).

3. **Cleanup:** Remove the `native` flag from `Agent.Info` once all agents are declarative — it serves no behavioral purpose.

## Relevant Files

- `packages/core/src/agent/agent.ts` — native agent definitions and loading logic
- `packages/core/src/config/schema.ts` — `Config.Agent` schema (declarative agent config shape)
- `packages/core/src/tool/task.ts` — subagent invocation via the `task` tool
- `packages/core/src/cli/cmd/agent.ts` — CLI agent create/list commands
- `packages/core/src/permission/next.ts` — permission evaluation and merging
