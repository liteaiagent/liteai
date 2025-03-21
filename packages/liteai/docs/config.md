# Configuration Files & Locations

LiteAI uses a layered configuration system spread across multiple files and directories.
This document catalogues **every** file the runtime reads, where it lives, and how layers
merge together.

> **Nomenclature**
>
> | Term | Meaning |
> |---|---|
> | *Project root* | The repository root (the directory that contains `.git`). |
> | *Global config dir* | `~/.config/liteai/` (XDG `$XDG_CONFIG_HOME/liteai`). |
> | *Data dir* | `~/.local/share/liteai/` (XDG `$XDG_DATA_HOME/liteai`). |
> | *Config dir* | The `.liteai/` directory found by walking up from the project root. |

### Cross-platform paths (XDG)

LiteAI uses the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/)
to locate global directories. The `xdg-basedir` library resolves each variable to a default
under `os.homedir()` when the environment variable is not set:

| Variable | Default | Purpose |
|---|---|---|
| `$XDG_CONFIG_HOME` | `~/.config` | User config files |
| `$XDG_DATA_HOME` | `~/.local/share` | User data (DB, logs, binaries) |
| `$XDG_CACHE_HOME` | `~/.cache` | Non-essential cache |
| `$XDG_STATE_HOME` | `~/.local/state` | Persistent state |

**On Windows** there is no native XDG support, so the library falls back to the same
dot-directory layout under your Windows home folder:

| Directory | Windows default |
|---|---|
| Global config | `C:\Users\<you>\.config\liteai\` |
| Data | `C:\Users\<you>\.local\share\liteai\` |
| Cache | `C:\Users\<you>\.cache\liteai\` |
| Managed (enterprise) | `%ProgramData%\liteai\` (typically `C:\ProgramData\liteai\`) |

> [!NOTE]
> LiteAI does **not** use `%APPDATA%` or `%LOCALAPPDATA%`. All platforms use the
> same XDG-style dotfile layout. No shell (bash) is involved in path resolution —
> it is pure Node.js `path.join()` on `os.homedir()`.

---

## 1. Backend Config — `liteai.json`

The primary configuration file. Supports both `liteai.json` and `liteai.jsonc` (JSONC
with comments & trailing commas). A `$schema` field is auto-injected pointing to
`https://liteai.com/config.json`.

### 1.1 Where it is discovered

The backend loads **multiple** `liteai.json` files and deep-merges them in this
precedence order (lowest → highest, later wins):

| # | Source | Location |
|---|--------|----------|
| 1 | Remote `.well-known/liteai` | Fetched from authenticated well-known URLs (org defaults) |
| 2 | **Global config** | `~/.config/liteai/config.json`, `liteai.json`, or `liteai.jsonc` |
| 3 | Custom config path | `$LITEAI_CONFIG` env var pointing to an arbitrary file |
| 4 | **Project config** | `liteai.json` / `liteai.jsonc` found by walking up from the cwd to the worktree root |
| 5 | `.liteai` directory config | `.liteai/liteai.json` / `.liteai/liteai.jsonc` (searched upward from cwd) |
| 6 | Inline config | `$LITEAI_CONFIG_CONTENT` env var containing raw JSON |
| 7 | Account / org config | Fetched from the console API when an org is active |
| 8 | **Managed (enterprise) config** | System-managed directory (always highest priority) |

