# Phase 2.6: Routes & App Entry

**Branch**: `feat/cli-react`
**Depends on**: Phase 2.5 (all components available)
**Produces**: Route screens, app root, and rewired CLI entry points

## Objective

Build the route screens (home, session), create the React app root with provider tree, and rewire the CLI entry points (`attach.ts`, `thread.ts`) to use the new React TUI. After this phase, the new React TUI is functionally complete.

## Source References

### MVP Sources (visual layer)

**MVP codebase**: `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp\`

| MVP Source | Port To | Size | Notes |
|-----------|---------|------|-------|
| `liteai_cli_mvp\components\Messages.tsx` | `routes/session/messages.tsx` | 147KB | Virtual scroll, message list |
| `liteai_cli_mvp\components\MessageRow.tsx` | `routes/session/message-row.tsx` | 48KB | Individual message row |
| `liteai_cli_mvp\components\Message.tsx` | `routes/session/message.tsx` | 79KB | Message content rendering |
| `liteai_cli_mvp\components\QuickOpenDialog.tsx` | `routes/session/commands.tsx` | 29KB | Command palette |
| `liteai_cli_mvp\hooks\useGlobalKeybindings.tsx` | `routes/session/keybindings.tsx` | 31KB | CLI-only keybindings |

### Existing SolidJS Sources (architectural reference)

**SolidJS base path**: `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\cli\cmd\tui\`

| SolidJS Source | Reference For | Lines |
|---------------|--------------|-------|
| `app.tsx` | Provider tree order, keyboard handling, terminal setup | 913 |
| `routes/home.tsx` | Home screen features and layout | ~200 |
| `routes/session/index.tsx` | Session screen layout, scrollbox, sidebar | 448 |
| `routes/session/header.tsx` | Session header bar | ~100 |
| `routes/session/sidebar.tsx` | Fork/child session sidebar | ~200 |
| `routes/session/messages.tsx` | Message rendering integration | ~150 |
| `routes/session/parts.tsx` | Tool call parts rendering | ~300 |
| `routes/session/tools.tsx` | Tool-specific renderers | ~400 |
| `routes/session/permission.tsx` | Permission request prompt | ~100 |
| `routes/session/question.tsx` | Question prompt | ~80 |
| `routes/session/commands.tsx` | Command palette registration | ~200 |
| `routes/session/dialog-message.tsx` | Message action dialog | ~100 |
| `routes/session/ctx.tsx` | Session-scoped context | ~30 |
| `routes/session/utils.ts` | Scroll acceleration, helpers | ~50 |

### CLI Entry Points

| File | Path | Action |
|------|------|--------|
| `attach.ts` | `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\cli\cmd\tui\attach.ts` | Rewire import |
| `thread.ts` | `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\cli\cmd\tui\thread.ts` | Rewire import |

**New React target path**: `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\tui\`

## Proposed Changes

### Work Unit 1: Layout (`routes/session/` core)

#### [NEW] `src/tui/routes/session/ctx.tsx`
Session-scoped context. Provides width, sessionID, display preferences (conceal, showThinking, etc.) to child components.

#### [NEW] `src/tui/routes/session/index.tsx`
Main session layout. Structure: scrollbox (messages) + footer (prompt/permission/question) + optional sidebar.
- Layout from existing SolidJS architecture
- Visual primitives from MVP (ThemedBox, Pane)
- Data from `useSync().data.message[sessionID]`, `useSync().data.part[messageID]`

#### [NEW] `src/tui/routes/session/header.tsx`
Session header bar showing session title, agent, model info.

#### [NEW] `src/tui/routes/session/sidebar.tsx`
Fork/child session sidebar. Shows session tree.

#### [NEW] `src/tui/routes/session/utils.ts`
Scroll acceleration, custom speed scroll. Framework-agnostic.

### Work Unit 2: Message Rendering

#### [NEW] `src/tui/routes/session/messages.tsx`
**Port from MVP**: `Messages.tsx` (147KB) — the richest MVP component.
- Virtual scroll, message list, auto-scroll to bottom
- **Data adaptation**: MVP reads from `useReplBridge` → our code reads from `useSync().data.message[sessionID]`

#### [NEW] `src/tui/routes/session/message-row.tsx`
**Port from MVP**: `MessageRow.tsx` (48KB)

#### [NEW] `src/tui/routes/session/message.tsx`
**Port from MVP**: `Message.tsx` (79KB)
- Uses markdown renderer, diff viewer, tool output from phase 2.5

#### [NEW] `src/tui/routes/session/parts.tsx` + `tools.tsx`
Tool call rendering. Reference existing SolidJS for the tool types and rendering patterns. Use MVP's `ToolUseLoader` component.

### Work Unit 3: Interactions

#### [NEW] `src/tui/routes/session/permission.tsx`
Permission request prompt. Use existing SolidJS as feature spec, build with MVP design-system primitives.

#### [NEW] `src/tui/routes/session/question.tsx`
Agent question prompt. Same approach.

#### [NEW] `src/tui/routes/session/commands.tsx`
Command palette registration. Port from MVP's `QuickOpenDialog.tsx` (29KB) or existing command pattern. Registers all session-scoped commands (toggle sidebar, toggle thinking, redo, etc.).

#### [NEW] `src/tui/routes/session/dialog-message.tsx`
Message action dialog (copy, fork, revert).

### Home Route

#### [NEW] `src/tui/routes/home.tsx`
Home screen. Use existing SolidJS `routes/home.tsx` as feature reference. Build with MVP design-system components.

### App Root

#### [NEW] `src/tui/app.tsx`
New React root. Structure:
- Export `tui()` function matching existing signature (receives config, returns cleanup)
- `renderSync()` from `@liteai/ink`
- React class `ErrorBoundary`
- Provider tree order (from existing `app.tsx` line ~800+):
  ```
  ArgsProvider → TuiConfigProvider → SDKProvider → SyncProvider →
  ExitProvider → ThemeProvider → KVProvider → LocalProvider →
  KeybindProvider → PromptRefProvider → RouteProvider →
  DialogProvider → ToastProvider → AppContent
  ```
- `useInput()` for global keyboard handling
- `useTerminalViewport()` for dimensions
- Win32 input guards (`win32DisableProcessedInput`, `win32InstallCtrlCGuard`) — keep as-is

### Entry Point Rewiring

#### [MODIFY] `attach.ts`
```diff
- import { tui } from "./app"
+ import { tui } from "../../../tui/app"
```

#### [MODIFY] `thread.ts`
```diff
- import { tui } from "./app"
+ import { tui } from "../../../tui/app"
```

## Verification

```powershell
cd c:\Users\aghassan\Documents\workspace\liteai
bun typecheck 2>&1 | Out-String
bun lint:fix
```

**Gate**: Full app compiles. Entry points rewired. Ready for integration testing.

## Review Checklist

- [ ] Session route renders (messages, header, sidebar)
- [ ] Home route renders
- [ ] App root provider tree matches existing order
- [ ] `tui()` function signature matches existing
- [ ] `attach.ts` and `thread.ts` imports updated
- [ ] `bun typecheck` clean
- [ ] `bun lint:fix` clean
