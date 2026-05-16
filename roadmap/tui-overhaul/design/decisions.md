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

---

## Decision 10: Zero-Branching Architecture

### Question
> Should we have separate components for boot state (no session) vs active state (session running)?

### Decision
**No. Single `SessionRoute` handles all states. No `BlankSession`, no `BootLayout`, no component-level branching.**

### Rationale

Both Claude Code and Gemini CLI use a single rendering path — when there's no history, the message area is empty but the layout is the same. LiteAI's `BlankSession` duplicated 120 lines of modal rendering logic, creating a parallel code path for focus management.

The boot state is `SessionRoute` with `sessionID: undefined` and `messages.length === 0`. Data-level guards (selectors return `EMPTY_*` constants), not component-level branches. The `sessionID` cascade is minimal: 5 files need type widening, 0 changes to message/tool rendering.

---

## Decision 11: Onboarding — Claude Code Style (Non-Blocking)

### Question
> How should we handle fresh installation / no provider configured?

### Decision
**Non-blocking hint in StatusLine: `"No provider · Run /provider"`. No blocking wizard.**

### Rationale

Analyzed both reference CLIs:
- **Claude Code**: Shows `Not logged in · Run /login` in the status line. On submit, shows inline error. User can explore the TUI freely.
- **Gemini CLI**: Shows a mandatory `Get Started` dialog (blocking).

Claude Code's simplicity is preferable — it doesn't block exploration, and LiteAI already has submit-time validation (`"No model selected. Use /models to configure a provider and model."` toast). A dedicated onboarding wizard can be added in a later phase if needed.

---

## Decision 12: Session ID Removed from StatusLine

### Question
> Should the StatusLine show the session ID?

### Decision
**No. Remove the session ID segment entirely.**

### Rationale

Session ID is internal noise with no user value during interaction. It's only useful when resuming a session later, which is served by the exit summary resume command. Removing it frees status line space for more useful information (model, context %, cost).

---

## Decision 13: Exit Summary — Gemini CLI Style

### Question
> What should happen when the user exits?

### Decision
**Render a Gemini CLI-style interaction summary to stdout after Ink unmounts.**

### Rationale

Analyzed both reference CLIs:
- **Gemini CLI**: Rich `Interaction Summary` box with Session ID, Tool Calls, Performance stats, Resume command.
- **Claude Code**: Minimal — just `Resume this session with: claude --resume <id>`.

Gemini's richer summary provides immediate value to the user (cost awareness, session metrics). The resume command in both CLIs is essential. This requires capturing stats before unmount and writing to stdout in the cleanup handler.

---

## Decision 14: Focus Prop — Required, No Backward Compatibility

### Question
> Should `PromptInput.focus` be optional with a fallback to internal modal state checks?

### Decision
**No. `focus: boolean` is required. All callers must pass it. No fallback, no shim.**

### Rationale

Per Rule 0 (Zero Backward Compatibility): this is a new major release. An optional `focus` prop with `?? !modalPane.isOpen` fallback is a backward compatibility shim. Clean break: parent owns focus derivation, child receives explicit `focus: boolean`.