Enterprise managed config directories:
- **macOS:** `/Library/Application Support/liteai/`
- **Windows:** `%ProgramData%\liteai\`
- **Linux:** `/etc/liteai/`

### 1.2 Key sections

```jsonc
{
  "$schema": "https://liteai.com/config.json",
  "model": "anthropic/claude-sonnet-4-20250514",   // default model
  "small_model": "anthropic/claude-haiku",   // for title generation etc.
  "default_agent": "build",                  // default primary agent name
  "username": "ahmed",                       // display name override
  "provider": { /* ... */ },                 // LLM provider config
  "agent": { /* ... */ },                    // agent overrides (see §3)
  "permission": { /* ... */ },               // tool permission rules
  "mcp": { /* ... */ },                      // MCP server definitions
  "formatter": { /* ... */ },                // auto-formatter globs
  "lsp": { /* ... */ },                      // LSP server overrides
  "skills": {                                // additional skill locations
    "paths": ["~/my-skills"],
    "urls": ["https://example.com/.well-known/skills/"]
  },
  "instructions": ["./RULES.md"],            // extra instruction files
  "plugin": ["oh-my-liteai"],              // plugins
  "command": { /* ... */ },                   // slash command definitions
  "server": { "port": 4096 },                // HTTP server settings
  "share": "manual",                         // sharing behaviour
  "compaction": { "auto": true },            // context compaction
  "experimental": { /* ... */ }              // experimental flags
}
```

### 1.3 Variable interpolation

Config values support two substitution patterns:

| Syntax | Description |
|---|---|
| `{env:VAR_NAME}` | Replaced with the value of `$VAR_NAME` |
| `{file:path}` | Replaced with the contents of the file (relative to the config file, or absolute / `~/`) |

---

## 2. Frontend Config — `tui.json`

TUI-specific settings (themes, keybinds, scroll behavior) live in **separate** `tui.json` /
`tui.jsonc` files. Previously these were embedded in `liteai.json` under `theme`, `keybinds`,
and `tui` keys, but those are now deprecated and auto-migrated.

### 2.1 Discovery & precedence (lowest → highest)

| # | Source | Location |
|---|--------|----------|
| 1 | Global | `~/.config/liteai/tui.json` or `tui.jsonc` |
| 2 | Custom | `$LITEAI_TUI_CONFIG` env var |
| 3 | Project | `tui.json` / `tui.jsonc` found by walking up from cwd |
| 4 | `.liteai` directory | `.liteai/tui.json` or `.liteai/tui.jsonc` |
| 5 | Managed (enterprise) | `/etc/liteai/tui.json` (or platform equivalent) |

### 2.2 Key sections

```jsonc
{
  "$schema": "https://liteai.com/tui.json",
  "theme": "catppuccin-mocha",          // built-in or custom theme name
  "keybinds": {
    "leader": "ctrl+x",
    "app_exit": "ctrl+c,ctrl+d",
    "model_list": "<leader>m"
    // ... 50+ keybinds
  }
}
```

---

## 3. Agent Definitions

Agents can be defined either inline in `liteai.json` or as **standalone markdown files**.

### 3.1 JSON agent config (in `liteai.json`)

```jsonc
{
  "agent": {
    "my-reviewer": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "description": "Code review agent",
      "mode": "subagent",
      "prompt": "You are a code reviewer...",
      "permission": { "edit": "deny" },
      "steps": 20
    }
  }
}
```

### 3.2 Markdown agent files

Scanned from `.liteai/` directories (project and global) using the globs:
```
agents/*.md
```

The filename (without `.md`) becomes the agent name. The file uses YAML frontmatter +
markdown body:

```markdown
---
model: anthropic/claude-sonnet-4-20250514
description: Security-focused code reviewer
mode: subagent
permission:
  edit: deny
---

You are a security reviewer. Analyze code for vulnerabilities...
```

Supported frontmatter fields: `model`, `variant`, `temperature`, `top_p`, `description`,
`mode` (`primary` | `subagent` | `all`), `hidden`, `color`, `steps`, `permission`, `disable`.

### 3.3 Built-in agents

| Agent | Mode | Description |
|---|---|---|
| `build` | primary | Default agent, full tool access |
| `plan` | primary | Read-only planning mode |
| `general` | subagent | Multi-step parallel task executor |
| `explore` | subagent | Fast codebase exploration |
| `compaction` | primary (hidden) | Context compaction |
| `title` | primary (hidden) | Session title generation |
| `summary` | primary (hidden) | Session summarization |

---

## 4. Rules & Instructions — `AGENTS.md`

Rules are free-form instruction files injected into the system prompt. They are **not** agent
definitions; they are project-level instructions the agent should follow.

### 4.1 Discovery

Rules are found by walking **up** from the edited file's directory to the project root. The
first match wins per directory:

1. `AGENTS.md`
2. `CLAUDE.md` (compatibility)
3. `CONTEXT.md` (deprecated)

**Global rules** are also loaded (first found wins):
- `$LITEAI_CONFIG_DIR/AGENTS.md`
- `~/.config/liteai/AGENTS.md`
- `~/.claude/CLAUDE.md` (only when `LITEAI_ENABLE_CLAUDE_CODE` is set)

### 4.2 Additional instruction sources

In `liteai.json` you may specify extra instruction files or URLs:

```jsonc
{
  "instructions": [
    "./docs/CONVENTIONS.md",       // relative path (walked up from cwd)
    "~/global-rules/style.md",     // home-relative path
    "/absolute/path/rules.md",     // absolute path
    "https://example.com/rules.md" // fetched over HTTP
  ]
}
```

### 4.3 Scoped rules

Rules placed in a subdirectory apply **only** when the agent reads or edits files
in that subtree. Rules are not applied if they are already in the system prompt or have
already been loaded in the current message.

---

## 5. Skills — `SKILL.md`

Skills are reusable agent behaviors defined as `SKILL.md` files with YAML frontmatter.

### 5.1 Discovery order

| # | Source | Glob Pattern |
|---|--------|---|
| 1 | External dirs (global) | `~/.claude/skills/**/SKILL.md`, `~/.agents/skills/**/SKILL.md` |
| 2 | External dirs (project) | `.claude/skills/**/SKILL.md`, `.agents/skills/**/SKILL.md` (walked up from cwd) |
| 3 | `.liteai` directories | `{skill,skills}/**/SKILL.md` within each `.liteai/` dir |
| 4 | Config `skills.paths` | `**/SKILL.md` within each custom path |
| 5 | Config `skills.urls` | Downloaded and scanned for `**/SKILL.md` |

External skill directories require `LITEAI_ENABLE_CLAUDE_CODE=true` to be active.
They can be individually disabled with `LITEAI_DISABLE_EXTERNAL_SKILLS=true`.

### 5.2 File format

Each skill folder must contain a `SKILL.md` at its root:

```markdown
---
name: deploy
description: Deploy the application to production
---

