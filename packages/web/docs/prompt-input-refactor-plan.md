# Plan: Refactor Web PromptInput → UI Package

> [!IMPORTANT]
> Goal: Make the UI `ChatPromptInput` match the web's `PromptInput` **exactly** — same layout, same editor behaviors, same features — with web-specific logic abstracted behind the existing controller pattern.

---

## Current State

| | Web `PromptInput` | UI `ChatPromptInput` |
|---|---|---|
| File | [prompt-input.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/web/src/components/prompt-input.tsx) | [chat-prompt-input.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/panes/chat/chat-prompt-input.tsx) |
| Lines | 1559 | 735 |
| Layout | Shell on top, Tray below (siblings) | Tray wraps Shell (nested) |
| Editor | Full reconciler, pills, IME, parseFromDOM | Simplified text-only |
| Web dep | Uses 10+ web contexts directly | Uses controllers |

**After refactoring:** Web's `PromptInput` will import and wrap the UI component, passing web contexts through the controller/props interface. One source of truth.

---

## Phase 1: Extend Controller Interfaces

> Add missing capabilities to the existing controller interfaces so the UI component can access everything it needs without web-specific imports.

### 1a. Extend `ChatController` ([chat-controller.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/panes/controllers/chat-controller.ts))

Add:
```typescript
interface ChatController {
  // ... existing ...

  /** Custom slash commands (from .liteai/commands/ or MCP). */
  commands(): SlashCommandInfo[]

  /** Whether there are any paid providers configured. */
  hasPaidProviders(): boolean
}
```

### 1b. New `PermissionController` interface

Create [permission-controller.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/panes/controllers/permission-controller.ts):
```typescript
export interface PermissionController {
  /** Whether auto-accept (YOLO) is active for this session/directory. */
  isAutoAccepting(sessionID: string | undefined): boolean
  /** Toggle auto-accept. */
  toggle(sessionID: string | undefined): void
}
```

Add to `ChatContextValue` and `ChatContextProvider`.

### 1c. Extend `ChatPromptInputProps`

Add these props to the UI component (all optional, gracefully degraded when absent):
```typescript
interface ChatPromptInputProps {
  // ... existing ...

  /** Command palette integration. When omitted, no commands registered. */
  commands?: {
    register: (key: string, cb: () => CommandOption[]) => void
    keybind: (id: string) => string
    trigger: (id: string, source?: string) => void
    options: CommandOption[]
  }

  /** Comment system. When omitted, comment features disabled. */
  commentActions?: PromptCommentActions

  /** Callback when context item comment is opened. */
  onOpenComment?: (item: { path: string; commentID?: string; commentOrigin?: string }) => void

  /** New session worktree selection. */
  newSessionWorktree?: string
  onNewSessionWorktreeReset?: () => void

  /** Edit mode (re-edit a previous message). */
  edit?: { id: string; prompt: Prompt; context: ContextItem[] }
  onEditLoaded?: () => void

  /** Queue mode for follow-up prompts while session is busy. */
  shouldQueue?: () => boolean
  onQueue?: (draft: unknown) => void
  onAbort?: () => void
}
```

---

## Phase 2: Extract Portable Editor Logic

> Move editor internals that the current UI version is MISSING into the shared `prompt-input/` sub-directory that already exists.

### 2a. New file: `prompt-input/editor-reconciler.ts`

Extract from web's `PromptInput` (lines 626-858):
- `createPill(part)` — creates non-editable `<span>` elements for @file/@agent
- `isNormalizedEditor()` — checks if DOM is clean
- `renderEditor(parts)` — one-way render: Prompt[] → DOM
- `parseFromDOM(editorRef)` — reverse: DOM → Prompt[]
- `reconcile(input, editorRef, mirror)` — bidirectional sync guard

These are **pure DOM functions** with zero framework or web deps.

### 2b. New file: `prompt-input/ime-handler.ts`

Extract from web's `PromptInput` (lines 494-512):
- `createImeHandler()` — returns `{ composing, isImeComposing, handleCompositionStart, handleCompositionEnd }`

### 2c. New file: `prompt-input/add-part.ts`

Extract from web's `PromptInput` (lines 860-939):
- `addPartAtCursor(part, editorRef, prompt, options)` — inserts text/file/agent at cursor position, handles @query replacement

### 2d. Update existing `prompt-input/index.ts`

Re-export the new modules.

---

## Phase 3: Rewrite UI `ChatPromptInput`

> Replace the current 735-line simplified version with the full web version, using controller interfaces for all data access.

### 3a. Replace the render tree

Change from `DockTray > DockShellForm` (nested) to `DockShellForm` + `DockTray attach="top"` (siblings), matching web exactly.

### 3b. Port the full editor logic

Use the extracted modules from Phase 2:
```typescript
const { createPill, parseFromDOM, renderEditor, reconcile } = createEditorReconciler(editorRef)
const { composing, isImeComposing, ... } = createImeHandler()
```

### 3c. Port the full keydown handler

Include:
- `!` at position 0 → shell mode
- Escape cascading (popover → shell → abort → blur)
- Shell mode backspace-to-exit
- Shift+Enter before IME check
- `Ctrl+G` abort
- Full popover keyboard navigation (ArrowUp/Down/Enter/Tab/Ctrl+N/P)
- History navigation with `canNavigateHistoryAtCursor`

### 3d. Port the tray section

Include:
- Shell mode label with spring animation (`useSpring`)
- Agent selector via `selection.agent` (already available)
- Model selector via `ChatModelSelector` (already exists in UI)
- Variant selector via `selection.model.variant` (already available)
- YOLO/auto-accept button via new `PermissionController`
- Keybind tooltips (`TooltipKeybind`)

