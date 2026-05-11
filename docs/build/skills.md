---
title: Extend LiteAI with skills
description: "Create and use task-focused instruction packages using the SKILL.md format."
---

# Extend LiteAI with skills

Skills are task-focused instruction packages that guide the agent through specific workflows. Unlike agents (which define a persona), skills define a **process**.

## SKILL.md format

Create a directory in `.liteai/skills/` with a `SKILL.md` file:

```
.liteai/skills/debug/
└── SKILL.md
```

```markdown
---
name: debug
description: Systematic debugging workflow
---

# Debug Skill

When debugging an issue, follow this process:

1. **Reproduce** — Read the failing test or error log
2. **Trace** — Follow the execution path through source code
3. **Root cause** — Identify the actual bug (not just symptoms)
4. **Fix** — Apply the minimal change that fixes the issue
5. **Verify** — Run the test suite to confirm the fix
6. **Regression** — Write a test that catches this bug in the future

## Rules
- Never fix a symptom without understanding the root cause
- Prefer minimal fixes over large refactors
- Always run tests after applying a fix
```

### Frontmatter fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Unique identifier |
| `description` | string | Yes | Short description |

## Discovery

Skills are discovered from:

```
1. Global:   ~/.liteai/skills/<name>/SKILL.md
2. Project:  .liteai/skills/<name>/SKILL.md
```

Also accepts `skill/` (singular): `.liteai/skill/<name>/SKILL.md`.

## Invocation

Skills are invoked by the agent when the user's request matches the skill's domain. You can also explicitly request a skill:

```
> Use the debug skill to investigate why the auth tests are failing.
```

## Built-in skills

LiteAI ships with built-in skills that can be invoked by any agent:

| Skill | Purpose |
|---|---|
| `debug` | Systematic debugging workflow |
| `simplify` | Code simplification and cleanup |

## Skill directories

Skills can include additional files beyond `SKILL.md`:

```
.liteai/skills/migration/
├── SKILL.md              # Main instructions
├── scripts/              # Helper scripts
│   └── check-schema.sh
├── examples/             # Reference implementations
│   └── migration.ts
└── resources/            # Templates, schemas
    └── template.sql
```

The agent can read these files as part of the skill execution.

## What's next?

- [**Create custom subagents**](/build/custom-subagents) — Agents vs skills
- [**Extend LiteAI**](/getting-started/extend-liteai) — All extension points