1. Run the test suite with `npm test`
2. Build the production bundle...
```

The `name` and `description` frontmatter fields are required.

---

## 6. Slash Commands

Custom slash commands can be defined in `liteai.json` or as markdown files.

### 6.1 Markdown command files

Scanned from `.liteai/` directories:
```
{command,commands}/**/*.md
```

The file path (relative to the command directory, without `.md`) becomes the command name.
Frontmatter supports: `description`, `agent`, `model`, `subtask`.

```markdown
---
description: Run a full code review
agent: my-reviewer
---

Review all changes in the current branch and provide feedback...
```

---

## 7. Plugins

Plugins extend liteai with JavaScript or TypeScript hooks.

### 7.1 Sources

| Source | Details |
|---|---|
| `liteai.json` `"plugin"` array | npm package names or `file://` URLs |
| `.liteai/{plugin,plugins}/*.{ts,js}` | Local plugin files (auto-discovered) |

Plugins from all `.liteai/` directories (global + project) are merged. Later sources
override earlier ones by canonical name. Plugin dependencies are auto-installed via `bun`.

---

## 8. MCP Server Config

MCP (Model Context Protocol) servers are configured in the `mcp` section of `liteai.json`:

```jsonc
{
  "mcp": {
    "github": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
      "environment": { "GITHUB_TOKEN": "{env:GITHUB_TOKEN}" }
    },
    "remote-server": {
      "type": "remote",
      "url": "https://mcp.example.com/sse",
      "headers": { "Authorization": "Bearer {env:TOKEN}" }
    }
  }
}
```

LiteAI also auto-discovers MCP servers from Claude and Cursor configurations.

---

## 9. Directory Layout Summary

```
~/.config/liteai/                    # Global config dir ($XDG_CONFIG_HOME/liteai)
├── liteai.json / liteai.jsonc     # Global backend config
├── tui.json / tui.jsonc               # Global TUI config
├── config.json                        # Legacy global config (auto-migrated)
├── AGENTS.md                          # Global rules
├── agents/                            # Global agent definitions
│   └── *.md
├── skills/                            # Global skills
│   └── */SKILL.md
├── commands/                          # Global slash commands
│   └── *.md
└── plugins/                           # Global plugins
    └── *.{ts,js}

~/.local/share/liteai/               # Data dir ($XDG_DATA_HOME/liteai)
├── log/                               # Log files
├── bin/                               # Installed binaries
└── plans/                             # Plan mode output

<project>/
├── liteai.json / liteai.jsonc     # Project backend config
├── tui.json / tui.jsonc               # Project TUI config
├── AGENTS.md                          # Project-level rules
│
├── .liteai/                         # Project config dir
│   ├── liteai.json / liteai.jsonc # Override config (highest project priority)
│   ├── tui.json / tui.jsonc           # Override TUI config
│   ├── agents/                       # Agent definitions
│   │   └── *.md
│   ├── skills/ (or skill/)            # Skills
│   │   └── */SKILL.md
│   ├── commands/ (or command/)        # Slash commands
│   │   └── *.md
│   ├── plugins/ (or plugin/)          # Local plugins
│   │   └── *.{ts,js}
│
├── .claude/skills/                    # External skills (Claude Code compat)
│   └── */SKILL.md
└── .agents/skills/                    # External skills (generic compat)
    └── */SKILL.md
```

