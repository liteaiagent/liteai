---
title: Create plugins
description: "Build LiteAI plugins — convention-based directories that bundle commands, agents, skills, hooks, and MCP servers."
---

# Create plugins

Plugins are **convention-based directories** that bundle reusable commands, agents, skills, hooks, and MCP server configurations into a single installable unit. There is no TypeScript entry point or programmatic API — everything is declared via markdown, JSON, and directory conventions.

## Plugin structure

A plugin is a directory that follows fixed naming conventions. The loader discovers components from these paths automatically:

```
my-plugin/
├── plugin.json               # Optional manifest (metadata only)
├── commands/
│   └── greet.md               # Slash commands (markdown + frontmatter)
├── agents/
│   └── reviewer.md            # Agent definitions (markdown + frontmatter)
├── skills/
│   └── summarize/
│       └── SKILL.md           # Skill definitions
├── hooks/
│   └── hooks.json             # Lifecycle hooks (shell commands)
└── .mcp.json                  # MCP server configurations
```

All components are optional — include only what your plugin needs.

## Plugin manifest

The manifest is optional. When present, it provides metadata and component path overrides. It is discovered in order:

1. `.liteai-plugin/plugin.json`
2. `.claude-plugin/plugin.json` (Claude Code compatibility)
3. Root `plugin.json` (must contain a `name` field)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My custom LiteAI plugin",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "homepage": "https://github.com/you/my-plugin",
  "keywords": ["liteai", "plugin"]
}
```

The manifest does **not** declare an entry point — it is purely metadata. Component discovery always uses the conventional directory layout.

## Commands

Place markdown files in `commands/`. Each file becomes a slash command namespaced under your plugin name.

```markdown title="commands/greet.md"
---
description: "Greet the user with a custom message"
---

Say hello to the user in a friendly and enthusiastic way.
Use their name if provided: $ARGUMENTS
```

The filename becomes the command name. For a plugin named `my-plugin`, `commands/greet.md` registers as `/my-plugin:greet`.

## Agents

Place markdown files in `agents/`. Each file becomes a custom agent definition.

```markdown title="agents/reviewer.md"
---
model: sonnet
tools:
  - read_file
  - grep_search
allowedTools:
  - read_file
  - grep_search
---

You are a meticulous code reviewer. Review the code changes
and provide actionable feedback on correctness, performance,
and maintainability.
```

For a plugin named `my-plugin`, `agents/reviewer.md` registers as `my-plugin:reviewer`.

## Skills

Place `SKILL.md` files inside `skills/` subdirectories. Each skill follows the standard skill format:

```markdown title="skills/summarize/SKILL.md"
---
name: summarize
description: "Summarize a document or code file"
user-invocable: true
---

Read the specified file and produce a concise summary covering:
1. Purpose and functionality
2. Key components and their relationships
3. Notable patterns or concerns
```

Skills are namespaced the same way: `my-plugin:summarize`.

## Hooks

Create `hooks/hooks.json` to register lifecycle hooks. Hooks execute shell commands in response to events:

```json title="hooks/hooks.json"
{
  "description": "My plugin hooks",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "write_to_file",
        "hooks": [
          {
            "type": "command",
            "command": "node ${LITEAI_PLUGIN_ROOT}/scripts/validate.js"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Tool completed'"
          }
        ]
      }
    ]
  }
}
```

### Environment variables in hooks

Plugin environment variables are automatically expanded in hook commands and MCP configs:

| Variable | Description |
|---|---|
| `${LITEAI_PLUGIN_ROOT}` | Absolute path to the plugin directory |
| `${LITEAI_PLUGIN_DATA}` | Persistent data directory for this plugin |
| `${CLAUDE_PLUGIN_ROOT}` | Alias for `LITEAI_PLUGIN_ROOT` (Claude Code compat) |
| `${CLAUDE_PLUGIN_DATA}` | Alias for `LITEAI_PLUGIN_DATA` (Claude Code compat) |

The data directory persists across plugin updates and is located at `~/.liteai/plugins/data/<plugin-id>/`.

## MCP servers

Create `.mcp.json` at the plugin root to bundle MCP server configurations:

```json title=".mcp.json"
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["${LITEAI_PLUGIN_ROOT}/mcp/server.js"],
      "env": {
        "DATA_DIR": "${LITEAI_PLUGIN_DATA}"
      }
    }
  }
}
```

Both local (stdio) and remote (HTTP/SSE) servers are supported:

```json
{
  "mcpServers": {
    "local-server": {
      "command": "python",
      "args": ["-m", "my_mcp_server"],
      "env": { "PORT": "3001" }
    },
    "remote-server": {
      "type": "http",
      "url": "https://mcp.example.com/sse",
      "headers": { "Authorization": "Bearer ${MY_TOKEN}" }
    }
  }
}
```

MCP servers are namespaced as `my-plugin:my-server`.

## Installation

### Local (unmanaged)

Drop your plugin directory into one of these locations:

| Scope | Path |
|---|---|
| Global | `~/.liteai/plugins/<plugin-name>/` |
| Project | `.liteai/plugins/<plugin-name>/` |

### Enable / disable

Plugins must be explicitly enabled via the `enabledPlugins` setting:

```json title="settings.json"
{
  "enabledPlugins": {
    "my-plugin": true
  }
}
```

### Marketplace

Plugins can also be distributed through marketplaces — curated Git repositories or remote catalogs. See [Plugins reference](/reference/plugins-reference) for marketplace details.

## Namespacing

All plugin components are automatically prefixed with the plugin name to avoid collisions:

| Component | File | Registered as |
|---|---|---|
| Command | `commands/greet.md` | `my-plugin:greet` |
| Agent | `agents/reviewer.md` | `my-plugin:reviewer` |
| Skill | `skills/summarize/SKILL.md` | `my-plugin:summarize` |
| MCP server | `.mcp.json` → `my-server` | `my-plugin:my-server` |

The plugin name is derived from:
1. The directory basename, or
2. The parent directory name if the basename looks like a version (e.g. `latest`, `1.2.3`)

## What's next?

- [**Automate with hooks**](/build/hooks) — Hook system details
- [**Custom subagents**](/build/custom-subagents) — Create specialized agents
