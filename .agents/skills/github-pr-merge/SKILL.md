---
name: github-pr-merge
description: Review and merge GitHub pull requests using merge commits to preserve branch history in the git graph. Use this skill whenever the user wants to merge a PR, review an open PR before merging, merge multiple PRs, or manage the full PR lifecycle from review through merge and cleanup. Triggers on phrases like "merge PR", "review and merge", "merge the open PRs", "close the PR", or any mention of merging pull requests.
compatibility: Requires GitHub MCP server configured, Git repository with GitHub remote
metadata:
  author: liteai
  source: custom
---

# PR Review & Merge

Review and merge GitHub pull requests with merge commits (`--no-ff` style) so every merged branch remains visible in the git graph. This gives you a clear visual record of how many feature branches were integrated and when.

## Why Merge Commits

Squash merges and rebases create a linear history — clean, but you lose sight of which work came from which branch. Merge commits preserve the branch topology:

- Each merged branch appears as a distinct "lane" in the git graph
- You can see exactly how many branches were merged and where they joined main
- Reverting a full feature is one command: `git revert -m 1 <merge-commit>`
- `git log --first-parent main` gives a clean summary of integration points

## User Input

```text
$ARGUMENTS
```

If the user provides arguments:
- A PR number (e.g., `#2` or `2`) → target that specific PR
- `--all` → process all open PRs in dependency order
- `--dry-run` → review only, do not merge
- `--squash` → override: use squash merge instead of merge commit
- If empty, auto-detect open PRs or use the current branch's PR

## Prerequisites

1. **Verify Git state**:
   - Run `git rev-parse --is-inside-work-tree` to confirm this is a Git repository
   - Run `git branch --show-current` to get the current branch name

2. **Extract repo info**:
   - Run `git config --get remote.origin.url` to get the remote URL
   - Parse owner and repo name from the URL (supports HTTPS and SSH formats)

3. **Verify GitHub MCP server**:
   - The GitHub MCP server must be available. If it is not, **STOP** with:
     ```
     [liteai] Error: GitHub MCP server is not configured.
     To add it, configure the GitHub MCP server in your IDE settings.
     ```

## Phase 1: Discovery

1. **List open PRs**:
   - Use the GitHub MCP server `list_pull_requests` with `state: "open"`
   - If a specific PR number was given, fetch only that one with `pull_request_read` (method: `get`)
   - If no PRs are found, **STOP**: "No open pull requests found."

2. **For each PR, gather**:
   - PR metadata: number, title, author, draft status, base/head branches, created date
   - Mergeable state: check `mergeable_state` — must be `clean` or `unstable` to proceed
   - CI status: note if checks are pending, passing, or failing
   - Diff: use `pull_request_read` with `method: "get_diff"` to fetch the changes

3. **Present discovery summary**:
   ```
   ## Open Pull Requests

   | # | Title | Branch | Status | CI | Files |
   |---|-------|--------|--------|-----|-------|
   | 2 | fix(util): async Fs.exists | ai-findings-autofix/... | Ready | ✅ | 1 |
   | 3 | fix: CodeQL findings | fix/codeql-quality | Draft | ⏳ | 16 |
   ```

## Phase 2: Review

For each PR to be merged, perform a code review:

1. **Fetch the diff** using `pull_request_read` with `method: "get_diff"`

2. **Analyze each change**:
   - Correctness: Does the logic make sense? Are there off-by-one errors, null safety issues, or type mismatches?
   - Compatibility: Does this change break existing consumers? Check function signatures, exports, return types
   - Edge cases: Are there unhandled paths? Missing error handling?
   - Style: Does it follow the project's established patterns?

3. **Categorize findings**:

   | Severity | Description | Action |
   |----------|-------------|--------|
   | 🔴 Blocker | Bugs, security issues, breaking changes | Must fix before merge |
   | 🟡 Concern | Behavioral differences, missing guards | Document, decide with user |
   | 🟢 Clean | Correct, safe, well-structured | Approve |

4. **Present the review** with specific line-level analysis for each change, explaining the reasoning (not just "looks good"). Highlight any behavioral differences between old and new code.

5. **If blockers exist**: Report them and **STOP**. Do not proceed to merge until resolved.

