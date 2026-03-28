# CLI/TUI Extraction to `packages/cli`

## Objective

Extract the CLI and TUI infrastructure from `packages/core` into a standalone `packages/cli` workspace package,
while preserving the ability to build a single `liteai.exe` binary via Bun's `compile` mode.

## Architecture Decision

```
packages/core  (core library)
├── src/
│   ├── server/          ← stays here (HTTP server, routes, middleware)
│   ├── session/         ← stays here
│   ├── agent/           ← stays here
│   ├── bus/tui-event.ts ← NEW: TuiEvent definitions moved to core (shared bus events)
│   └── mcp/             ← refactored: uses domain events instead of TuiEvent directly
│
packages/cli  (NEW - CLI entry point)
├── src/
│   ├── index.ts         ← moved from liteai/src/index.ts (yargs CLI entrypoint)
│   └── cli/             ← moved from liteai/src/cli/ (all CLI commands + TUI)
│       ├── cmd/         ← all commands: serve, web, tui, run, mcp, github, etc.
│       ├── ui.ts        ← CLI formatting utilities
│       ├── error.ts     ← CLI error formatting
│       ├── logo.ts      ← ASCII logo
│       ├── network.ts   ← network option helpers
│       ├── bootstrap.ts ← instance bootstrap helper
│       └── upgrade.ts   ← upgrade checker
├── script/
│   ├── build.ts         ← copied from liteai, updated paths
│   ├── release.ts       ← copied from liteai
│   └── script.ts        ← copied from liteai
├── assets/              ← copied from liteai (icons, etc.)
├── package.json
├── tsconfig.json
├── biome.json
├── bunfig.toml
└── Dockerfile
```

**Key design decisions:**

- `server/routes/tui.ts` stays in `packages/core` (moving it would create a circular dep)
- `TuiEvent` bus event definitions moved to `packages/core/src/bus/tui-event.ts` (shared between
  server routes and CLI TUI code)
- MCP refactored to use domain-level `MCP.AuthRequired` event instead of directly emitting `TuiEvent.ToastShow`
- All CLI commands moved together (serve, web, tui, run, etc.) — they are entry points that invoke
  the core library, not the server itself
- `packages/cli` depends on `liteai: "workspace:*"` for core imports

## What Is Done

### Phase 1: Decouple MCP from TUI events ✅

- Replaced `TuiEvent.ToastShow` calls in `packages/core/src/mcp/index.ts` with new domain events:
  - `MCP.AuthRequired` — emitted when OAuth/auth fails
  - `MCP.BrowserOpenFailed` — emitted when browser can't be opened
- Updated `app.tsx` to subscribe to `MCP.AuthRequired` and show toast notifications
- `TuiEvent` definitions moved to `packages/core/src/bus/tui-event.ts`
- `server/routes/tui.ts` updated to import from `@/bus/tui-event` instead of `@/cli/cmd/tui/event`

### Phase 2: Scaffold `packages/cli` ✅

- Created `package.json` with all required dependencies:
  - `liteai`, `@liteai/util`, `@liteai-ai/sdk` as workspace deps
  - TUI deps: `@opentui/core`, `@opentui/solid`, `solid-js`, etc.
  - CLI deps: `yargs`, `@clack/prompts`, `clipboardy`, etc.
  - GitHub Actions deps: `@actions/core`, `@actions/github`, `@octokit/*`
  - MCP SDK: `@modelcontextprotocol/sdk`
- Created `tsconfig.json` with path aliases:
  - `@/*` → `../liteai/src/*` (for core imports — eventually should be removed)
  - `@tui/*` → `./src/cli/cmd/tui/*` (for TUI-internal imports)
- Created `biome.json`, `bunfig.toml`

### Phase 3: Move source files ✅

- `src/index.ts` → `packages/cli/src/index.ts` (via `git mv`)
- `src/cli/` → `packages/cli/src/cli/` (via copy + delete, git mv failed due to file locks)
- Build scripts (`script/build.ts`, `script/release.ts`, `script/script.ts`) copied
- `assets/` and `Dockerfile` copied

### Phase 4: Import path rewriting (PARTIALLY DONE ⚠️)

