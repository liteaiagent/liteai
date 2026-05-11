---
title: Checkpointing
description: "How LiteAI snapshots file state for undo/revert functionality."
---

# Checkpointing

LiteAI automatically creates checkpoints after each file-modifying tool execution, enabling undo and revert workflows.

## How it works

After a tool modifies a file, LiteAI:
1. Captures the diff (before/after content)
2. Records the git state (branch, commit hash)
3. Stores the checkpoint in SQLite
4. Timestamps the entry

## Using undo/revert

| Command | Effect |
|---|---|
| `/undo` | Revert the most recent file change |
| `/revert` | Show checkpoint history and select a restore point |

## What's stored

| Data | Storage |
|---|---|
| File diffs | SQLite (session database) |
| Git state | SQLite |
| Metadata | SQLite |

## Limitations

- Checkpoints only track file modifications made by LiteAI tools
- External changes (manual edits, git operations) are not tracked
- Very large files may have truncated diffs