---

## 10. Environment Variables

### Core

| Variable | Description |
|---|---|
| `LITEAI_CONFIG` | Path to a custom config file (overrides global config) |
| `LITEAI_CONFIG_CONTENT` | Raw JSON config content (overrides all non-managed sources) |
| `LITEAI_CONFIG_DIR` | Custom `.liteai`-style directory to scan for agents, skills, etc. |
| `LITEAI_TUI_CONFIG` | Path to a custom TUI config file |
| `LITEAI_HOME` | Override the home directory for path resolution |
| `LITEAI_MODEL` | Override the default model |
| `LITEAI_PROVIDER` | Override the default provider |
| `LITEAI_SERVER_PASSWORD` | HTTP server authentication password |
| `LITEAI_PERMISSION` | JSON object overriding permission rules |

### Feature flags

| Variable | Description |
|---|---|
| `LITEAI_DISABLE_PROJECT_CONFIG` | Ignore all project-level config files |
| `LITEAI_DISABLE_AUTOCOMPACT` | Disable automatic context compaction |
| `LITEAI_DISABLE_PRUNE` | Disable old tool output pruning |
| `LITEAI_DISABLE_AUTOUPDATE` | Disable automatic updates |
| `LITEAI_ENABLE_CLAUDE_CODE` | Enable Claude Code compatibility (prompts + skills, disabled by default) |
| `LITEAI_DISABLE_CLAUDE_CODE_PROMPT` | Skip loading `~/.claude/CLAUDE.md` (requires `ENABLE_CLAUDE_CODE`) |
| `LITEAI_DISABLE_EXTERNAL_SKILLS` | Skip `.claude/` and `.agents/` skill dirs |
| `LITEAI_DISABLE_DEFAULT_PLUGINS` | Prevent default plugins from loading |
| `LITEAI_DISABLE_LSP_DOWNLOAD` | Prevent automatic LSP server downloads |
| `LITEAI_DISABLE_MODELS_FETCH` | Skip fetching the remote models list |

### Experimental

| Variable | Description |
|---|---|
| `LITEAI_EXPERIMENTAL` | Enable all experimental features at once |
| `LITEAI_EXPERIMENTAL_LSP_TOOL` | Enable the LSP tool for agents |
| `LITEAI_EXPERIMENTAL_WORKSPACES` | Enable multi-workspace support |
| `LITEAI_EXPERIMENTAL_PLAN_MODE` | Enable plan mode |
| `LITEAI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` | Default shell command timeout |
| `LITEAI_EXPERIMENTAL_OUTPUT_TOKEN_MAX` | Max output tokens |

---

## 11. Config Precedence Quick Reference

```
                                     ┌──────────────────┐
                                     │  Managed config   │  (enterprise admin)
                                     │  /etc/liteai/   │
                                     └────────▲─────────┘
                                              │ overrides everything
                                     ┌────────┴─────────┐
                                     │  Account / Org    │
                                     │  console config   │
                                     └────────▲─────────┘
                                              │
                                     ┌────────┴─────────┐
                                     │  LITEAI_CONFIG  │
                                     │    _CONTENT       │
                                     └────────▲─────────┘
                                              │
                                     ┌────────┴─────────┐
                                     │  .liteai/       │
                                     │  liteai.json    │
                                     └────────▲─────────┘
                                              │
                                     ┌────────┴─────────┐
                                     │ Project-level     │
                                     │ liteai.json     │
                                     └────────▲─────────┘
                                              │
                                     ┌────────┴─────────┐
                                     │  $LITEAI_CONFIG │
                                     │  (custom path)    │
                                     └────────▲─────────┘
                                              │
                                     ┌────────┴─────────┐
                                     │  Global config    │
                                     │  ~/.config/       │
                                     │  liteai/        │
                                     └────────▲─────────┘
                                              │
                                     ┌────────┴─────────┐
                                     │  Remote           │
                                     │  .well-known/     │
                                     │  liteai         │
                                     └──────────────────┘
```