6. **Ask for user confirmation**: "Review complete — [summary]. Shall I proceed with merge?"

## Phase 3: Pre-Merge Checks

Before merging, verify these conditions. If any fail, stop and report.

1. **Draft status**: If the PR is a draft, mark it as ready first using `update_pull_request` with `draft: false`

2. **CI status**: Check that status checks have completed
   - If checks are **pending**, warn the user: "CI checks haven't completed yet. Merging now will leave a pending status indicator on this PR. Wait or proceed?"
   - If checks are **failing**, **STOP**: "CI checks are failing. Fix the issues before merging."
   - If checks are **passing**, proceed

3. **Merge conflicts**: If `mergeable_state` is not `clean`, the PR has conflicts
   - **STOP**: "This PR has merge conflicts. Resolve them before merging."

4. **Branch freshness**: If the PR branch is behind the base, use `update_pull_request_branch` to sync it, then **wait for CI to complete on the updated branch** before merging. This prevents the "orange dot" problem where merging happens before checks run on the final commit.

## Phase 4: Merge

1. **Merge the PR** using the GitHub MCP `merge_pull_request` tool:
   - `merge_method`: `"merge"` (default — preserves branch history in graph)
   - `commit_title`: Use the PR title, or a descriptive summary
   - `commit_message`: Include PR number reference (e.g., `(#3)`)

   Only use `"squash"` if the user explicitly passes `--squash`.

2. **If merging multiple PRs**, process them in dependency order:
   - If PR B's branch was created from PR A's branch, merge A first
   - After each merge, update remaining PRs' branches with `update_pull_request_branch` if needed
   - Wait for CI to pass on updated branches before merging the next

## Phase 5: Cleanup

After each successful merge:

1. **Delete the remote branch**:
   - Use `git push origin --delete <branch-name>` to remove the merged feature branch
   - This prevents stale branches from cluttering the git graph
   - If pre-push hooks run (typecheck, tests), that's expected — they validate against the current HEAD

2. **Delete the local branch** (if it exists):
   - `git branch -d <branch-name>`

3. **Pull and prune locally**:
   - `git checkout main`
   - `git pull`
   - `git fetch --prune` to clean up stale remote-tracking references

4. **Verify clean state**:
   - Run `git log --oneline --graph -5 main` to confirm the merge commits appear correctly
   - Run `git branch -r` to confirm no stale remote branches remain

## Phase 6: Report

Present a final summary:

```
## Merge Summary

| PR | Title | Merge | Branch Cleanup |
|----|-------|-------|----------------|
| #2 | fix(util): async Fs.exists | ✅ Merged (65f10ba) | ✅ Deleted |
| #3 | fix: CodeQL findings | ✅ Merged (2610cbe) | ✅ Deleted |

Local `main` is at 2610cbe7 — 2 branches merged.

Git graph:
* 2610cbe7 (HEAD -> main) Merge pull request #3
|\
| * c13de881 fix: resolve CodeQL security and quality findings
|/
* 65f10ba0 Merge pull request #2
|\
| * f3d3a05b fix(util): async Fs.exists, sync-safe Fs.size
|/
* 6a7c22f3 feat(cli): unified message rendering (016)
```

## Error Handling

- **Token permissions**: If the merge API returns 403, report: "The GitHub token lacks merge permissions. Either update the token scopes or merge manually from the GitHub UI."
- **Branch protection**: If merge is blocked by branch protection rules, report which rules are failing
- **Rate limits**: If GitHub API returns 429, wait and retry with exponential backoff
- **Transient errors**: If GitHub returns 502/503 (like the "Unicorn" page), retry up to 3 times with 5-second delays
- **Pre-push hooks**: When deleting remote branches, pre-push hooks may run typecheck/tests. This is expected behavior — the hooks validate code integrity. If they fail, the branch deletion will fail; report the error.

## Multi-PR Ordering

When merging multiple PRs, order matters:

1. **Check for dependencies**: If any PR's head branch was forked from another PR's branch (not from main), that's a dependency
2. **Sort by creation date**: Within independent PRs, merge oldest first
3. **Update between merges**: After each merge, remaining PRs may need their branches updated with the new main
4. **Wait for CI**: After updating a PR's branch, wait for status checks to complete before merging — never merge with pending checks
