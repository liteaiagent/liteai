# TUI Modal Pane Migration — Implementation Plan

Migrate slash command dialogs from floating, stack-based overlays (`DialogProvider.push/pop/clear/replace`) to the bottom-anchored, inline modal pane already scaffolded in `SessionLayout`.

## Reference Architecture (Claude Code)

Claude Code's pattern, confirmed from `D:\claude-code`, validates our design:

| Layer | Claude Code | LiteAI (current) | LiteAI (target) |
|---|---|---|---|
| **Layout** | `FullscreenLayout` has a `modal` prop → absolute-positioned bottom pane with `▔` divider + `ModalContext` | `SessionLayout` already has `modal` prop → identical bottom pane with `▔` divider + `ModalContext` ✅ | Same |
| **Modal detection** | `useIsInsideModal()` → `Pane` skips its own divider when inside modal | `ModalContext` exists but unused by dialogs | Dialogs use `ModalContext` for sizing |
| **Command dispatch** | `toolJSX.isLocalJSXCommand` → `centeredModal` state → `FullscreenLayout.modal` | `dialog.push(() => <Component />)` → floating overlay | `setModal(<Component onClose={closeModal} />)` → `SessionLayout.modal` |
| **Close mechanism** | `onDone` callback → clears `toolJSX` | `dialog.pop()/clear()` → stack unwinding | `onClose` callback → `setModal(null)` |
| **Sub-navigation** | Commands manage internal view state | `dialog.replace()` for screen transitions | Local `useState` for view transitions |

> [!IMPORTANT]
> Claude Code does **not** use a stack or context for modal navigation. The REPL owns a single `centeredModal` ReactNode derived from `toolJSX`, and commands receive an `onDone` callback. This is exactly the pattern our roadmap prescribes.

---

## Proposed Changes

### Phase 2a: Modal Pane Context Infrastructure

#### [NEW] [modal-pane.tsx](file:///d:/liteai/packages/cli/src/tui/context/modal-pane.tsx)

New context providing:
```tsx
type ModalPaneAPI = {
  openModal: (content: ReactNode) => void
  closeModal: () => void
  isOpen: boolean
}
```

Created at the session route level. `openModal` sets content state, `closeModal` nulls it. Single-modal constraint: calling `openModal` while one is open replaces it (no stacking).

#### [MODIFY] [index.tsx](file:///d:/liteai/packages/cli/src/tui/routes/session/index.tsx)

- Wrap session content with `ModalPaneProvider`
- Wire `modalContent` state → `SessionLayout.modal` prop
- Create `modalScrollRef` for tabs/scrollable content

#### [MODIFY] [session-layout.tsx](file:///d:/liteai/packages/cli/src/tui/components/session-layout.tsx)

- No structural changes needed — the `modal` slot and `ModalContext` already exist
- Minor: ensure `ModalContext.rows/columns` are correctly computed

---

### Phase 2b: Dialog Component Refactoring (Simple Pickers)

Each dialog component gets an `onClose` prop, replacing internal `dialog.pop()/clear()` calls.

#### [MODIFY] [dialog-select.tsx](file:///d:/liteai/packages/cli/src/tui/ui/dialog-select.tsx)

- Add `onClose?: () => void` prop
- ESC handler: call `onClose` if provided, fall through to `dialog.clear()` only as legacy fallback
- This is the single most impactful change — most simple dialogs delegate ESC handling here

#### [MODIFY] [dialog.tsx](file:///d:/liteai/packages/cli/src/tui/ui/dialog.tsx)

- Add `onClose?: () => void` prop (distinct from `onCancel` which is already there)
- ESC handler: prefer `onClose` → `onCancel` → legacy fallback

#### Simple picker dialogs (minimal changes — add `onClose` prop, remove `useDialog`):

- [MODIFY] [dialog-effort.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-effort.tsx) — wraps `DialogSelect`
- [MODIFY] [dialog-theme.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-theme.tsx) — wraps `DialogSelect`
- [MODIFY] [dialog-output-style.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-output-style.tsx) — wraps `DialogSelect`
- [MODIFY] [dialog-doctor.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-doctor.tsx) — wraps `DialogSelect`
- [MODIFY] [dialog-permissions.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-permissions.tsx) — wraps `DialogSelect`
- [MODIFY] [dialog-context.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-context.tsx) — wraps `Dialog`

---

### Phase 2c: Complex Dialog Refactoring (Sub-navigation)

These dialogs use `dialog.push/replace` internally for multi-step flows. Refactored to use local `useState` for internal view management.

#### [MODIFY] [dialog-model.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-model.tsx)

- Add `onClose` prop
- Replace `dialog.clear()` → `onClose()`
- Replace `dialog.replace(() => <DialogProvider />)` → internal `setView(<ProviderFlow />)` or call a provided `onSwitchToProvider` callback

#### [MODIFY] [dialog-provider.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-provider.tsx)

Heavy refactor — this component uses `dialog.replace()` **11 times** for auth flow navigation:

- Convert to a state-machine pattern with internal `useState<ProviderView>`
- View variants: `'list'` | `'auth-method'` | `'api-key'` | `'oauth-runner'` | `'code-method'` | `'auto-method'` | `'model-select'`
- Each sub-component (`ApiMethod`, `CodeMethod`, `AutoMethod`, `MethodRunner`) becomes a view variant rendered via switch
- `onClose` prop for the outer close action

