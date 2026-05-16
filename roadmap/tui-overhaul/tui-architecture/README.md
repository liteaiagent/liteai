# TUI Architecture Redesign — Design Discussion

> **Status**: Draft / Open Discussion  
> **Scope**: `@liteai/cli` — Terminal User Interface layer  
> **References**: [Gemini CLI](D:\gemini-cli), [Claude Code](D:\claude-code)

---

## The Question

> Should we create a central class and define a design pattern/interfaces for all components?
> Should we define a systematic way for each screen to define its options, keys, text?
> Create standard components and test them so fixes propagate everywhere?

This doc evaluates that question honestly, with pushback where the evidence warrants it.

---

## Executive Summary

**TL;DR: Yes to shared primitives. No to a central class.**

Neither Gemini CLI nor Claude Code has a centralized "Screen" framework, a `ScreenManager` class, or a generic `NavigableDialog` base. Both codebases converged independently on the **same solution**: a small set of battle-tested primitive components + a focus/input ownership protocol.

The right investment is NOT an abstraction layer that manages screens — it's a **protocol** (rules enforced by shared hooks) and a **component library** (3-4 standard building blocks that every dialog composes from).

See sub-documents for details:

| Document | Purpose |
|----------|---------|
| [01-current-problems.md](./01-current-problems.md) | What's actually broken and why |
| [02-reference-comparison.md](./02-reference-comparison.md) | What Gemini CLI and Claude Code actually built |
| [03-pushback.md](./03-pushback.md) | Why a central Screen class is the wrong abstraction |
| [04-proposed-primitives.md](./04-proposed-primitives.md) | The standard components and hooks to build |
| [05-input-ownership.md](./05-input-ownership.md) | The focus/keybinding protocol |
| [06-slot-architecture.md](./06-slot-architecture.md) | Where things render and why |
| [07-provider-flow.md](./07-provider-flow.md) | Multi-step provider auth — the hardest case |
| [08-ui-visual-design.md](./08-ui-visual-design.md) | Screen-by-screen visual blueprints for every TUI screen |

---

## Key Design Positions

### 1. Composition > Inheritance (Pushback)

The user proposed a "central class with interfaces." In a React + Ink codebase, this maps to either:
- **A)** An abstract base component (`class DialogScreen extends Component`) — anti-pattern in modern React
- **B)** A higher-order component (`withDialog(MyScreen)`) — largely deprecated in favor of hooks
- **C)** A render-prop wrapper (`<DialogScreen render={(ctx) => ...} />`) — verbose, hard to test

**What actually works** (evidence from both reference codebases): hooks + composition.

```tsx
// ❌ Central class approach
class SettingsScreen extends DialogScreen {
  getKeybindings() { return { ... } }
  getOptions() { return [...] }
  render() { ... }
}

// ✓ Composition approach (what Gemini CLI + Claude Code actually do)
function SettingsDialog({ onClose }) {
  useDialogLifecycle(onClose)          // shared hook: registers Esc, focus gate
  const selected = useSelectList(items) // shared hook: up/down/enter/number navigation
  return (
    <DialogPane title="Settings">       {/* shared component: border, title, footer */}
      <SelectList ... />                {/* shared component: renders items */}
    </DialogPane>
  )
}
```

### 2. Protocol > Framework

A framework tells components WHAT to render. A protocol tells them HOW to register their inputs. We need the latter.

The protocol is: **"When you mount, you declare your keybinding context. When your context is active, only your handlers fire. When you unmount, your context is removed."**

We already have this! (`useRegisterKeybindingContext` + `useKeybindings`). The problem is that components don't use it consistently, and raw `useInput` calls bypass it entirely.

### 3. Fix What's Broken, Then Standardize

The immediate bugs have simple causes (see [01-current-problems.md](./01-current-problems.md)). A framework won't fix them faster than direct fixes. But investing in standard primitives AFTER fixing the bugs means future dialogs get correctness for free.

---

## Decision Matrix

| Approach | Fixes current bugs? | Prevents future bugs? | Effort | Risk |
|----------|---------------------|----------------------|--------|------|
| Targeted fixes only | ✓ | ✗ | Low (days) | Low |
| Central class + framework | ✓ | Partially | Very high (weeks) | High — fights React model |
| **Standard primitives + protocol** | ✓ | **✓** | **Medium (1 week)** | **Low — additive, not destructive** |
