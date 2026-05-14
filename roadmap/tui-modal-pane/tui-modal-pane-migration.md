# TUI Dialog → Modal Pane Migration

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Created** | 2025-05-14 |
| **Owner** | TBD |
| **Priority** | Medium |
| **Category** | UI Refactoring |

## Context

LiteAI TUI renders all slash command UIs as **floating centered dialog overlays** using a `DialogProvider` stack (`push`/`pop`/`clear`). This creates several recurring issues:

- **ESC navigation confusion**: Sub-dialogs call `dialog.clear()` (closes everything) instead of `dialog.pop()` (returns to parent), creating inconsistent escape behavior.
- **Sort instability**: Provider/model lists re-sort during interaction because state updates from SSE trigger re-renders with non-deterministic sort ordering.
- **Focus management complexity**: Dialog stack must cooperate on focus ownership — each new dialog must correctly steal and release focus.
- **Non-standard UX**: Industry-standard CLI tools (Claude Code, Gemini CLI) use bottom-anchored inline panes, not floating overlays.

## Existing Infrastructure

`SessionLayout` (file: `packages/cli/src/tui/components/session-layout.tsx`) already has an unused `modal` slot:

```tsx
// SessionLayout props
modal?: ReactNode       // Slash-command dialog content
modalScrollRef?: RefObject<ScrollBoxHandle | null>

// Renders as:
<Box position="absolute" bottom={0} left={0} right={0}
     maxHeight={terminalRows - MODAL_TRANSCRIPT_PEEK}
     flexDirection="column" overflow="hidden" opaque={true}>
  <Text color="gray">{"▔".repeat(columns)}</Text>
  <Box flexDirection="column" paddingX={2}>{modal}</Box>
</Box>
```

This renders identically to Claude Code's `Pane` component — bottom-anchored, with a `▔` divider, terminal-size-aware. **No new layout infrastructure is needed.**

A `ModalContext` is also provided, giving child components access to `rows`, `columns`, and `scrollRef`.

## Migration Plan

### Phase 1: Bug Fixes (Completed)

- ✅ Added `/provider` slash command
- ✅ Removed `/settings` hub (redundant — every entry was already an individual command)
- ✅ Fixed provider dialog sort instability (secondary alphabetical sort key)
- ✅ Fixed frozen tip rotation (useState + setInterval)

### Phase 2: Simple Picker Migration

Migrate select-based commands from `dialog.push(DialogSelect)` to `SessionLayout.modal`:

| Command | Component | Complexity |
|---|---|---|
| `/models` | `DialogModel` | Low — single select list |
| `/provider` | `DialogProvider` | Medium — has sub-views (API key input, OAuth) |
| `/theme` | `DialogTheme` | Low — single select list |
| `/effort` | `DialogEffort` | Low — single select list |
| `/style` | `DialogOutputStyle` | Low — single select list |

**Pattern**: Instead of `dialog.push(() => <DialogModel />)`, the interceptor sets a `modalContent` state that flows into `SessionLayout.modal`:

```tsx
// Before (dialog overlay):
models: () => dialog.push(() => <DialogModel />)

// After (modal pane):
models: () => setModal(<DialogModel onClose={() => setModal(null)} />)
```

Each component needs:
1. An `onClose` prop (replaces `dialog.pop()`)
2. ESC keybinding that calls `onClose` (no stack confusion possible)
3. Removal of `dialog.push/pop/clear` calls

**Estimated effort**: ~2-4 hours per component.

### Phase 3: Complex View Migration

Migrate multi-view commands:

| Command | Component | Complexity |
|---|---|---|
| `/help` | `DialogHelpV2` | Medium — tabbed content |
| `/mcp` | `DialogMcp` | Medium — list + detail view |
| `/plugins` | `DialogPlugin` | Medium — list + detail view |
| `/context` | `DialogContextView` | Low — read-only display |
| `/stats` | `DialogStats` | Low — read-only display |
| `/diff` | `DialogDiff` | Medium — file list + diff viewer |
| `/doctor` | `DialogDoctor` | Medium — diagnostic runner |
| `/agents` | `DialogAgentList` | Medium — list + config |
| `/sessions` | `DialogSessionList` | Low — select list |
| `/permissions` | `DialogPermissions` | Medium — approval flow |
| `/rewind` | `DialogRewind` | High — timeline navigation |
| `/find` | `DialogSearch` | High — search + results |

**Estimated effort**: ~1-2 days total.

### Phase 4: Deprecate Dialog Overlay System

Once all commands use modal pane rendering:
1. Remove `DialogProvider` context (`packages/cli/src/tui/context/dialog.tsx`)
2. Remove `dialog.push/pop/clear/replace` API
3. Remove floating overlay rendering from `SessionLayout` (if any remains)
4. Simplify `DialogSelect` to work without dialog stack awareness

## Design Principles

1. **One modal at a time**: No stacking. ESC always returns to REPL.
2. **Bottom-anchored**: Content renders below conversation, not floating.
3. **Conversation visible**: Top portion of screen always shows conversation context.
4. **Simple focus model**: Modal owns all input; REPL prompt is hidden.
5. **Stateless transitions**: No push/pop stack — just `setModal(content)` / `setModal(null)`.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Phase 2-3 is a large diff | Migrate one command per PR |
| Sub-views within commands (e.g., provider auth flow) | Use local state within the modal component instead of dialog stack |
| Scroll behavior differs from overlay | `ModalContext` already provides `scrollRef` — use `ScrollBox` within modal |
| Commands that need to survive across turns | Not applicable — all current commands are synchronous UI |

## Success Criteria

- All slash commands render in bottom-anchored pane
- ESC always returns to REPL (no ambiguity)
- `DialogProvider` context is fully removed
- No visual regressions in command UIs
- Provider/model lists maintain stable sort order during interaction
