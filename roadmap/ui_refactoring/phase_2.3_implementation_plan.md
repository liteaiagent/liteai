# Phase 2.3: Complex Contexts

This phase ports the most complex state management contexts from SolidJS to React in `@liteai/cli`, while extending `@liteai/ink` with the necessary low-level terminal and UI APIs.

## User Review Required

> [!IMPORTANT]
> This phase includes significant changes to `@liteai/ink` to support advanced TUI features like terminal color querying and focus management.
> I will use the **MVP codebase** (`liteai_cli_mvp`) as a primary reference for React-based state management patterns and component structures.

> [!WARNING]
> `theme.tsx` is being refactored to use **hex strings** instead of the `RGBA` class. All theme definitions will be updated.

## Proposed Changes

### `@liteai/ink` Extension

Expose missing renderer and focus APIs required by the complex contexts.

#### [NEW] [FocusContext.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/components/FocusContext.ts)
- Create a context to provide the `FocusManager` and current focus state.

#### [MODIFY] [AppContext.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/components/AppContext.ts)
- Add `getPalette(options: { size: number }): Promise<TerminalColors>`
- Add `clearPaletteCache(): void`
- Add `suspend(): void`
- Add `resume(): void`
- Add `toggleDebugOverlay(): void`
- Add `toggleConsole(): void`

#### [MODIFY] [App.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/components/App.tsx)
- Implement the new `AppContext` methods.
- Provide `FocusContext` using the `focusManager` passed from `Ink`.

#### [NEW] [use-focus.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ink/src/hooks/use-focus.ts)
- Hook to access focus management: `focus()`, `blur()`, `activeElement`.

---

### `@liteai/cli` Context Porting

Port the 4 complex contexts to `src/tui/context/`.

#### [NEW] [sync.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/sync.tsx)
- Port from `cli/cmd/tui/context/sync.tsx`.
- Use **Zustand** with **Immer** middleware for state management.
- Handle SSE events from `sdk.event.listen`.
- Preserve binary search and mutation logic.

#### [NEW] [theme.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/theme.tsx)
- Port from `cli/cmd/tui/context/theme.tsx`.
- Refactor `RGBA` usage to **hex strings**.
- Use `src/tui/util/color.ts` for color calculations (tint, contrast).
- Implement system theme detection via `useApp().getPalette()`.
- Port `SyntaxStyle` rules.

#### [NEW] [local.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/local.tsx)
- Port from `cli/cmd/tui/context/local.tsx`.
- Manage agent/model selection and favorites.
- Persist preferences to `model.json`.

#### [NEW] [keybind.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/keybind.tsx)
- Port from `cli/cmd/tui/context/keybind.tsx`.
- Use `useInput` from `@liteai/ink`.
- Implement leader key logic and focus-aware keyboard shortcuts.

## Verification Plan

### Automated Tests
- `bun typecheck` to ensure no regressions in typing.
- Scoped tests for the new contexts if applicable.

### Manual Verification
- Verify theme switching and system theme detection in the CLI TUI.
- Verify session and message sync via SSE.
- Verify agent/model selection persistence.
- Verify keyboard shortcuts (including leader keys).