**What was done:**
- Bulk-replaced `from "@/"` → `from "liteai/"` across all files in `packages/cli/src/`
- Fixed `liteai/cli/` references → relative paths (these are intra-CLI, not core imports)
- Fixed barrel imports like `liteai/session` → `liteai/session/index`
- Fixed `liteai/../bootstrap` → `../bootstrap` (intra-CLI paths wrongly converted)
- Fixed `liteai/ui` → `../ui` (CLI-internal module, not a core module)
- Added `/index` suffix to barrel exports: `session`, `file`, `global`, `lsp`, `skill`,
  `installation`, `mcp`, `bus`, `auth`, `snapshot`, `hook`, etc.
- `liteai/../*` → `../*` bulk fix applied

**What is NOT done:**
- Many relative paths in `tui/` subdirectories are wrong after the bulk replacements.
  The `liteai/../` → `../` conversion removed the `liteai/` prefix but didn't account for 
  depth changes when files are in nested subdirectories like `component/prompt/`, 
  `routes/session/`, etc.

### Phase 5: Build infrastructure ✅

- `build.ts` updated to reference `liteaiDir` for generated files:
  - `models-snapshot.ts` → writes to `packages/core/src/provider/`
  - `app-assets.ts` → writes to `packages/core/src/server/`
  - Migrations read from `packages/core/migration/`
- `@parcel/watcher` version read from `liteaiPkg.dependencies`
- Root `package.json` scripts updated: `dev`, `build`, `build:all`, `release` point to `packages/cli`

### Phase 6: Verification (NOT DONE ❌)

## What Remains

### 1. Fix ~95 remaining import path errors in `packages/cli` (HIGH PRIORITY)

There are **110 total typecheck errors**, but ~15 are in `packages/core` (`.md` module imports and
test files). The remaining **~95 are in `packages/cli`** and fall into these categories:

#### Category A: Wrong relative paths in TUI subdirectories (~70 errors)

Files in `tui/routes/session/`, `tui/component/prompt/`, `tui/component/workspace/` have `../`
imports that resolve incorrectly because they need additional `../` depth. These were caused by 
the bulk `liteai/../` → `../` replacement not accounting for nesting.

**Root cause**: Files like `routes/session/index.tsx` had imports like `from "../../context/exit"` 
which originally resolved from `liteai/src/cli/cmd/tui/routes/session/` → `../../` → `tui/context/`.
After the bulk find-replace, these became `from "../context/exit"` which resolves from 
`cli/src/cli/cmd/tui/routes/session/` → `../` → only goes to `routes/`, not `tui/`.

**Fix**: The most reliable approach is to use the `@tui/*` path alias from `tsconfig.json` 
instead of relative paths. For example:
```ts
// Instead of fragile relative paths:
import { useTheme } from "../../context/theme"
// Use the alias:
import { useTheme } from "@tui/context/theme"
```

Many files already use `@tui/*` imports from the original code. The remaining ones just need to be
converted. Check existing `@tui/` usage in `app.tsx` for examples.

**Affected files** (with error counts):
| File | Errors | Pattern |
|------|--------|---------|
| `component/prompt/index.tsx` | 21 | `../context/*`, `../event`, `../ui/*` |
| `component/workspace/dialog-session-list.tsx` | 13 | `../context/*`, `../util/*` |
| `routes/session/permission.tsx` | 9 | `../component/*`, `../context/*`, `../ui/*` |
| `routes/session/index.tsx` | 8 | `../context/*`, `../ui/*`, parsers-config |
| `routes/session/commands.tsx` | 7 | `../component/*`, `../ui/*` |
| `routes/session/question.tsx` | 6 | `../component/*`, `../context/*`, `../ui/*` |
| `routes/session/sidebar.tsx` | 4 | `../component/*`, `../context/*` |
| `routes/session/dialog-timeline.tsx` | 2 | `../component/*`, `../ui/*` |
| `component/dialog-stash.tsx` | 3 | implicit `any` types |
| `component/dialog-session-list.tsx` | 1 | `../util/signal` |
| `component/prompt/frecency.tsx` | 1 | `../context/helper` |
| `component/prompt/history.tsx` | 1 | `../context/helper` |
| `component/prompt/stash.tsx` | 1 | `../context/helper` |
| `context/exit.tsx` | 1 | `../error` (needs `../../error`) |
| `routes/session/ctx.tsx` | 1 | `../context/tui-config` |
| `routes/session/dialog-fork-from-timeline.tsx` | 1 | `../ui/dialog` |
| `routes/session/header.tsx` | 1 | `../context/keybind` |
| `routes/session/tools.tsx` | 1 | `../component/todo-item` |

