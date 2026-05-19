---
name: github-pr-review
description: Pull CodeRabbit review comments from a GitHub PR and fix the identified issues in the codebase
compatibility: Requires GitHub MCP server configured, Git repository with GitHub remote
metadata:
  author: liteai
  source: custom
---

# Fix CodeRabbit Review

Pull review comments from a GitHub pull request (primarily from CodeRabbit), analyze the issues, and apply fixes to the codebase.

## User Input

```text
$ARGUMENTS
```

If the user provides arguments:
- A PR number (e.g., `#42` or `42`) → use that specific PR
- `--all` → fix all open comments, not just unresolved
- `--dry-run` → analyze and report issues without making changes
- If empty, auto-detect the PR from the current branch

## Prerequisites

1. **Verify Git state**:
   - Run `git rev-parse --is-inside-work-tree` to confirm this is a Git repository
   - Run `git branch --show-current` to get the current branch name

2. **Verify GitHub MCP server**:
   - The GitHub MCP server must be available. If it is not, **STOP** with:
     ```
     [liteai] Error: GitHub MCP server is not configured.
     To add it, configure the GitHub MCP server in your IDE settings.
     ```

3. **Extract repo info**:
   - Run `git config --get remote.origin.url` to get the remote URL
   - Parse owner and repo name from the URL

## PR Discovery

1. **If PR number is provided**: Use it directly
2. **If no PR number**: 
   - Use the GitHub MCP server to list open PRs where the head branch matches the current branch
   - If exactly one PR is found, use it
   - If multiple PRs found, list them and ask the user to pick one
   - If no PR is found, **STOP**: "No open PR found for branch `<branch>`. Create one first with `/github-pr-submit`."

## Fetching Review Comments

1. **Pull all review comments** from the PR using the GitHub MCP server:
   - Get PR reviews (top-level review bodies)
   - Get PR review comments (inline code comments)
   - Get PR issue comments (general discussion comments)

2. **Filter for actionable CodeRabbit feedback**:
   - Identify comments from `coderabbitai[bot]` or containing CodeRabbit signatures
   - Also include comments from human reviewers (they are equally important)
   - Exclude:
     - Bot summary comments (the initial review summary — these are informational)
     - Already-resolved comment threads
     - Pure praise comments (e.g., "LGTM", "looks good")
   - Focus on:
     - Comments with specific code change suggestions (especially CodeRabbit's `suggestion` blocks)
     - Comments identifying bugs, type issues, or logic errors
     - Comments requesting refactors or improvements
     - Comments flagging missing error handling or tests

3. **Categorize issues by severity**:

   | Category | Description | Action |
   |----------|-------------|--------|
   | 🔴 Bug/Error | Logic errors, type mismatches, runtime failures | Fix immediately |
   | 🟡 Improvement | Refactors, better patterns, performance | Fix if straightforward |
   | 🟢 Nitpick | Style, naming, minor suggestions | Fix if trivial |
   | ⚪ Question | Reviewer asking for clarification | Report to user, do not auto-fix |

## Analysis & Planning

1. **Present the review summary** to the user:

   ```
   ## PR #<number> Review Summary
   
   Found <N> actionable review comments:
   
   ### 🔴 Bugs/Errors (<count>)
   1. [file:line] <summary of issue>
   2. ...
   
   ### 🟡 Improvements (<count>)
   1. [file:line] <summary of issue>
   2. ...
   
   ### 🟢 Nitpicks (<count>)
   1. [file:line] <summary of issue>
   2. ...
   
   ### ⚪ Questions (<count>)
   1. [file:line] <question summary>
   2. ...
   ```

2. **If `--dry-run`**: Stop here after presenting the summary

3. **Ask for confirmation** before proceeding:
   - "I found <N> actionable issues. Shall I fix all of them, or would you like to select specific ones?"
   - If user selects specific ones, only fix those

## Applying Fixes

For each actionable comment, in order of severity (🔴 → 🟡 → 🟢):

1. **Read the referenced file and line range** from the comment
2. **Understand the context**: Read surrounding code to understand the full picture
3. **Apply the fix**:
   - If the comment contains a CodeRabbit `suggestion` block with exact code, apply that suggestion
   - If the comment describes an issue without exact code, analyze and implement the appropriate fix
   - Follow the project's core mandates:
     - No silent fallbacks
     - Typed errors for invalid states
     - Non-blocking operations in async contexts
     - Strict tenant isolation in `packages/core`

4. **Verify each fix**:
   - Ensure the fix doesn't break surrounding code
   - Run `bun typecheck` after all fixes are applied (once, not per-fix)
   - Run `bun lint:fix` to ensure formatting compliance

> [!CAUTION]
> Do NOT blindly apply every suggestion. Evaluate each against the project's architecture and core mandates.
> If a suggestion conflicts with established patterns, skip it and report why.

## Post-Fix Actions

1. **Run verification**:
   - `bun typecheck` — report any new type errors
   - `bun lint:fix` — auto-fix formatting
   - Run scoped tests if identifiable from changed files

2. **Commit the fixes**:
   - Stage all changes: `git add .`
   - Commit with message: `fix: address PR review feedback (#<pr-number>)`
   - Push to remote: `git push origin HEAD`

3. **Report results**:
   ```
   ## Review Fix Summary
   
   PR #<number>: <title>
   
   ### Fixed (<count>)
   - ✅ [file:line] <what was fixed>
   - ...
   
   ### Skipped (<count>)
   - ⏭️ [file:line] <reason for skipping>
   - ...
   
   ### Questions for User (<count>)
   - ❓ [file:line] <question that needs human decision>
   - ...
   
   Changes committed and pushed. CodeRabbit will re-review automatically.
   ```

## Error Handling

- If a file referenced in a comment no longer exists, skip with a note
- If a line number is out of range (code has shifted), use the comment's code snippet to locate the correct position
- If a fix introduces new type errors, roll back that specific fix and report it
- If GitHub API rate limits are hit, wait and retry with exponential backoff

## Graceful Degradation

- If GitHub MCP is not available, output all review comments as a structured report so the user can fix manually
- If the PR has no review comments, inform: "No review comments found on PR #<number>. Nothing to fix."
