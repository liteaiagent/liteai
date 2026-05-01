# Phase 3.4: Keybinding & Help System

> **Status**: ✅ Complete
> **Completed**: 2026-04-30
> **Scope**: Context-aware keybinding system, help dialog, user customization

---

## Completion Summary

The keybinding system has been fully ported and extended. This document records the final state for reference.

---

## What Was Delivered

### Keybinding Infrastructure (`tui/keybindings/`)

| File | Lines | Purpose |
|------|-------|---------|
| [`types.ts`](file:///d:/liteai/packages/cli/src/tui/keybindings/types.ts) | 77 | `KeybindingContextName`, `ParsedKeystroke`, `Chord`, `ParsedBinding`, `KeybindingBlock` |
| [`parser.ts`](file:///d:/liteai/packages/cli/src/tui/keybindings/parser.ts) | ~120 | Parses keystroke strings (`ctrl+x ctrl+k`) into `Chord` objects |
| [`match.ts`](file:///d:/liteai/packages/cli/src/tui/keybindings/match.ts) | ~80 | Matches incoming `Key` events against `Chord` patterns |
| [`resolver.ts`](file:///d:/liteai/packages/cli/src/tui/keybindings/resolver.ts) | ~130 | Priority-based context resolution — specific contexts shadow Global |
| [`default-bindings.ts`](file:///d:/liteai/packages/cli/src/tui/keybindings/default-bindings.ts) | 237 | 17 context blocks with platform-specific defaults |
| [`keybinding-context.tsx`](file:///d:/liteai/packages/cli/src/tui/keybindings/keybinding-context.tsx) | ~160 | React context provider, `useRegisterKeybindingContext`, `getDisplayText` |
| [`keybinding-setup.tsx`](file:///d:/liteai/packages/cli/src/tui/keybindings/keybinding-setup.tsx) | ~180 | Merges user overrides (`tui.json` → `keybinds`) with defaults |
| [`use-keybinding.ts`](file:///d:/liteai/packages/cli/src/tui/keybindings/use-keybinding.ts) | ~110 | `useKeybinding(action, handler)` and `useKeybindings({action: handler})` hooks |
| [`use-shortcut-display.ts`](file:///d:/liteai/packages/cli/src/tui/keybindings/use-shortcut-display.ts) | ~25 | `useShortcutDisplay(action, context)` → formatted key label |

### 17 Keybinding Contexts

| Context | Scope | Key Actions |
|---------|-------|-------------|
| **Global** | Always active | `ctrl+c` interrupt, `ctrl+d` exit, `ctrl+l` redraw, `ctrl+r` search |
| **Chat** | Prompt input | `escape` cancel, `enter` submit, `ctrl+x ctrl+k` kill agents |
| **Autocomplete** | Suggestion dropdown | `tab` accept, `escape` dismiss, `↑/↓` navigate |
| **Settings** | Settings dialog | `j/k` navigate, `space` toggle, `enter` close |
| **Confirmation** | Permission prompts | `y/n`, `enter/escape`, `shift+tab` cycle mode |
| **Tabs** | Tab navigation | `tab/shift+tab`, `←/→` |
| **HistorySearch** | Ctrl+R search mode | `ctrl+r` next, `escape` accept, `enter` execute |
| **Task** | Active task context | `ctrl+b` background |
| **ThemePicker** | Theme dialog | `ctrl+t` syntax highlighting |
| **Scroll** | Scroll viewport | `pageup/down`, `ctrl+home/end`, selection copy |
| **Help** | Help dialog | `escape` dismiss |
| **Attachments** | Attachment bar | `←/→` navigate, `backspace` remove |
| **Footer** | Footer navigation | `↑/↓` navigate, `enter` open, `escape` clear |
| **MessageSelector** | Message cursor mode | `j/k` navigate, `ctrl+↑/↓` jump, `enter` select |
| **DiffDialog** | Diff viewer | `←/→` source, `↑/↓` file, `enter` details |
| **ModelPicker** | Model selection | `←/→` effort level |
| **Select** | Generic selector | `j/k` navigate, `space` toggle, `ctrl+d` delete |
| **Plugin** | Plugin manager | `space` toggle, `i` install |

### Chord Support

Multi-key sequences work natively:
- `ctrl+x ctrl+k` → kill agents
- `ctrl+x ctrl+e` → external editor
- `ctrl+x b` → sidebar toggle
- `ctrl+x n` → new session
- `ctrl+x l` → session list
- `ctrl+x y` → message copy
- `ctrl+x c` → compact
- `ctrl+x r` → rename

### User Customization

Via `tui.json`:
```json
{
  "keybinds": [
    { "context": "Chat", "bindings": { "ctrl+enter": "chat:submit" } },
    { "context": "Chat", "bindings": { "ctrl+x ctrl+k": null } }
  ]
}
```

- Override: add new binding → replaces default for that context+action
- Unbind: set action to `null` → removes the binding entirely
- Additive: user blocks merge with defaults (user takes priority)

### Dynamic Tips

[`tips.tsx`](file:///d:/liteai/packages/cli/src/tui/components/tips.tsx) uses `[action|Context|fallback]` syntax that resolves to the actual configured keybinding at runtime via `getDisplayText()`.

### Help Dialog

Existing `dialog-help.tsx` is wired. Shows available commands and keyboard shortcuts, powered by the keybinding system's `getDisplayText()`.

---

## Reference Architectures (For Context)

### Claude Code
- [`defaultBindings.ts`](file:///D:/claude-code/src/keybindings/defaultBindings.ts) (341 lines) — 17 context blocks. Our implementation matches this scope.
- `KeybindingContext.tsx` (26KB) — React context provider with priority-based resolution.
- Chord support via `reservedShortcuts.ts` — multi-key sequences.

### Gemini CLI
- [`keyBindings.ts`](file:///D:/gemini-cli/packages/cli/src/ui/key/keyBindings.ts) (808 lines) — `Command` enum with 60+ commands, `KeyBinding` class with `matches()`, `KeyBindingConfig` as `Map<Command, KeyBinding[]>`.
- `loadCustomKeybindings()` — User JSON with negation (`-command` to unbind).
- `commandCategories` + `commandDescriptions` for help/documentation.

### LiteAI Divergences from References
1. **Context-block structure** (vs. Claude's flat array and Gemini's Map) — allows grouping in config
2. **Chord-first design** — parser handles `ctrl+x ctrl+k` as first-class
3. **Null unbinding** — simpler than Gemini's `-command` negation syntax
4. **Dynamic tip labels** — `[action|Context|fallback]` syntax in tips resolves at render time
