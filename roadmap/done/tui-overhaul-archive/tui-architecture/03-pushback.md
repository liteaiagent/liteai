# 03 — Pushback: Why a Central Class is the Wrong Abstraction

## The Proposal Under Review

> "Should we create a central class and define a design pattern/interfaces for all components to use?"

This document argues: **the goal is right, but "central class" is the wrong mechanism** for a React + Ink codebase. Here's why.

---

## Argument 1: React's Model Actively Fights Class Hierarchies

React's composition model was explicitly designed to replace inheritance-based component sharing. The React team deprecated class component patterns (mixins, HOCs, render props) in favor of hooks precisely because:

- **Hooks compose horizontally**: `useSelectList()` + `useDialogLifecycle()` = a dialog with selection. No class needed.
- **Classes compose vertically**: `class ModelDialog extends DialogScreen` forces a single inheritance chain. What if a dialog needs both selection AND text input? Multiple inheritance doesn't exist in JS/TS.

Ink (our rendering layer) is optimized for functional components with hooks. A class-based Screen abstraction would fight the framework at every turn.

### Evidence From Reference Codebases

Both Gemini CLI (Google) and Claude Code (Anthropic) are large, production React + Ink codebases. **Neither has a base Screen class.** Not because they didn't think of it — but because they tried hooks and found they compose better.

---

## Argument 2: The "Central Manager" Anti-Pattern in TUI

A `ScreenManager` that orchestrates screens creates a **god object**:

```typescript
// ❌ What a central manager looks like
class ScreenManager {
  screens: Map<string, ScreenConfig>
  activeStack: ScreenConfig[]
  
  registerScreen(config: ScreenConfig): void
  pushScreen(id: string, params: any): void
  popScreen(): void
  getActiveKeybindings(): Map<string, Handler>
  getFocusedScreen(): ScreenConfig
  render(): ReactNode
}
```

Problems:
1. **Every new screen requires registration** — friction for development
2. **All screens must conform to one interface** — but our screens have wildly different needs (some have text input, some have multi-select, some have tabs, some have none of these)
3. **State flows through the manager** — makes testing individual screens impossible without mocking the manager
4. **The manager becomes the bottleneck** — every UI bug requires understanding the manager's state machine

### What Actually Works: Decentralized Ownership

```typescript
// ✓ Each dialog owns its lifecycle
function ModelDialog({ onClose }) {
  // Standard hook: registers Esc, sets focus context, cleans up on unmount
  useDialogLifecycle("ModelDialog", onClose)
  
  // Standard hook: up/down/enter navigation
  const { selected, items } = useSelectList(modelOptions)
  
  // Dialog-specific logic
  return <DialogPane title="Select Model">
    <SelectList items={items} selected={selected} />
  </DialogPane>
}
```

No central manager needed. The hooks ARE the shared behavior. Testing is trivial — mount the component, simulate key presses, assert behavior.

---

## Argument 3: "Interfaces for All Components" — The Right Instinct, Wrong Mechanism

The user's instinct is correct: **we need shared contracts**. But in React, contracts are expressed through:

| Mechanism | Purpose | Example |
|-----------|---------|---------|
| **Hook API** | Shared behavior contract | `useSelectList(items, options): SelectListState` |
| **Component props** | Shared rendering contract | `<SelectList items={} onSelect={} isFocused={} />` |
| **Context** | Shared state contract | `useModalPane(): { isOpen, openModal, closeModal }` |
| **TypeScript types** | Compile-time enforcement | `type DialogSelectOption<T>` |

These are already "interfaces for all components." A class hierarchy adds indirection without adding capability.

---

## Where I Agree With the User

The user is **absolutely right** about:

1. **"When we fix an issue it should be fixed in all"** — Yes. This is achieved by shared hooks, not a base class. If `useDialogLifecycle` handles Esc correctly, every dialog using it gets the fix.

2. **"Define a systematic way for each screen to define its options, keys, text"** — Yes. This is achieved by a standard `SelectList` component + `useSelectList` hook. See [04-proposed-primitives.md](./04-proposed-primitives.md).

3. **"Standard components with tests for stability"** — Yes, absolutely. Test the hook, test the component, and every consumer gets correctness for free. This is the highest-ROI investment.

4. **"We can scale and roll out new features faster"** — Correct. With `useDialogLifecycle` + `SelectList` + `DialogPane`, a new slash command dialog goes from ~150 lines of boilerplate to ~30 lines of business logic.

---

## The Proposed Middle Ground

Instead of a central class, invest in **4 standard primitives + 1 protocol**:

| Primitive | Type | Purpose | Test Coverage |
|-----------|------|---------|---------------|
| `useSelectList` | Hook | Headless selection state machine | Unit test: navigation, wrapping, disabled items |
| `SelectList` | Component | Renders selection list with chrome | Snapshot + interaction test |
| `useDialogLifecycle` | Hook | Esc handler, focus context, cleanup | Unit test: mount/unmount/Esc |
| `DialogPane` | Component | Standard dialog wrapper | Snapshot test |

| Protocol | Enforcement |
|----------|------------|
| No raw `useInput` in dialogs | Lint rule or code review gate |
| All dialogs use `useDialogLifecycle` | Convention + test helper |
| All selection lists use `useSelectList` | Convention |
See [04-proposed-primitives.md](./04-proposed-primitives.md) for API designs.
