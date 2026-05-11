---
title: Tools reference
description: "Complete inventory of LiteAI's native tools with descriptions and permission levels."
---

# Tools reference

LiteAI includes 30+ built-in tools organized by category.

## File operations

| Tool | Description | Permission |
|---|---|---|
| `read_file` | Read file contents | Auto-approved |
| `write_file` | Create or overwrite a file | Requires approval |
| `edit_file` | Edit specific sections of a file | Requires approval |
| `multi_edit` | Edit multiple sections in one call | Requires approval |
| `list_directory` | List directory contents | Auto-approved |
| `glob` | Find files matching a pattern | Auto-approved |
| `search` | Full-text search (ripgrep) | Auto-approved |

## Shell

| Tool | Description | Permission |
|---|---|---|
| `run_command` | Execute a shell command | Requires approval |
| `background_command` | Run a command in the background | Requires approval |
| `read_command_output` | Read background command output | Auto-approved |
| `kill_command` | Stop a background command | Requires approval |

## Web

| Tool | Description | Permission |
|---|---|---|
| `web_fetch` | Fetch content from a URL | Varies |
| `web_search` | Search the web | Varies |

## Memory

| Tool | Description | Permission |
|---|---|---|
| `readMemory` | Read agent memory files | Auto-approved |
| `writeMemory` | Write a memory file | Auto-approved |
| `editMemory` | Edit memory content | Auto-approved |

## Agent

| Tool | Description | Permission |
|---|---|---|
| `agent` | Spawn a fork subagent | Requires approval |

## Coordinator-only

| Tool | Description | Permission |
|---|---|---|
| `task` | Spawn a worker | Coordinator only |
| `send_message` | Message a teammate | Coordinator only |
| `task_stop` | Stop a worker | Coordinator only |
| `team_create` | Create a team | Coordinator only |
| `team_delete` | Disband a team | Coordinator only |
| `yield_turn` | Wait for workers | Coordinator only |

## LSP

| Tool | Description | Permission |
|---|---|---|
| `diagnostics` | Get language server diagnostics | Auto-approved |
| `hover` | Get hover information | Auto-approved |
| `definition` | Go to definition | Auto-approved |
