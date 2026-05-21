# 01 — Current Problems: What's Actually Broken

## Problem Taxonomy

Every TUI bug we've encountered falls into one of **four categories**:

### Category 1: Missing Handlers (Cheapest to Fix)

Components that render UI hints (e.g., "press Esc to close") but never register the corresponding handler.

| Component | Symptom | Root Cause |
|-----------|---------|------------|
| `AutoMethod` in `dialog-provider.tsx` | Esc doesn't work | No `useKeybindings` call — renders text "esc" but has zero handlers |
| Several dialog sub-views | Esc closes wrong thing | Handler registered on parent, not current view |

**Cost to fix**: Minutes per instance. No architecture change needed.

### Category 2: Input Conflicts (Systemic — Needs Protocol)

Multiple components register `useInput` or `useKeybindings` simultaneously, and the wrong one wins.

| Scenario | Symptom | Root Cause |
|----------|---------|------------|
| Modal open + PromptInput mounted | Keystrokes go to prompt, not modal | PromptInput's `useInput` has no `isFocused` gate |
| `/` suggestions visible + up/down | Arrow keys don't navigate suggestions | PromptInput's own up/down handler fires first |
| Question tool + global keybindings | Tab key conflicts | Raw `useInput` bypasses keybinding context system |

**Cost to fix**: Requires enforcing the keybinding context protocol (see [05-input-ownership.md](./05-input-ownership.md)).

### Category 3: Layout Slot Misuse (Moderate — Needs Standard)

Components rendering in the wrong slot, causing visual overlap or clipping.

| Scenario | Symptom | Root Cause |
|----------|---------|------------|
| Modal pane overlaps prompt | Prompt visible behind modal, accepting input | Modal uses absolute positioning over the bottom slot |
| Auth URL wraps incorrectly | Spaces when copy-pasting | `<Text>` wraps long strings, terminal copy includes padding |

**Cost to fix**: Slot assignment change (Alternative A from implementation plan) + `wrap="truncate"`.

### Category 4: Missing Standard Components (Investment)

Each dialog reinvents selection/navigation/chrome. Bugs in one dialog don't get fixed in others.

| Pattern | Current State | Copies |
|---------|--------------|--------|
| Select list (up/down/enter) | `DialogSelect`, `PermissionPrompt` inline, `QuestionPrompt` inline, `Tabs`, `FuzzyPicker` | 5+ implementations |
| Dialog chrome (border, title, footer hints) | `ThemedBox`, `Pane`, inline `<Box>` wrappers | 3+ patterns |
| Esc-to-close lifecycle | Manual `useKeybindings` in each component | Every dialog |

**Cost to fix**: Build 3-4 shared components, migrate existing dialogs. This is the investment the user is asking about.

---

## The Honest Assessment

> **Category 1 + 3 are trivially fixable** — they don't need a framework.  
> **Category 2 is solvable with protocol enforcement** — not a new system, but stricter use of the existing one.  
> **Category 4 is the real investment** — shared components that encode correctness by default.

The user is RIGHT that Category 4 provides compounding returns. But a "central class" is the wrong abstraction for it. See [03-pushback.md](./03-pushback.md).

---

## Raw `useInput` Audit

These files bypass the keybinding system entirely with raw `useInput`. Each is a potential input conflict:

```
d:\liteai\packages\cli\src\tui\ui\fuzzy-picker.tsx
d:\liteai\packages\cli\src\tui\ui\dialog-select.tsx          ← inputFilter only
d:\liteai\packages\cli\src\tui\ui\dialog-export-options.tsx
d:\liteai\packages\cli\src\tui\ui\dialog-confirm.tsx
d:\liteai\packages\cli\src\tui\ui\dialog-alert.tsx
d:\liteai\packages\cli\src\tui\routes\session\question.tsx
d:\liteai\packages\cli\src\tui\components\dialog-session-list.tsx
d:\liteai\packages\cli\src\tui\components\prompt\prompt-input.tsx  ← BIGGEST offender
d:\liteai\packages\cli\src\tui\components\scroll-handler.tsx
d:\liteai\packages\cli\src\tui\components\feedback-survey.tsx
d:\liteai\packages\cli\src\tui\components\dialog-stats.tsx
d:\liteai\packages\cli\src\tui\components\dialog-plugin.tsx
d:\liteai\packages\cli\src\tui\components\dialog-rewind.tsx
d:\liteai\packages\cli\src\tui\components\dialog-feedback.tsx
d:\liteai\packages\cli\src\tui\components\design-system\Tabs.tsx
d:\liteai\packages\cli\src\tui\components\base-text-input.tsx
d:\liteai\packages\cli\src\tui\app.tsx
```

**17 files** with raw `useInput` — most should migrate to `useKeybindings` with proper context registration.