### 3e. Port the gradient overlay

Add the bottom gradient fade:
```css
background: linear-gradient(to top, var(--surface-raised-stronger-non-alpha) calc(100% - 20px), transparent)
```

### 3f. Data source mapping

| Web context call | UI controller equivalent |
|---|---|
| `sync.data.agent.filter(...)` | `controller.agents()` (already exists) |
| `sync.data.command` | `controller.commands()` (Phase 1a) |
| `sync.data.session_status[id]` | `controller.sessionStatus(id)` (already exists) |
| `sync.data.message[id]` | `controller.messages(id)` (already exists) |
| `sync.session.get(id)` | `controller.session.get(id)` (already exists) |
| `local.agent.current()` | `selection.agent.current()` (already exists) |
| `local.agent.list()` | `selection.agent.list()` (already exists) |
| `local.agent.set(name)` | `selection.agent.set(name)` (already exists) |
| `local.model.current()` | `selection.model.current()` (already exists) |
| `local.model.variant` | `selection.model.variant` (already exists) |
| `providers.paid()` | `controller.hasPaidProviders()` (Phase 1a) |
| `permission.isAutoAccepting()` | `permissionController.isAutoAccepting()` (Phase 1b) |
| `sdk.directory` | `controller.directory()` (already exists) |
| `Persist.global("prompt-history")` | `Persist.global("prompt-history")` (already in UI) |
| `useFilteredList()` | `useFilteredList()` (already in `@liteai/ui/hooks`) |
| `createPromptSubmit()` | `props.handler.submit()` / `props.handler.abort()` (already exists) |
| `ModelSelectorPopover` / `DialogSelectModelUnpaid` | `ChatModelSelector` (already in UI, with `onManageModels`/`onConnectProvider` callbacks) |
| `props.commands.register(...)` | `props.commands?.register(...)` (optional prop, Phase 1c) |
| `props.commentActions` | `props.commentActions` (optional prop, Phase 1c) |

---

## Phase 4: Wire Web to Use UI Component

> Replace web's 1559-line monolith with a thin wrapper.

### 4a. Create `packages/web/src/components/prompt-input-wrapper.tsx`

~100-150 lines that:
1. Reads web contexts (`useSDK`, `useSync`, `useLocal`, `usePermission`, `useProviders`)
2. Creates `ChatPromptSubmitHandler` from `createPromptSubmit()`
3. Builds the `commands` prop from `useCommand()`
4. Builds the `commentActions` prop from the comment hooks
5. Renders `<ChatPromptInput>` from `@liteai/ui` with all props wired

### 4b. Update `session-composer-region.tsx`

Change import from `@/components/prompt-input` to `@/components/prompt-input-wrapper`.

### 4c. Delete/archive the old monolith

Remove `packages/web/src/components/prompt-input.tsx` once verified.

### 4d. Delete duplicate sub-modules

Web's `prompt-input/` folder files that are now imported from UI:
- `context-items.tsx`, `drag-overlay.tsx`, `image-attachments.tsx`, `slash-popover.tsx`
- `editor-dom.ts`, `files.ts`, `paste.ts`, `placeholder.ts`, `history.ts`, `attachments.ts`

Keep web-only:
- `submit.ts` / `build-request-parts.ts` (web submission logic)
- All test files

---

## Phase 5: Create Storybook Story

### 5a. Update [chat-prompt-input.stories.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/ui/src/panes/chat/chat-prompt-input.stories.tsx)

Create multiple story variants:

```typescript
export const Default = { ... }           // Empty state, normal mode
export const WithContent = { ... }       // Pre-filled editor text
export const ShellMode = { ... }         // Shell mode active
export const BusySession = { ... }       // Session running, shows stop button
export const WithContextItems = { ... }  // File mentions attached
export const WithImageAttachments = { ... } // Images pasted
export const WithYolo = { ... }          // Auto-accept enabled
```

### 5b. Mock controller

Extend the existing `StoryWrapper` mock to include:
- `commands()` → sample slash command list
- `hasPaidProviders()` → `true`
- `PermissionController` → togglable state

---

## Execution Order

| Step | Phase | Risk | Effort |
|------|-------|------|--------|
| 1 | Phase 1a: Extend `ChatController` | Low — additive | Small |
| 2 | Phase 1b: Add `PermissionController` | Low — additive | Small |
| 3 | Phase 2a-d: Extract editor modules | Medium — must not break existing UI | Medium |
| 4 | Phase 3: Rewrite `ChatPromptInput` | **High** — biggest change | Large |
| 5 | Phase 5: Storybook stories | Low | Small |
| 6 | Phase 4: Wire web wrapper | **High** — must validate exact parity | Medium |

> [!WARNING]
> Phase 3 (rewrite) is the riskiest step. I recommend doing it incrementally: first get the layout matching, then add the editor reconciler, then add shell mode, then add remaining features. Each increment can be verified in Storybook.

> [!TIP]
> Phase 4 (web wiring) should be done LAST because it requires verifying that the web app still works identically. The Storybook story from Phase 5 lets you validate visuals before touching the web app.

---

## What DOESN'T Move to UI

These stay in `packages/web` because they're fundamentally tied to web infrastructure:

1. **`submit.ts`** — Session/worktree creation, SDK API calls, optimistic updates, abort handling
2. **`build-request-parts.ts`** — Constructs SDK-specific request payloads
3. **`ModelSelectorPopover`** — Already replaced by `ChatModelSelector` in UI
4. **`DialogSelectModelUnpaid`** — Web-specific dialog chain
5. **Command palette registration** — Passed as optional prop
6. **Comment system** — Passed as optional prop
