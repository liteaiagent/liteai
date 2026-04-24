# Phase 2.7: Cleanup & Validation

**Branch**: `feat/cli-react`
**Depends on**: Phase 2.6 (all routes, app root, and entry points complete)
**Produces**: Clean codebase with SolidJS removed, fully validated React TUI

## Objective

Delete the old SolidJS TUI code, remove SolidJS dependencies from `package.json`, and perform comprehensive validation to confirm the React TUI is functionally complete.

## Key Paths

| Resource | Path |
|----------|------|
| **CLI package.json** | `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\package.json` |
| **Old SolidJS TUI** | `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\cli\cmd\tui\` |
| **New React TUI** | `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\tui\` |

## Proposed Changes

### 1. [DELETE] Old SolidJS TUI files

Remove everything in the old TUI directory except framework-agnostic files:

```
git rm    src/cli/cmd/tui/app.tsx
git rm -r src/cli/cmd/tui/component/
git rm -r src/cli/cmd/tui/context/
git rm -r src/cli/cmd/tui/routes/
git rm -r src/cli/cmd/tui/ui/
git rm -r src/cli/cmd/tui/util/
git rm    src/cli/cmd/tui/event.ts
```

**Keep** (framework-agnostic, still referenced by `thread.ts` / `attach.ts`):
- `attach.ts` — CLI command entry point (rewired in phase 2.6)
- `thread.ts` — CLI command entry point (rewired in phase 2.6)
- `worker.ts` — Worker process management
- `win32.ts` — Win32 input handling

### 2. [MODIFY] `packages/cli/package.json`

Remove SolidJS and OpenTUI dependencies:

```diff
- "@opentui/core": "0.1.87"
- "@opentui/solid": "0.1.87"
- "@solid-primitives/event-bus": "1.1.2"
- "@solid-primitives/scheduled": "1.5.2"
- "solid-js": "catalog:"
- "opentui-spinner": "0.0.6"
```

### 3. Clean up path aliases

If `tsconfig.json` has path aliases for `@tui/*` pointing to the old directory, update them to point to `src/tui/`.

### 4. Run `bun install` to update lockfile

Remove old dependencies from the lockfile.

## Verification Plan

### Automated Gates

| Step | Command | Expected |
|------|---------|----------|
| 1 | `bun install` | Succeeds, lockfile updated |
| 2 | `bun typecheck 2>&1 \| Out-String` | All 12 packages pass (no SolidJS refs remaining) |
| 3 | `bun lint:fix` | No errors |
| 4 | `cd packages/cli && bun test test/` | Existing CLI tests pass |

### Manual Testing

| Scenario | Steps | Expected Result |
|----------|-------|----------------|
| **Server start** | `liteai serve` | Server starts normally — no TUI involvement |
| **New thread** | `liteai thread` | React+Ink TUI renders in terminal |
| **Message flow** | Type message in TUI → send | SSE streaming, assistant response renders with markdown |
| **Tool calls** | Trigger a tool call (e.g., file edit) | Tool progress, diff rendering, permission prompt |
| **Abort** | Press Ctrl+C during generation | Clean abort, no orphan processes |
| **Session resume** | `liteai -s <sessionID>` | Loads existing session, messages render |
| **Attach** | `liteai attach http://...` | Attaches to remote server, TUI renders |
| **Non-TUI commands** | `liteai run`, `liteai session list`, `liteai agent list` | All work unchanged |
| **Command palette** | Ctrl+P (or configured keybind) | Command palette opens, fuzzy search works |
| **Model switching** | Via command palette or keybind | Model changes, displayed in status |
| **Theme switching** | Via command palette | Theme changes, all colors update |
| **Sidebar** | Toggle sidebar on wide terminal | Sidebar shows/hides correctly |
| **Win32 input** | Test on Windows terminal | Ctrl+C guard works, no processed input issues |

### Regression Checks

- [ ] No `solid-js` imports remain anywhere in `packages/cli/`
- [ ] No `@opentui/core` imports remain
- [ ] No `@opentui/solid` imports remain
- [ ] No `@solid-primitives/*` imports remain
- [ ] `grep -r "solid" packages/cli/src/` returns zero results (excluding comments/docs)

## Review Checklist

- [ ] Old SolidJS files deleted
- [ ] SolidJS dependencies removed from `package.json`
- [ ] `bun install` clean
- [ ] `bun typecheck` clean (all 12 packages)
- [ ] `bun lint:fix` clean
- [ ] `bun test test/` passes
- [ ] Manual testing: `liteai thread` works end-to-end
- [ ] Manual testing: `liteai serve` unaffected
- [ ] No SolidJS references remain in codebase
- [ ] PR ready for merge
