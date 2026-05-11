---
title: CLI
description: "Using LiteAI from the command line — interactive TUI and headless mode."
---

# CLI

The CLI is the primary interface for LiteAI. It provides an interactive TUI (Text User Interface) for conversational coding and a headless mode for automation.

## Installation

```bash
bun install -g @liteai/cli
```

## Interactive mode

```bash
cd /path/to/project
liteai
```

This launches the TUI with:
- Prompt input area
- Streaming response display
- Prompt tray (mode, model, agent, session info)
- Slash command autocomplete

See [Interactive mode](/reference/interactive-mode) for controls.

## Headless mode

Run LiteAI non-interactively:

```bash
liteai --headless --message "Run tests and fix failures" --output results.md
```

Useful for CI/CD pipelines and automation scripts.

## Common options

```bash
liteai --model claude-sonnet-4-20250514    # Override model
liteai --provider openai             # Override provider
liteai --port 3001                   # Custom port
liteai --coordinator                 # Enable coordinator mode
liteai --permission bypass           # Skip permission prompts
```

See [CLI reference](/reference/cli-reference) for all options.
