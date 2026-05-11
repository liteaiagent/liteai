---
title: Interactive mode
description: "Prompt tray controls, agent selector, and session management in interactive mode."
---

# Interactive mode

When running LiteAI interactively (CLI TUI), the prompt tray provides quick access to session controls.

## Prompt tray

The prompt tray appears at the bottom of the terminal and shows:
- **Current mode** (Build / Plan / Coordinator)
- **Active agent** name
- **Model** currently in use
- **Session ID**
- **Turn count**

## Controls

| Key/Action | Effect |
|---|---|
| `/mode` | Switch session mode |
| `/model` | Change model |
| `/agent` | Switch agent |
| `/undo` | Revert last change |
| `/clear` | Clear history |
| `Ctrl+C` | Interrupt current turn |
| `Ctrl+D` | End session |

## Agent selector

Switch between available agents using `/agent <name>`. Available agents include:
- Built-in default agent
- Custom agents from `.liteai/agents/`
- Global agents from `~/.liteai/agents/`

## Session management

| Command | Description |
|---|---|
| `/sessions` | List active sessions |
| `/session <id>` | Switch to a session |
| `/new` | Start a new session |
