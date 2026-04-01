# LiteAI Configuration & Behavior Guide

Welcome to the LiteAI user guide! This document explains how LiteAI works by default, where it looks for your configurations, how it discovers custom agents and skills, and how you can customize its behavior using environment variables (flags).

---

## 🏗️ Default Behavior

By default, LiteAI is designed to be zero-config but highly extensible. It automatically adapts to your project's workspace.

### 1. Configuration (`settings.json`)
LiteAI reads configuration files named `settings.json`. It merges them in a specific order (the lower down the list, the higher the priority):
1. **Global Settings**: Located in your home directory at `~/.liteai/settings.json`
2. **Project Settings**: Located in your current codebase at `.liteai/settings.json` (LiteAI searches upwards from your current folder to the root of your project).

*Note: LiteAI uses `.json` files but fully supports standard JSON comments natively.*

### 2. Context & Instructions (`AGENTS.md`)
To provide the AI with persistent context or instructions about your codebase, LiteAI automatically scans your directories (from your current folder up to the root) for specific markdown files. 

It looks for these files in the following strict priority:
1. `AGENTS.md`
2. `CLAUDE.md`

If LiteAI finds an `AGENTS.md` anywhere in your path, it stops looking and uses all `AGENTS.md` files it collected on its way up to the project root. If it doesn't find any `AGENTS.md`, it falls back to looking for `CLAUDE.md`.

### 3. Custom Agents & Skills
You can define custom personas (Agents) and capabilities (Skills) directly in your project! 
* **Agents**: LiteAI automatically scans for markdown files inside `.liteai/agents/**/*.md`.
* **Skills**: LiteAI automatically scans for markdown files inside `.liteai/skills/**/SKILL.md` or `.liteai/skill/**/SKILL.md`.
* **Commands**: LiteAI looks for commands inside `.liteai/command/**/*.md` or `.liteai/commands/**/*.md`.

These act as local extensions to LiteAI that are bound directly to your repository.

---

## 🤝 Compatibility with Claude Code

LiteAI natively understands the directory structures built for "Claude Code" (e.g., `~/.claude/` or `~/.agents/` global folders) to allow you to port your existing external agents and skills.

**By default, these compatibility features are DISABLED.** 
LiteAI will strictly ignore your `.claude` folders to ensure pure, isolated operations.

To opt-in and merge your global Claude Code resources into LiteAI, you must set the following environment variable:
```bash
LITEAI_ENABLE_CLAUDE_CODE=true
```

When enabled, LiteAI will additionally discover and load:
* Global Agents from `~/.claude/agents/*.md`
* Global Skills from `~/.claude/skills/**/SKILL.md`
* Global Instructions from `~/.claude/CLAUDE.md`

---

## 🚩 Environment Flags Reference

You can pass these environment flags cleanly by prefixing them with `LITEAI_` (e.g., `LITEAI_DISABLE_PROJECT_CONFIG=true`).

### Core Toggles
| Flag | Default | Description |
|------|---------|-------------|
| `LITEAI_DISABLE_PROJECT_CONFIG` | `false` | Instructs LiteAI to ignore project-level `.liteai/settings.json`. It will only use your global config. |
| `LITEAI_DISABLE_AUTOCOMPACT` | `false` | Disables the automatic compaction of your conversational history when the AI context window gets full. |
| `LITEAI_DISABLE_PRUNE` | `false` | Disables pruning of old tool outputs. |
| `LITEAI_DISABLE_AUTOUPDATE` | `false` | Prevents the CLI from checking for and executing automated terminal updates. |
| `LITEAI_DISABLE_DEFAULT_PLUGINS`| `false` | Disables LiteAI's default bundled plugins from mounting. |

### Compatibility Toggles
*(All Claude features default to DISABLED. Enable the master toggle first to use these sub-toggles.)*

| Flag | Description |
|------|-------------|
| `LITEAI_ENABLE_CLAUDE_CODE` | **Master Toggle**. Set to `true` to enable Claude directory scans. |
| `LITEAI_DISABLE_EXTERNAL_AGENTS`| *(Requires Master)* Set to `true` to ignore global external agent folders. |
| `LITEAI_DISABLE_EXTERNAL_SKILLS`| *(Requires Master)* Set to `true` to ignore global external skill folders. |
| `LITEAI_DISABLE_CLAUDE_CODE_PROMPT`| *(Requires Master)* Set to `true` to skip injecting the global `~/.claude/CLAUDE.md`. |

### Advanced Customization
| Flag | Description |
|------|-------------|
| `LITEAI_CONFIG` | Provide an absolute path to a custom `.json` config file to override settings globally. |
| `LITEAI_CONFIG_DIR` | Provide an absolute path to a directory acting as the `.liteai/` structure fallback. |
| `LITEAI_PLUGIN_DIR` | Comma-separated list of directories to dynamically load local plugins from at runtime. |
| `LITEAI_PERMISSION` | A JSON-stringified permission object to enforce strict tool limits. |
| `LITEAI_MODEL` / `LITEAI_PROVIDER`| Hard-override the chosen LLM and Provider on start. |

### Server & Connection
| Flag | Description |
|------|-------------|
| `LITEAI_SERVER_PASSWORD` | Require a password to connect to the LiteAI server backend. |
| `LITEAI_SERVER_USERNAME` | Require a specific username to connect. |
| `LITEAI_SERVER_CSRF_TOKEN` | Supply a CSRF bearer token utilized for API and webview security. |

*Note for Windows users: `truthy` flags accept values like `"true"` or `"1"` (case-insensitive).*
