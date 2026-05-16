# Design Decisions Record

> **Consolidated from**: `tui-architecture/03-pushback.md` + `settings-ui-overhaul/03-design-proposal.md`

---

## Decision 1: Composition Over Inheritance

### Question
> Should we create a central class and define a design pattern/interfaces for all components?

### Decision
**Yes to shared primitives. No to a central class.**

### Rationale

React's composition model was explicitly designed to replace inheritance-based component sharing. In a React + Ink codebase, a class-based approach maps to either:

- **Abstract base component** (`class DialogScreen extends Component`) — anti-pattern in modern React
- **Higher-order component** (`withDialog(MyScreen)`) — deprecated in favor of hooks
- **Render-prop wrapper** (`<DialogScreen render={(ctx) => ...} />`) — verbose, hard to test

**What actually works** (evidence from both reference codebases): hooks + composition.

```tsx
// ❌ Central class approach
class SettingsScreen extends DialogScreen {
  getKeybindings() { return { ... } }
  getOptions() { return [...] }
  render() { ... }
}

// ✓ Composition approach
function SettingsDialog({ onClose }) {
  useDialogLifecycle(onClose)
  const selected = useSelectList(items)
  return (
    <DialogPane title="Settings">
      <SelectList ... />
    </DialogPane>
  )
}
```

Neither Gemini CLI nor Claude Code has a `ScreenManager`, `DialogBase`, or generic `NavigablePane`.

---

## Decision 2: Protocol Over Framework

### Question
> Should we build a framework that manages screens?

### Decision
**Build a protocol (rules enforced by shared hooks), not a framework.**

### Rationale

A framework tells components WHAT to render. A protocol tells them HOW to register their inputs. The protocol is:

> "When you mount, you declare your keybinding context. When your context is active, only your handlers fire. When you unmount, your context is removed."

We already have this (`useRegisterKeybindingContext` + `useKeybindings`). The problem is enforcement, not architecture.

**A `ScreenManager` god object creates problems:**
1. Every new screen requires registration — friction
2. All screens must conform to one interface — but our screens have wildly different needs
3. State flows through the manager — makes testing impossible without mocking
4. The manager becomes the bottleneck — every bug requires understanding its state machine

---

## Decision 3: Modal Architecture — Hybrid Approach

### Question
> Option A (Hoist dialog state to AppContent) vs Option B (Fix existing ModalPaneProvider) vs Hybrid?

### Decision
**Hybrid: Keep ModalPaneProvider with stack semantics + centralize focus management.**

### Rationale

| Criterion | Option A (Hoist) | Option B (Fix) | Hybrid |
|-----------|-----------------|----------------|--------|
| Fixes BlankSession | ✅ Structurally | ✅ Adding layout | ✅ |
| Fixes useInput conflict | ✅ Structurally | ⚠️ By filtering | ✅ Structural focus arbiter |
| Code churn | 🔴 High | 🟢 Low | 🟡 Medium |
| Future extensibility | 🟡 Need state slot per dialog | ✅ Dynamic stack | ✅ Stack + arbiter |
| Matches reference CLIs | ✅ Gemini pattern | ⚠️ Unique to LiteAI | ✅ Best of both |

**Key insight**: The problem isn't the modal system — it's the focus fragmentation. Keep the modal system but add a focus arbiter at AppContent level.

---

## Decision 4: ViewState for Multi-Step Flows

### Question
> ViewState machine (local state) vs ModalPane stack (push/pop) for sub-navigation within a dialog?

### Decision
**ViewState for multi-step flows within a single dialog. Modal stack for top-level dialog switching.**

### Rationale

The ViewState machine is simpler, more debuggable, and more testable:

```typescript
const [viewState, setViewState] = useState<ViewState>({ type: "list" })
// switch(viewState.type) { ... }
```

**Pros**: Simple, debuggable, testable. State is a single discriminated union.
**Cons**: All views must be defined in one component file (or imported).

The modal stack is the right tool for **"which dialog is showing?"**. The ViewState machine is the right tool for **"which step of this dialog am I on?"**

This matches both Gemini CLI and Claude Code:
- Gemini CLI: Each dialog is a single component with internal state machine
- Claude Code: Same — `focusedInputDialog` picks the top-level dialog, internal navigation is local state

