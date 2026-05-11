---
title: Project setup
description: "Initialize a LiteAI project, configure workspace detection, and set up version control integration."
---

# Project setup

## Initialize a project

Create a `.liteai/` directory in your project root:

```bash
mkdir -p .liteai
```

Optionally create project-specific settings:

```bash
cat > .liteai/settings.json << 'EOF'
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514"
}
EOF
```

And project instructions:

```bash
cat > AGENTS.md << 'EOF'
# Project Rules
- Use TypeScript strict mode
- Run `bun test` after modifications
EOF
```

## Workspace detection

LiteAI automatically detects your project root by searching upward for:
1. `.liteai/` directory
2. `.git/` directory
3. `package.json`
4. Other VCS markers (`.hg/`, `.svn/`)

The first match becomes the project root. All relative paths in configuration are resolved from this root.

## Version control integration

LiteAI integrates with git for:
- **Checkpointing** — File diffs before/after tool execution
- **Worktree isolation** — Sandbox mode using `git worktree`
- **Change detection** — Tracking modified files for undo/revert

### .gitignore recommendations

Add to your `.gitignore`:

```
# LiteAI local files (don't commit)
.liteai/plugins/
.liteai/teams/
```

Files to **commit** (shared team configuration):

```
# Commit these
.liteai/settings.json
.liteai/agents/
.liteai/skills/
.liteai/commands/
AGENTS.md
.mcp.json
```

## Multi-workspace support

LiteAI's control plane supports multiple workspaces simultaneously. Each workspace operates as an independent project instance with isolated configuration and session state.

## What's next?

- [**Settings reference**](/configuration/settings) — Full configuration schema
- [**Explore the .liteai directory**](/getting-started/explore-liteai-directory) — Directory structure
