---
title: Explore the .liteai directory
description: Understand the directory structure LiteAI uses for configuration, agents, skills, and project data.
---

# Explore the .liteai directory

LiteAI uses two directory locations for its configuration and data. Understanding this structure helps you customize behavior and troubleshoot issues.

## Global directory (`~/.liteai/`)

The global directory lives in your home folder and stores user-wide settings:

```
~/.liteai/
├── settings.json          # Global configuration (provider, model, permissions)
├── AGENTS.md              # Global instructions applied to all projects
├── agents/                # Global custom agent definitions
│   └── *.md
├── skills/                # Global skill packages
│   └── <skill-name>/
│       └── SKILL.md
├── plugins/               # Global plugins
├── commands/              # Global custom slash commands
│   └── *.md
├── memory/                # Agent memory files (per-agent, per-scope)
│   └── <agent-name>/
│       ├── user/
│       └── project/
└── projects/              # Project registry and data
    └── <project-id>/
        ├── memory/
        └── sessions/
```

## Project directory (`.liteai/`)

The project directory lives in your workspace root (or any parent directory — LiteAI searches upward):

```
<project-root>/
├── AGENTS.md              # Project-specific instructions (highest priority)
├── .liteai/
│   ├── settings.json      # Project-specific settings (overrides global)
│   ├── agents/            # Project-specific agent definitions
│   │   └── *.md
│   ├── skills/            # Project-specific skills
│   │   └── <skill-name>/
│   │       └── SKILL.md
│   ├── plugins/           # Project-specific plugins
│   └── commands/          # Project-specific slash commands
│       └── *.md
└── .mcp.json              # MCP server configuration
```

## Configuration resolution

LiteAI merges configuration from multiple sources, with later sources overriding earlier ones:

```mermaid
flowchart LR
    G[Global<br/>~/.liteai/settings.json] --> P[Project<br/>.liteai/settings.json]
    P --> E[Environment<br/>LITEAI_* variables]
    E --> C[CLI flags<br/>--model, --provider]
    
    style G fill:#1e293b,stroke:#334155
    style P fill:#1e293b,stroke:#334155
    style E fill:#1e293b,stroke:#334155
    style C fill:#1e293b,stroke:#334155
```

Priority order (highest wins):
1. **CLI flags** — `--model`, `--provider`, etc.
2. **Environment variables** — `LITEAI_MODEL`, `LITEAI_PROVIDER`, etc.
3. **Project settings** — `.liteai/settings.json`
4. **Global settings** — `~/.liteai/settings.json`

## Key files

### `settings.json`

The primary configuration file. Supports JSON with comments. See [Settings reference](/configuration/settings) for the full schema.

```json
{
  // Provider and model selection
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",

  // Permission behavior
  "permission": "default",

  // Memory scope
  "memory": "project",

  // Hook definitions
  "hooks": {}
}
```

### `AGENTS.md`

A markdown file containing instructions that are injected into the system prompt. LiteAI searches upward from your current directory to the project root, collecting all `AGENTS.md` files it finds.

```markdown
# Project Rules

- Always use TypeScript strict mode
- Run `bun test` after modifying source files
- Follow the existing code style conventions
- Never modify files in the `vendor/` directory
```

### `.mcp.json`

Configures external MCP (Model Context Protocol) servers. See [MCP](/build/mcp) for details.

## Environment variable overrides

| Variable | Effect |
|---|---|
| `LITEAI_CONFIG` | Absolute path to a custom settings.json |
| `LITEAI_CONFIG_DIR` | Absolute path to use as the `.liteai/` directory |
| `LITEAI_PLUGIN_DIR` | Comma-separated directories for plugin loading |
| `LITEAI_DISABLE_PROJECT_CONFIG` | Ignore project-level settings.json |

## What's next?

- [**Settings reference**](/configuration/settings) — Full settings.json schema
- [**Instructions & memory**](/getting-started/memory) — How AGENTS.md and memory work
- [**Environment variables**](/reference/environment-variables) — Complete env var reference