#### [MODIFY] [dialog-mcp.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-mcp.tsx)

- Add `onClose` prop
- `McpDetail` sub-dialog: rendered via local view state instead of `dialog.push`
- `McpToolsList` sub-dialog: rendered via local view state from `McpDetail`

#### [MODIFY] [dialog-help-v2.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-help-v2.tsx)

- Add `onClose` prop
- Replace `dialog.clear()` → `onClose()`
- Remove `useDialog` import

#### [MODIFY] [dialog-diff.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-diff.tsx)

- Add `onClose` prop
- Replace `dialog.pop()` → `onClose()`

#### [MODIFY] [dialog-search.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-search.tsx)

- Add `onClose` prop  
- Replace `dialog.pop()` → `onClose()`

#### [MODIFY] [dialog-memory.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-memory.tsx)

- Add `onClose` prop
- Replace `dialog.pop()` / `dialog.clear()` → `onClose()`
- Remove `dialog.setSize()` call (sizing is handled by `ModalContext`)

#### [MODIFY] [dialog-stats.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-stats.tsx)

- Add `onClose` prop (stats uses `useInput` for ESC, not Dialog primitive)
- Remove `useDialog` import

#### Additional dialog components (same pattern — add `onClose`, remove `useDialog`):

- [dialog-agent-list.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-agent-list.tsx)
- [dialog-session-list.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-session-list.tsx)
- [dialog-rewind.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-rewind.tsx)
- [dialog-feedback.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-feedback.tsx)
- [dialog-status.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-status.tsx)
- [dialog-plugin.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-plugin.tsx)
- [dialog-skill.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-skill.tsx)
- [dialog-manage-models.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-manage-models.tsx)
- [dialog-tag.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-tag.tsx)
- [dialog-workspace.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-workspace.tsx)
- [dialog-session-rename.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-session-rename.tsx)
- [thinking-toggle.tsx](file:///d:/liteai/packages/cli/src/tui/components/thinking-toggle.tsx)

---

### Phase 3: Command Dispatch Rewiring

#### [MODIFY] [prompt-input.tsx](file:///d:/liteai/packages/cli/src/tui/components/prompt/prompt-input.tsx)

The central orchestrator. Every `dialog.push(() => <DialogX />)` call in `tuiInterceptors` becomes `modalPane.openModal(<DialogX onClose={modalPane.closeModal} />)`:

```tsx
// Before:
dialog.push(() => <DialogModel />)

// After:
modalPane.openModal(<DialogModel onClose={modalPane.closeModal} />)
```

This is ~20 interceptor entries to update. The `useDialog()` import is replaced by `useModalPane()`.

#### [MODIFY] [dialog-settings.tsx](file:///d:/liteai/packages/cli/src/tui/components/dialog-settings.tsx)

- Settings hub replaces all `dialog.push(...)` calls with `modalPane.openModal(...)` 
- Each sub-dialog receives `onClose={modalPane.closeModal}` instead of relying on stack pop

#### [MODIFY] [provider-setup-banner.tsx](file:///d:/liteai/packages/cli/src/tui/components/provider-setup-banner.tsx)

- Replace `dialog.push(() => <DialogProvider />)` with `modalPane.openModal(...)` when on session route
- For home route usage: either introduce a minimal modal slot in `HomeRoute` or keep dialog for this single case (deferred decision)

---

### Phase 4: Legacy Cleanup

#### [DELETE] [dialog.tsx](file:///d:/liteai/packages/cli/src/tui/context/dialog.tsx)

Remove the `DialogContext`, `useDialog`, and the `push/pop/clear/replace/setSize` API entirely.

#### [MODIFY] [app.tsx](file:///d:/liteai/packages/cli/src/tui/app.tsx)

- Remove `<DialogProvider>` from the provider tree (lines 109, 117)
- Remove import

#### [MODIFY] [session-layout.tsx](file:///d:/liteai/packages/cli/src/tui/components/session-layout.tsx)

- Remove the floating overlay rendering logic that reads from `DialogContext`
- The bottom-anchored `modal` slot remains as the sole rendering path

---

## Open Questions

> [!IMPORTANT]  
> **Home Route Dialog**: `ProviderSetupBanner` uses `dialog.push()` on the Home route, which doesn't have `SessionLayout`. Should we:
> 1. Add a minimal modal slot to `HomeRoute` layout
> 2. Keep `DialogProvider` alive **only** for the home route (violates the "remove entirely" goal)
> 3. Inline the provider flow directly in the banner component
>
> **Recommendation**: Option 1 — it's a small addition and ensures full parity.

> [!NOTE]  
> **Execution Order**: The implementation is ordered to avoid regressions. Both systems (old `dialog.push` and new `modalPane.openModal`) can coexist during migration. Each command is migrated individually and tested before moving to the next. The legacy `DialogProvider` is only removed after ALL consumers are migrated.

---

## Verification Plan

### Automated Tests
```bash
bun typecheck 2>&1 | Out-String
bun lint:fix
```

### Manual Verification (per-command)
For each migrated slash command:
1. Type the slash command (e.g., `/models`, `/effort`)
2. Verify the modal pane appears bottom-anchored with `▔` divider
3. Press ESC — modal closes, focus returns to prompt
4. Verify no stale overlay remains
5. Verify conversation transcript remains visible above the modal
6. Test rapid open/close cycles for focus stability
