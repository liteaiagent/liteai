# TUI Settings & Homepage Rewrite — Session Handoff

> **STATUS: SUPERSEDED** — The "hook-per-dialog" approach recommended here was evaluated
> and rejected. The **Hybrid approach** (keep ModalPaneProvider with stack semantics +
> extract primitives) was implemented instead. See
> [04-implementation-plan.md](file:///d:/liteai/roadmap/tui-overhaul/settings-ui-overhaul/04-implementation-plan.md)
> for the authoritative plan and
> [04-proposed-primitives.md](file:///d:/liteai/roadmap/tui-overhaul/tui-architecture/04-proposed-primitives.md)
> for the primitives specification. This document is retained for historical context only.

> **Context**: This document captures all findings from conversation `5d1cd26f` (2026-05-15).
> Use this as the starting prompt for the next session.

---

## What Happened

We spent this session auditing why `/models` and other slash commands are broken in the LiteAI TUI after removing the `HomeRoute` and refactoring settings. We studied Claude Code (`D:\claude-code`) and Gemini CLI (`D:\gemini-cli`) architectures in depth.

### Key Finding
The current LiteAI TUI has a **fundamentally flawed architecture** for dialogs/settings. Patching individual bugs (we fixed 3) won't help — the problems are structural:

1. **BlankSession (homepage) has no modal rendering slot** — modals store state but never render
2. **Multiple competing `useInput` hooks** — DialogSelect has both a TextInput AND keybindings processing the same keys
3. **Provider names flicker/disappear on scroll** — rendering bugs in the list component
4. **`/` slash suggestion arrows don't work** — input handling conflicts
5. **Copy is broken** — includes extra whitespace
6. **The whole thing looks bad** — not just bugs, the visual design is poor

### Decision Made
**Full rewrite of the settings UI and homepage**, using Claude Code / Gemini CLI rendering patterns as reference. NOT patching the current broken system.

---

## What Was Already Done (Revert or Keep)

Three patches were applied in this session. They are correct but may be irrelevant if doing a full rewrite:

| File | Change | Keep/Revert? |
|------|--------|-------------|
| `app.tsx` | Split `BlankSession` into wrapper + `BlankSessionContent`, added modal rendering slot | **Keep** — required by 04-implementation-plan.md Phase 1 (BlankSession modal slot) |
| `dialog-select.tsx` | Added `inputFilter` to block navigation keys from TextInput | **Keep** — this is a real bug fix regardless |
| `default-bindings.ts` | Removed `j`/`k` from Select context, added `pageup`/`pagedown`/`home`/`end` | **Keep** — correct improvement |

---

## Architecture Reference (Already Audited)

Full architecture analysis is in `d:\liteai\roadmap\settings-ui-overhaul\01-architecture-audit.md`.

### How Claude Code Does It
- **Source**: `D:\claude-code\src\commands\model\model.tsx`
- **Pattern**: Commands return JSX via `call(onDone, context)`. The REPL component owns a single `commandJsx` state slot. When set, it renders the JSX and disables the prompt. `onDone` clears it.
- **Model picker**: `<ModelPicker>` component with `useAppState` for model list, inline rendering in the REPL slot.
- **No separate routing or modal system** — just conditional rendering.

### How Gemini CLI Does It
- **Source**: `D:\gemini-cli\packages\cli\src\ui\`
- **Pattern**: `AppContainer.tsx` (2905 lines) owns all dialog state via hooks:
  ```
  useModelCommand() → { isModelDialogOpen, openModelDialog, closeModelDialog }
  useSettingsCommand() → { isSettingsDialogOpen, ... }
  useThemeCommand() → { isThemeDialogOpen, ... }
  ```
- **Slash command processor**: `useSlashCommandProcessor` hook returns action descriptors (`{ type: 'dialog', dialog: 'model' }`), which `AppContainer` maps to `openModelDialog()`.
- **Rendering**: `App.tsx` receives boolean flags as props, conditionally renders dialog components.
- **Focus**: Implicit — dialog components take focus when rendered, main input loses it.

### Key Files to Study in Next Session
```
D:\claude-code\src\commands\model\model.tsx          — Model picker JSX (297 lines)
D:\claude-code\src\commands.ts                        — Command registry pattern

D:\gemini-cli\packages\cli\src\ui\AppContainer.tsx    — Main orchestrator (2905 lines, lines 940-1060 for model/settings)
D:\gemini-cli\packages\cli\src\ui\hooks\useModelCommand.ts     — Dialog state hook (32 lines)
D:\gemini-cli\packages\cli\src\ui\hooks\slashCommandProcessor.ts — Command dispatch (764 lines)
D:\gemini-cli\packages\cli\src\ui\commands\modelCommand.ts     — Model command (2042 lines — shows how model picker renders)
```

---

## What to Build (Scope)

> [!NOTE]
> **Not implemented as described below.** The Hybrid approach was chosen instead:
> ModalPaneProvider was upgraded with stack semantics, and a new primitives layer
> (`useSelectList`, `useDialogLifecycle`, `SelectList`, `DialogPane`) was extracted.
> See [04-implementation-plan.md](./04-implementation-plan.md) for the authoritative plan.

### 1. ~~Remove Current Homepage (`BlankSession`)~~
**Not done.** BlankSession was kept and upgraded with a ModalPaneProvider wrapper + modal rendering slot (Phase 1 of 04-implementation-plan.md). The homepage works correctly.

### 2. ~~Rewrite Settings/Dialog System~~
**Not done as described.** Instead of replacing ModalPaneProvider with hook-per-dialog, ModalPaneProvider was upgraded to stack-based semantics (`openModal`/`pushModal`/`popModal`/`closeModal`). `DialogSelect` was replaced by `SelectPane` composing the new primitives layer.

~~**Recommended: Gemini CLI "hook-per-dialog" pattern**~~
- ~~Each dialog gets a `useXxxCommand()` hook returning `{ isOpen, open, close }`~~
- ~~All hooks live in the main app component (or a dedicated `useDialogManager`)~~
- ~~Slash commands return action descriptors, main component maps to dialog openers~~
- ~~Dialogs are conditionally rendered — no context, no providers, no stack~~

**Why not Claude Code's pattern**: Claude Code's `local-jsx` return-JSX-from-command approach requires the REPL to own the rendering slot. That's essentially what our `ModalPaneProvider` tried to do (and failed). Gemini's approach is simpler — just boolean flags.

### 3. Fix the Slash Command Suggestion UI
When typing `/`, the up/down arrow suggestion picker needs to work. Currently broken because of input handling conflicts. Study how Gemini CLI handles this in their `InputPrompt` component.

### 4. Visual Polish
The current rendering is visually poor. Study Gemini CLI's component library:
- `D:\gemini-cli\packages\cli\src\ui\components\` — all their UI components
- `D:\gemini-cli\packages\cli\src\ui\themes\` — their theme system
- `D:\gemini-cli\packages\cli\src\ui\layouts\` — layout components

---

## Current LiteAI TUI File Map

Key files that need rewriting or heavy modification:

```
packages/cli/src/tui/
├── app.tsx                           ← REWRITE (BlankSession, AppContent)
├── context/modal-pane.tsx            ← KEPT — upgraded with stack semantics (push/pop)
├── hooks/use-navigation.ts           ← KEPT — rewired to stack push/pop
├── components/
│   ├── prompt/prompt-input.tsx       ← MODIFY (remove tuiInterceptors, add onSlashCommand callback)
│   ├── session-layout.tsx            ← KEEP (modal slot can stay for session-level use)
│   ├── dialog-config.tsx             ← REWRITE (new rendering pattern)
│   ├── dialog-model.tsx              ← REWRITE (new rendering pattern)
│   ├── dialog-manage-models.tsx      ← REWRITE
│   └── dialog-mcp.tsx               ← REWRITE
├── ui/
│   ├── dialog-select.tsx             ← REWRITE (fix input conflicts, visual polish)
│   ├── tabs.tsx                      ← KEEP or REWRITE depending on visual goals
│   └── fuzzy-picker.tsx              ← KEEP (utility)
├── routes/session/index.tsx          ← MODIFY (wire new dialog system)
└── keybindings/default-bindings.ts   ← ALREADY FIXED (j/k removed from Select)
```

---

## Prompt for Next Session

Copy-paste this to start the next session:

---

**I want to rewrite the LiteAI TUI settings and homepage UI. This is a follow-up from a previous session that audited the architecture.**

**Read these documents first:**
- `d:\liteai\roadmap\settings-ui-overhaul\HANDOFF.md` — full context from last session
- `d:\liteai\roadmap\settings-ui-overhaul\01-architecture-audit.md` — Claude Code vs Gemini CLI vs LiteAI comparison

**Reference codebases:**
- `D:\claude-code` — Claude Code's TUI (model picker in `src/commands/model/model.tsx`)
- `D:\gemini-cli` — Gemini CLI's TUI (settings in `packages/cli/src/ui/`)

**Goals:**
1. Remove the current `BlankSession` homepage — boot directly to a clean prompt (like Gemini CLI)
2. Rewrite the settings/dialog system using Gemini CLI's "hook-per-dialog" pattern (boolean flags, no ModalPaneProvider/context)
3. Fix slash command `/` suggestion picker (up/down arrows must work)
4. Make it look good — study how Claude Code and Gemini CLI render their model pickers and settings dialogs
5. Delete `modal-pane.tsx` and `use-navigation.ts` — replace with explicit dialog state management

**Start with a plan. Don't code until I approve.**

---
