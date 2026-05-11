---
title: Commands
description: "Built-in slash commands and custom command definition."
---

# Commands

LiteAI provides slash commands for quick actions during interactive sessions.

## Built-in commands

| Command | Description |
|---|---|
| `/mode <mode>` | Switch session mode (build, plan, coordinator) |
| `/model <name>` | Switch model |
| `/undo` | Revert the last change |
| `/revert` | Revert to a specific checkpoint |
| `/clear` | Clear conversation history |
| `/export` | Export session transcript |
| `/help` | Show available commands |
| `/plan` | Switch to plan mode (shortcut) |
| `/build` | Switch to build mode (shortcut) |
| `/init` | Initialize a new project |
| `/review` | Review uncommitted changes |
| `/agent <name>` | Switch to a specific agent |

## Custom commands

Define custom commands in `.liteai/commands/`:

```markdown
---
name: deploy
description: Deploy to staging
---

# Deploy Command

1. Run `bun run build`
2. Run `bun run test`
3. If tests pass, run `./deploy.sh staging`
4. Report the deployment URL
```

### Command location

```
1. Global:   ~/.liteai/commands/**/*.md
2. Project:  .liteai/commands/**/*.md
```

Custom commands appear in the `/` autocomplete menu.