---

## Decision 5: Message Trail Pattern

### Question
> How should user-initiated actions (model change, provider connect) be recorded?

### Decision
**Record as messages in the scrollable area after dialog closes.**

### Rationale

Both Gemini CLI and Claude Code follow this pattern:
1. User triggers action → dialog appears
2. User makes selection → dialog closes
3. **Selection recorded as a message** in the scrollable area

This creates an audit trail. Scrolling through a conversation shows when models changed, providers were configured, etc.

```
  /model → gemini-2.5-pro                  ← recorded in messages
```

---

## Decision 6: Input Ownership Protocol

### Rules (Locked)

1. **No raw `useInput` in dialog components** — use `useKeybindings` with context
2. **Focus gating** — every input hook checks `isFocused` or `isActive`
3. **Context priority chain** — most specific context wins

### Exceptions (Documented)
- `base-text-input.tsx` — Character-level input that doesn't map to named actions
- `keybinding-setup.tsx` — The interceptor that routes keys to the context system
- `scroll-handler.tsx` — Low-level scroll events
- `prompt-input.tsx` — Main prompt input, character-level

---

## Decision 7: Rendering Slot Assignment

| Trigger | Slot | Reason |
|---------|------|--------|
| User types `/model` | **BOTTOM** (replaces prompt) | User-initiated, ephemeral |
| AI asks a question | **SCROLLABLE** (overlay) | System-initiated, needs transcript context |
| AI requests permission | **SCROLLABLE** (overlay) | System-initiated, needs to see the command |
| Spinner / streaming | **SCROLLABLE** (bottom of scroll) | Auto-scrolls with content |
| Todo tray | **BOTTOM** (above prompt) | Persistent informational widget |
| Plan review | **SCROLLABLE** (bordered box) | Part of conversation flow |
| Shell output | **SCROLLABLE** (bordered box) | Part of conversation history |

---

## Decision 8: Single Rendering Path (No BlankSession Split)

### Question
> Do we need a separate `BlankSession` component for the boot state (no session yet)?

### Decision
**No. Eliminate `BlankSession`. Use `SessionRoute` for all states.**

### Rationale

The `BlankSession` / `SessionRoute` split was an artifact of the old `HomeRoute` architecture. After `HomeRoute` was removed, `BlankSession` survived as a simplified entry point but introduced:

1. **Duplicated modal rendering** — 30 lines of manually reimplemented absolute-positioned pane logic
2. **Divergent focus management** — keybinding contexts, overlay rendering, and input gating work differently in the two paths
3. **Two `PromptInput` mount points** — same component, different container hierarchies

Both Gemini CLI and Claude Code use a single rendering path. When there's no history, the message area is empty but the layout/modal/focus infrastructure is identical.

**After elimination**: `SessionRoute` accepts `sessionID: string | undefined`. When undefined and `messages.length === 0`, it renders Logo + Tips in the scrollable area. Session is created lazily on first submit (already works via `SessionProvider.ensureSession()`).

**Lines removed**: ~117 (BlankSession, BlankSessionContent, manual modal pane, conditional branch).

---

## Decision 9: Provider Minimalism

### Question
> The `App` component nests 15 wrappers. Should we reduce this?

### Decision
**Yes. Collapse from 15 → ~10 wrappers by merging trivially thin providers.**

### Rationale

Several providers are wrappers over a single `useState`, `useRef`, or static readonly value:
- `ArgsProvider` — static CLI args, set once
- `TuiConfigProvider` — static config, set once
- `ExitProvider` — a ref + callback
- `RouteProvider` — a single `useState<Route>`
- `PromptRefProvider` — a `useRef` (already avoids re-renders)

**Merge groups:**
1. `ExitProvider` + `TuiConfigProvider` + `ArgsProvider` → `AppConfigProvider` (static data)
2. `GlobalExitHandler` → fold into `KeybindingSetup` (component logic, not a provider)
3. `RouteProvider` → fold into `AppStateProvider` (route is just state)
4. `PromptRefProvider` → module-level ref export (no context needed)

**Constraint**: All existing `useXxx()` hook APIs must be preserved — consumers don't change. This is a readability refactor, not a behavioral change.
