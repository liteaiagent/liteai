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

If LiteAI finds an `AGENTS.md` anywhere in your path, it stops looking and uses all `AGENTS.md` files it collected on its way up to the project root.

### 3. Custom Agents & Skills
You can define custom personas (Agents) and capabilities (Skills) directly in your project! 
* **Agents**: LiteAI automatically scans for markdown files inside `.liteai/agents/**/*.md`.
* **Skills**: LiteAI automatically scans for markdown files inside `.liteai/skills/**/SKILL.md` or `.liteai/skill/**/SKILL.md`.
* **Commands**: LiteAI looks for commands inside `.liteai/command/**/*.md` or `.liteai/commands/**/*.md`.

These act as local extensions to LiteAI that are bound directly to your repository.

---

## 🤝 Compatibility with External Platforms

LiteAI natively understands the directory structures built for external coding agents (like Claude Code, Gemini CLI, or Codex) to allow you to port your existing external agents, skills, and configuration files.

**By default, LiteAI operates in pure isolation**, relying exclusively on its native `AGENTS.md` and the `.liteai/` directory convention. It does not scan provider-specific folders or cross-compatible neutral folders like `.agents/`.

To run in a specific platform mode and use its conventions instead, you must set the following environment variable:
```bash
LITEAI_PLATFORM=standard # Supported: standard, claude, gemini, codex
```

When enabled (for example, with `standard`), LiteAI switches to a **mutually exclusive** discovery mode and will ONLY load:
* Agents from platform-specific folders (e.g., `~/.agents/agents/*.md`)
* Global Instructions (e.g., `~/.agents/AGENTS.md`)
* Project instructions matching the platform (e.g., `AGENTS.md` for standard, `CLAUDE.md` for claude)
* Platform-specific configurations (e.g., `.mcp.json` if supported by the platform)

*(Note: While in a platform mode, standard LiteAI directories like `.liteai/` are also still loaded for your project configurations, but agent/skill loading expands to include your chosen platform).*

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
| `LITEAI_DISABLE_AGENTS` | `false` | Set to `true` to ignore global external agent folders. |
| `LITEAI_DISABLE_SKILLS` | `false` | Set to `true` to ignore global external skill folders. |

### Compatibility Toggles
*(Platform compatibility determines the active ecosystem. Set `LITEAI_PLATFORM` to scan provider-specific folders.)*

| Flag | Description |
|------|-------------|
| `LITEAI_PLATFORM` | **Master Toggle**. Set to `standard`, `claude`, `gemini`, or `codex` to enable platform-specific discovery. |

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
