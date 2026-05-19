---
name: github-pr-submit
description: Create a GitHub pull request from the current feature branch with auto-generated description from spec artifacts
compatibility: Requires GitHub MCP server configured, Git repository with GitHub remote
metadata:
  author: liteai
  source: custom
---

# Submit Pull Request

Create a GitHub pull request from the current feature branch targeting `main`, with an auto-generated description derived from the feature's spec artifacts.

## Prerequisites

1. **Verify Git state**:
   - Run `git rev-parse --is-inside-work-tree` to confirm this is a Git repository
   - Run `git branch --show-current` to get the current branch name
   - If the current branch is `main`, **STOP** with error: "Cannot create a PR from the main branch. Switch to a feature branch first."
   - Run `git status --porcelain` to check for uncommitted changes
   - If there are uncommitted changes, **STOP** and ask: "You have uncommitted changes. Do you want me to commit them first before creating the PR?"

2. **Verify remote is up to date**:
   - Run `git push origin HEAD` to ensure the remote branch is up to date
   - If push fails, report the error and stop

3. **Verify GitHub MCP server**:
   - The GitHub MCP server must be available. If it is not, **STOP** with:
     ```
     [liteai] Error: GitHub MCP server is not configured.
     To add it, configure the GitHub MCP server in your IDE settings.
     ```

## Gathering PR Context

1. **Detect the feature spec directory**:
   - Parse the branch name for a numeric prefix (e.g., `014` from `014-yield-turn-removal`)
   - Look for a matching spec directory under `specs/` (e.g., `specs/014-yield-turn-removal/`)
   - If no spec directory is found, proceed without spec context

2. **Read available artifacts** (if spec directory exists):
   - `spec.md` → Feature description, goals, requirements
   - `plan.md` → Technical implementation details, architecture decisions
   - `tasks.md` → Task breakdown and completion status

3. **Check for existing PR**:
   - Use the GitHub MCP server to search for an existing open PR from the current branch to `main`
   - If a PR already exists, ask the user: "A PR already exists for this branch: #<number>. Do you want to update it or open a new one?"

## PR Generation

Generate the PR content:

### Title
- Use the spec title if available (from `spec.md` H1 heading)
- Otherwise, derive from the branch name by converting hyphens to spaces and capitalizing
- Prefix with the feature number if available (e.g., `[014] Yield Turn Removal`)

### Body
Build the PR body using this structure:

```markdown
## Description

<Summarize the feature from spec.md — 2-3 sentences covering the what and why>

## Changes

<Extract key changes from plan.md's "Proposed Changes" section, or from tasks.md completed tasks>

- <change 1>
- <change 2>
- ...

## Related

- Spec: `specs/<feature-dir>/spec.md`

## Task Status

<If tasks.md exists, summarize completion>
- Total: X tasks
- Completed: Y
- Remaining: Z

## Checklist

- [x] Typecheck passes (`bun typecheck`)
- [x] Lint passes (`bun lint`)
- [ ] Scoped tests pass
- [ ] No silent fallbacks or swallowed errors
```

> [!IMPORTANT]
> Do NOT blindly check all checklist items. Only mark items as checked if you have evidence they pass (e.g., you ran the commands and they succeeded).

## PR Creation

1. **Extract repo info**:
   - Run `git config --get remote.origin.url` to get the remote URL
   - Parse owner and repo name from the URL (supports HTTPS and SSH formats)

2. **Create the PR** using the GitHub MCP server:
   - **Base branch**: `main`
   - **Head branch**: current branch name
   - **Title**: generated title
   - **Body**: generated body
   - **Draft**: false (unless user explicitly requests a draft)

3. **Report the result**:
   ```
   ✅ Pull Request created successfully!
   PR #<number>: <title>
   URL: <html_url>
   
   CodeRabbit will automatically review this PR.
   ```

## Error Handling

- If the GitHub API returns an error, display the full error message
- If there are no commits ahead of main, inform the user: "This branch has no new commits compared to main. Nothing to PR."
- If the branch doesn't exist on the remote, push it first with `git push -u origin HEAD`

## User Input

```text
$ARGUMENTS
```

If the user provides arguments, treat them as overrides:
- A title string → use as PR title
- `--draft` → create as draft PR
- `--no-spec` → skip spec artifact lookup
