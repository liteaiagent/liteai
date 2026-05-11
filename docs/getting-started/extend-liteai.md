---
title: Extend LiteAI
description: Overview of all extension points in LiteAI — agents, skills, plugins, hooks, MCP, and commands.
---

# Extend LiteAI

LiteAI is designed to be extended at every layer. This page gives you a quick overview of each extension point and links to the detailed guides.

## Extension points at a glance

| Extension | What it does | Where to define | Scope |
|---|---|---|---|
| [**AGENTS.md**](/getting-started/memory) | Project-specific instructions for the AI | Root of your project | Per-project |
| [**Custom agents**](/build/custom-subagents) | Specialized agent personas with custom prompts and tool restrictions | `.liteai/agents/**/*.md` | Per-project or global |
| [**Skills**](/build/skills) | Task-focused instruction packages | `.liteai/skills/**/SKILL.md` | Per-project or global |
| [**Plugins**](/build/create-plugins) | Runtime-loaded extensions with tool and hook access | `.liteai/plugins/` or npm | Per-project or global |
| [**MCP servers**](/build/mcp) | External tool providers via Model Context Protocol | `.mcp.json` or `settings.json` | Per-project or global |
| [**Hooks**](/build/hooks) | Lifecycle callbacks for automation | `settings.json` | Per-project or global |
| [**Commands**](/reference/commands) | Custom slash commands | `.liteai/commands/**/*.md` | Per-project or global |

## How discovery works

LiteAI scans for extensions in a specific order:

```
1. Global:    ~/.liteai/agents/     ~/.liteai/skills/     ~/.liteai/plugins/
2. Project:   .liteai/agents/       .liteai/skills/       .liteai/plugins/
3. Config:    settings.json (hooks, MCP servers)
4. Runtime:   LITEAI_PLUGIN_DIR environment variable
```

Project-level extensions take precedence over global ones when names collide.

## Quick examples

### Custom agent

Create `.liteai/agents/reviewer.md`:

```markdown
---
name: reviewer
description: Code review specialist
model: claude-sonnet-4-20250514
tools:
  - read_file
  - search
  - list_directory
---

You are a senior code reviewer. Focus on:
- Logic errors and edge cases
- Performance implications
- Security vulnerabilities
- Code style consistency

Never suggest changes without explaining the reasoning.
```

### Skill

Create `.liteai/skills/debug/SKILL.md`:

```markdown
---
name: debug
description: Systematic debugging workflow
---

# Debug Skill

When debugging an issue:
1. Reproduce the error by reading the relevant test or running the failing command
2. Trace the execution path through the source code
3. Identify the root cause before suggesting a fix
4. Write a test that catches the regression
5. Apply the minimal fix
```

### MCP server

Add to `.mcp.json`:

```json
{
  "servers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "postgresql://localhost/mydb"
      }
    }
  }
}
```

## Platform compatibility

LiteAI can also load instructions from external platform conventions:

| Platform | Instruction file | Enable with |
|---|---|---|
| LiteAI (default) | `AGENTS.md` | Default behavior |
| Claude Code | `CLAUDE.md` | `LITEAI_PLATFORM=claude` |
| Gemini CLI | `GEMINI.md` | `LITEAI_PLATFORM=gemini` |
| Codex | `codex` conventions | `LITEAI_PLATFORM=codex` |
| Standard (`.agents/`) | `AGENTS.md` in `.agents/` | `LITEAI_PLATFORM=standard` |

When a platform mode is set, LiteAI discovers agents, skills, and instructions from the corresponding platform's directory conventions **in addition to** the native `.liteai/` directory.

## What's next?

- [**Create custom subagents**](/build/custom-subagents) — Full agent definition reference
- [**Extend LiteAI with skills**](/build/skills) — SKILL.md format and invocation
- [**Create plugins**](/build/create-plugins) — Plugin API and manifest schema
- [**Model Context Protocol**](/build/mcp) — MCP server configuration