#### Category B: Specific broken imports (~10 errors)

- `thread.ts:12` — `from "../network"` and `from "../ui"` need `../../network` and `../../ui`
  (thread.ts is at `cmd/tui/thread.ts`, network/ui are at `cli/`)
- `worker.ts:14` — `upgrade` export not found from `"../upgrade"` — check actual export name
- `clipboard.ts:6` — `liteai/util/lazy.js` should be `liteai/util/lazy`  
- `routes/session/index.tsx:15` — `liteai/liteai/parsers-config.ts` is wrong (double `liteai/`)
  — should be a relative path to `packages/core/parsers-config.ts`

#### Category C: Type errors (~15 errors)

- `thread.ts` — `{}` not assignable to `string`, `unknown` not assignable to typed params
  (likely yargs args typing issue from the move)
- `permission.tsx:136` — implicit `any` parameter
- `dialog-stash.tsx` — implicit `any` and type mismatch on `setToDelete`

### 2. Fix 3 test file imports in `packages/core` (LOW PRIORITY)

Three test files in `packages/core/test/cli/` reference code that moved:
- `test/cli/plugin-auth-picker.test.ts` → imports from `src/cli/cmd/providers`
- `test/cli/tui/thread.test.ts` → imports from `src/cli/cmd/tui/thread`
- `test/cli/tui/transcript.test.ts` → imports from `src/cli/cmd/tui/util/transcript`

**Fix**: Move these test files to `packages/cli/test/` or update imports to use `@liteai/cli/*`.

### 3. Remove old files from `packages/core` (LOW PRIORITY)

- `packages/core/src/cli/` — already deleted ✅
- `packages/core/src/index.ts` — already moved ✅ (check if stale copy exists)
- Old build scripts in `packages/core/script/` — keep for now (they may still be referenced)
- `packages/core/server/routes/tui.ts` — stays (intentionally kept in core)

### 4. Verify single-binary build (AFTER TYPECHECK PASSES)

Run `bun run build` from `packages/cli` and verify:
- Binary compiles successfully
- `liteai.exe` works end-to-end
- All commands function (especially `liteai serve`, `liteai web`, TUI)

### 5. Run full test suite (AFTER BUILD WORKS)

- `bun test` in `packages/core` (core tests)
- `bun test` in `packages/cli` (moved CLI tests)
- `bun lint:fix` in both packages

## Quick Reference

```powershell
# Typecheck CLI package
cd packages/cli
bunx --bun tsc --noEmit

# Lint CLI package
cd packages/cli
bun lint:fix

# Typecheck core package
cd packages/core
bunx --bun tsc --noEmit

# Build single binary
cd packages/cli
bun run build
```

## File Inventory

### Moved to `packages/cli`
- `src/index.ts` (CLI entrypoint with yargs)
- `src/cli/` (entire directory — all commands, TUI, utilities)
- `script/build.ts`, `script/release.ts`, `script/script.ts`
- `assets/`, `Dockerfile`

### Stays in `packages/core`
- `src/server/` (all server code including `routes/tui.ts`)
- `src/bus/tui-event.ts` (NEW — TuiEvent definitions, shared between packages)
- `src/mcp/` (refactored to use domain events)
- Everything else (session, agent, provider, config, storage, etc.)

### New files
- `packages/core/src/bus/tui-event.ts` — TuiEvent bus event definitions
- `packages/cli/src/cli/cmd/tui/event.ts` — re-exports TuiEvent from core
- `packages/cli/package.json`, `tsconfig.json`, `biome.json`, `bunfig.toml`
