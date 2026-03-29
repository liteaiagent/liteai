# Converting Native Agents to Declarative Agents

## Overview

Native agents are hardcoded in `packages/core/src/agent/agent.ts` within the `state()` function. Declarative agents are defined via config files (YAML/JSON `agent:` section) or `.md` files in agent directories. Both produce identical `Agent.Info` objects — the `native` flag is cosmetic (only affects sort order in `liteai agent list`).

## Current Native Agents

| Agent | Mode | Status |
|---|---|---|
| `build` | primary | Native — uses runtime paths |
| `plan` | primary | Native — uses `Global.Path.data`, `Brand.dir`, `Instance.worktree` |

## Remaining Work (Phase 2)

`build` and `plan` add computed permission paths that cannot yet be expressed as static strings in config:

### Runtime-Computed Permission Paths

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

### Possible Solutions

#### Option A: Variable Interpolation in Config

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

#### Option B: Symbolic Tokens

Predefined tokens resolved at load time:

```yaml
permission:
  external_directory:
    "$DATA/plans/*": allow
```

Similar to Option A but with a simpler `$TOKEN` syntax instead of full interpolation.

#### Option C: Keep Computed Defaults (Recommended)

Leave the `defaults` permission construction in `agent.ts` as-is. Only `plan` and `build` add computed paths *beyond* defaults — keep those as special cases in the loading logic rather than trying to express them in config.

This is the path of least resistance: no config schema changes, no interpolation engine, and declarative agents already work correctly today.

#### Option D: Hybrid

Allow native agents to be *overridden* by config (already works) while keeping their computed base permissions. This is essentially what happens today — config-defined properties overlay the native defaults.

## How Declarative Built-in Agents Work

Built-in declarative agents live in `packages/core/src/agent/agents/*.md` as YAML-frontmatter `.md` files:

```markdown
---
name: explore
mode: subagent
hidden: false
permission:
  "*": deny
  grep: allow
  ...
---
<prompt text>
```

They are imported as raw strings and parsed at module load via `gray-matter` (same mechanism as user-defined agent `.md` files). The `builtinAgents` map in `agent.ts` populates them via the same merge path as user config — so user config can still override or `disable: true` any built-in agent. They retain `native: true` so the "built-in" badge shows in the UI and they sort first in `liteai agent list`.

## Cleanup

- Remove the `native` flag from `Agent.Info` once `build` and `plan` are also declarative — it serves no behavioral purpose beyond cosmetics.

## Relevant Files

- `packages/core/src/agent/agent.ts` — native agent definitions and loading logic
- `packages/core/src/agent/agents/` — built-in declarative agent `.md` files
- `packages/core/src/config/schema.ts` — `Config.Agent` schema (declarative agent config shape)
- `packages/core/src/tool/task.ts` — subagent invocation via the `task` tool
- `packages/core/src/cli/cmd/agent.ts` — CLI agent create/list commands
- `packages/core/src/permission/next.ts` — permission evaluation and merging
