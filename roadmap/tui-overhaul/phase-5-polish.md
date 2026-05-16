# Phase 5: Polish & Verification

> **Status**: Not Started  
> **Depends On**: Phase 4 (Visual Design & UX)  
> **Estimated Effort**: Low-Medium (~3-5 days)
>
> **Last Updated**: 2026-05-16 (added exit summary, alternate screen investigation)

---

## Agent Context

Load these files before starting implementation.

### Roadmap Docs
- `d:\liteai\roadmap\tui-overhaul\phase-5-polish.md` — this file (test matrix, lint rules, provider collapse)
- `d:\liteai\roadmap\tui-overhaul\roadmap.md` — success criteria table
- `d:\liteai\roadmap\tui-overhaul\design\architecture-comparison.md` — exit summary + alternate screen comparison
- `d:\liteai\roadmap\tui-overhaul\tui-architecture\08-ui-visual-design.md` — visual design specs (reference for verification)

### LiteAI Source (provider collapse targets)
- `d:\liteai\packages\cli\src\tui\app.tsx` — provider tree (15 wrappers)
- `d:\liteai\packages\cli\src\tui\context\exit.tsx` — merge into AppConfigProvider
- `d:\liteai\packages\cli\src\tui\context\tui-config.tsx` — merge into AppConfigProvider
- `d:\liteai\packages\cli\src\tui\context\args.tsx` — merge into AppConfigProvider
- `d:\liteai\packages\cli\src\tui\context\route.tsx` — merge into AppStateProvider
- `d:\liteai\packages\cli\src\tui\context\prompt.tsx` — eliminate (module-level ref)
- `d:\liteai\packages\cli\src\tui\components\global-exit-handler.tsx` — fold into KeybindingSetup
- `d:\liteai\packages\cli\src\tui\keybindings\keybinding-setup.tsx` — absorbs exit handler
- `d:\liteai\packages\cli\src\tui\state\index.ts` — AppStateProvider (absorbs route)

### LiteAI Source (lint rule + verification)
- `d:\liteai\biome.json` or equivalent lint config — add `useInput` restriction rule
- `d:\liteai\packages\cli\src\tui\primitives\` — all primitives (verify test coverage)

### Reference (not required)
No external reference files needed. Phase 5 is internal cleanup and verification.


## Goal

Full verification pass across all TUI interactions, lint rule enforcement for the input protocol, edge case hardening, and documentation finalization.

---

## Deliverable 1: Lint Rule Enforcement

### ESLint/Biome Rule: No Raw `useInput` in Dialog Components

```
rule: no-restricted-imports
  pattern: useInput
  message: "useInput is forbidden in dialog components. Use useKeybindings or useSelectList."
  allow:
    - base-text-input.tsx
    - keybinding-setup.tsx
    - scroll-handler.tsx
    - prompt-input.tsx
```

This ensures the input protocol is enforced at the linter level, not just by convention. New contributors cannot accidentally introduce raw `useInput` in dialog components.

---

## Deliverable 2: Full Verification Test Matrix

### Phase 1 Validation: Boot State (Unified Path)

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 1.1 | `/models` at boot | Fresh TUI → `/models` → Enter | Modal pane appears with model list |
| 1.2 | `/config` at boot | Fresh TUI → `/config` → Enter | Config tabs appear |
| 1.3 | Escape from modal at boot | 1.1 → Escape | Modal closes, prompt regains focus |
| 1.4 | Input after modal close | 1.3 → type text | Text appears in prompt |
| 1.5 | Session creation still works | Type prompt → Enter | Session creates normally |
| 1.6 | Boot visual parity | Fresh TUI → observe | Logo + Tips render centered, prompt at bottom |

### Phase 2 Validation: Input Conflicts

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 2.1 | Type in model filter | `/models` → type "gpt" | Filter shows "gpt", list filters |
| 2.2 | Arrow navigation | `/models` → ↑/↓ | Selection moves, filter unchanged |
| 2.3 | Type "j" in filter | `/models` → type "j" | "j" in filter, selection does NOT move |
| 2.4 | Type space in filter | `/models` → type "gpt 4" | Space in filter, item NOT selected |
| 2.5 | Enter selects item | Navigate → Enter | Item selected, dialog closes |
| 2.6 | Ctrl+N/P navigation | `/models` → Ctrl+N, Ctrl+P | Selection moves |
| 2.7 | PageUp/PageDown | `/models` → PageUp/PageDown | Selection jumps |

### Phase 3 Validation: Focus & Navigation

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 3.1 | Single input active | Open modal → type | Only modal receives keystrokes |
| 3.2 | Focus return | Modal → Escape → type | Prompt accepts input immediately |
| 3.3 | Stack push | `/config` → navigate to Models | Model dialog pushes on stack |
| 3.4 | Stack pop | 3.3 → Escape | Returns to Config, not prompt |
| 3.5 | Stack clear | 3.3 → multiple Escapes | Returns to prompt |
| 3.6 | Tab switch | Config → switch tabs | No focus flicker |

### Phase 4 Validation: Visual & UX

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| 4.1 | Message Trail | Select model → observe | System message recorded in scroll area |
| 4.2 | Command Palette | Ctrl+P → filter → select | Action executes, palette closes |
| 4.3 | Shell command | `! ls` → observe | Bordered output with exit code |
| 4.4 | Permission prompt | AI requests permission | Renders in scroll area, prompt stays |

### Edge Cases

| # | Test Case | Steps | Expected |
|---|-----------|-------|----------|
| E.1 | Rapid modal open/close | `/models` → Esc → `/config` quickly | No stuck state |
| E.2 | Ctrl+C during modal | Open modal → Ctrl+C | Clean exit or modal close |
| E.3 | Terminal resize | Open modal → resize terminal | Layout adapts |
| E.4 | Invalid command | Type `/invalid` | Unknown command message |
| E.5 | Double-open guard | `/models` while modal is open | Prevented (guard in prompt-input) |

---

## Deliverable 3: Automated Tests

### Scoped Test Commands
```bash
# Phase 1: Primitives
bun test packages/cli/src/tui/primitives/

# Phase 2: Migrated dialogs
bun test test/tui

# Full typecheck
bun typecheck 2>&1 | Out-String

# Lint
bun lint:fix
```

### Test Coverage Targets

| Module | Target | Notes |
|--------|--------|-------|
| `useSelectList` | 30+ test cases | Navigation, wrapping, disabled items, numbers, focus gating |
| `useDialogLifecycle` | 10+ test cases | Mount/unmount, Esc, context registration |
| `SelectList` | 5+ snapshot tests | Default rendering, custom renderItem, scroll indicators |
| `DialogPane` | 3+ snapshot tests | Title, content, footer hints |
| `ModalPaneProvider` | 10+ test cases | Stack push/pop/replace/clear |

---

## Deliverable 4: Documentation Update

### Update Feature Status
Update `roadmap/ui_features/ui_feature_status.md` to reflect new architecture.

### Create Component Catalog
Document all standard primitives with usage examples:

```
packages/cli/src/tui/primitives/README.md
├── useSelectList — API, options, test cases
├── useDialogLifecycle — API, options
├── SelectList — Props, renderItem examples
├── DialogPane — Props, footerHints examples
└── Composition patterns — Full dialog examples
```

### Update Architectural Strengths
Add to the "Architectural Strengths (Retain)" section:
- **Standard dialog primitives** — `useSelectList` + `useDialogLifecycle` + `SelectList` + `DialogPane`
- **Enforced input protocol** — lint rule prevents raw `useInput` in dialog components
- **Structural focus exclusion** — dialog replaces prompt, only one input active by construction
- **Modal stack semantics** — push/pop for nested dialogs, deterministic escape chains

---

## Deliverable 5: Performance Audit

### Render Count Verification
- Modal open/close should be 1 render cycle (not 2)
- `replaceTop` should be 1 render cycle (atomic)
- `SelectList` scroll windowing should prevent rendering all items

### Memory Leak Check
- Modal stack clears properly on `closeModal()`
- `useDialogLifecycle` unregisters keybinding context on unmount
- No stale closures in `useSelectList` callbacks

---

## Deliverable 6: Provider Tree Collapse

The `App` component nests 15 wrappers (13 true context providers + 2 components). Several are trivially thin wrappers over static data or simple `useRef`/`useState` calls. Neither Gemini CLI (~0 providers, monolith hooks) nor Claude Code (~5-6 providers) nests this deeply.

### Audit

| Provider | Role | Action |
|----------|------|--------|
| `ExitProvider` | Process exit callbacks (ref + callback) | **Merge** → `AppConfigProvider` |
| `TuiConfigProvider` | Static config from CLI init | **Merge** → `AppConfigProvider` |
| `KVProvider` | File-backed key-value store | **Keep** — async init, read/write |
| `ThemeProvider` | Color palette | **Keep** — used universally |
| `ToastProvider` | Toast notification queue | **Keep** — timer logic, state |
| `KeybindingSetup` | `useInput` interceptor (component, not a context) | **Keep** — stays as component |
| `GlobalExitHandler` | Double-press Ctrl+C (component, not a context) | **Merge** → fold into `KeybindingSetup` |
| `SDKProvider` | HTTP client, SSE, project ID | **Keep** — complex init |
| `ArgsProvider` | CLI arguments (static, readonly) | **Merge** → `AppConfigProvider` |
| `AppStateProvider` | Global state store | **Keep** — core state bus |
| `LocalProvider` | Local model/agent selection | **Evaluate** — reads same store as `AppStateProvider` |
| `RouteProvider` | Simple `useState<Route>` (6 lines of logic) | **Merge** → fold into `AppStateProvider` |
| `PromptRefProvider` | Imperative ref (already `useRef` internally) | **Eliminate** → module-level ref |
| `SessionProvider` | Session create/submit/abort | **Keep** — complex business logic |
| `AlternateScreen` | Terminal alternate buffer (Ink primitive) | **Keep** — required by Ink |

### Merge Groups

1. **`AppConfigProvider`** (new): Combines `ExitProvider` + `TuiConfigProvider` + `ArgsProvider`. All are static/readonly data set once at startup.
2. **`KeybindingSetup`**: Absorbs `GlobalExitHandler` logic (double-press Ctrl+C detection).
3. **`AppStateProvider`**: Absorbs `RouteProvider` (route is just `useState`).
4. **`PromptRefProvider`**: Eliminated — replaced with a module-level `useRef` export.

### Target

```
AppConfigProvider              ← static: exit, config, args
  KVProvider                   ← async: file-backed store  
    ThemeProvider               ← derived: color palette
      ToastProvider             ← state: notification queue
        KeybindingSetup         ← component: input interceptor + exit handler
          SDKProvider           ← async: HTTP + SSE
            AppStateProvider    ← state: global store + route
              LocalProvider     ← derived: model/agent selection
                SessionProvider ← state: session lifecycle
                  AlternateScreen
                    AppContent
```

**Net reduction**: 15 → 10 wrappers. No runtime impact (React context lookup is O(1)), but significantly improves `app.tsx` readability and reduces the number of files a contributor must understand.

### Implementation Notes

- This is a **readability refactor**, not a bug fix. No behavioral change.
- Each merge must preserve the original `useXxx()` hook API — consumers don't change.
- `PromptRefProvider` elimination is the riskiest — verify no component relies on context identity for re-render triggers (it shouldn't, since it's already `useRef`-based).

---

## Deliverable 7: Exit Summary (Gemini CLI Style)

> **Decided 2026-05-16**: Adopt Gemini CLI's interaction summary pattern.

When the user exits (Ctrl+C, `/quit`, or process signal), render a summary to stdout **after** Ink unmounts.

### Implementation

1. Capture stats snapshot before Ink cleanup (model, messages, tool calls, context %, cost, wall time, session ID)
2. In the process exit handler, write formatted summary directly to `process.stdout`
3. Include resume command: `liteai --resume '<session-id>'`

### Target Output

> **Encoding note**: The box-drawing characters below (`┌─┐ │ └┘`) and symbols (`✓ ✗`) require a UTF-8 capable terminal. The implementation detects encoding support and provides an ASCII fallback:
> - Override: `LITEAI_ASCII=1` env var forces ASCII mode unconditionally
> - Non-TTY: piped/redirected stdout → ASCII
> - Modern terminal detection: `WT_SESSION` (Windows Terminal), `TERM_PROGRAM ∈ {vscode, cursor, windsurf}` → UTF-8
> - Locale regex: `/utf-?8/i` against `LANG`/`LC_CTYPE`/`LC_ALL` → UTF-8
> - Windows fallback: `win32` with no locale AND no modern terminal indicator → ASCII (legacy cmd.exe/PowerShell)
> - Non-Windows TTY with no locale → UTF-8 (most modern \*nix terminals default to it)

**UTF-8 terminal:**
```
┌─────────────────────────────────────────┐
│ Interaction Summary                     │
│ Model:        gemini-2.5-pro            │
│ Messages:     12                        │
│ Tool Calls:   8 (6 ✓ / 2 ✗)            │
│ Context:      45% used                  │
│ Cost:         $0.042                    │
│ Wall Time:    3m 22s                    │
│                                         │
│ To resume: liteai --resume <session-id> │
└─────────────────────────────────────────┘
```

**ASCII fallback:**
```
+-----------------------------------------+
| Interaction Summary                     |
| Model:        gemini-2.5-pro            |
| Messages:     12                        |
| Tool Calls:   8 (6 [OK] / 2 [FAIL])     |
| Context:      45% used                  |
| Cost:         $0.042                    |
| Wall Time:    3m 22s                    |
|                                         |
| To resume: liteai --resume <session-id> |
+-----------------------------------------+
```

### Reference
- Gemini CLI: `ExitSummary` rendered on `/quit` with Session ID, Tool Calls, Success Rate, Performance stats
- Claude Code: Minimal — `Resume this session with: claude --resume <id>` written to stdout
- See `architecture-comparison.md` > Exit Summary Comparison for full analysis

---

## Deliverable 8: Alternate Screen — Investigation Complete

> **Investigated 2026-05-17**: LiteAI unconditionally uses alternate screen (`<AlternateScreen>` in `app.tsx:143`). Both Claude Code and Gemini CLI default to normal buffer because their UIs are single-column vertical layouts. LiteAI's planned sidebar + session-list navigation requires 2D viewport control, which commits us to alternate screen.

### Decision: Keep Alternate Screen as Default

**Rationale**: A sidebar (session list on back-button) requires fixed-viewport layout — the terminal must be a 2D grid where height AND width are constrained. Normal buffer mode cannot support this because:
- No height ceiling → `flexGrow` in ScrollBox unbounded → scroll breaks
- No absolute cursor positioning → sidebar can't repaint independently of main content
- Back-button navigation triggers full left-panel repaint → visual corruption in normal buffer

Claude Code and Gemini CLI don't have sidebars — that's why they can default to normal buffer.

### Config Option (opt-out for edge cases)

```typescript
// tui-schema.ts
alternate_screen: { type: 'boolean', default: true }
```

Auto-disable for `tmux -CC` (iTerm2 integration mode) where mouse tracking corrupts terminal state.

### tmux / SSH Limitations

| Issue | Environment | Severity | Mitigation |
|-------|------------|----------|------------|
| Mouse tracking conflict | tmux `set -g mouse on` | High | Detect tmux mouse state, show PgUp/PgDn hint |
| tmux -CC breaks mouse | iTerm2 integration | Breaking | Auto-detect, fall back to single-column layout |
| Copy mode empty | tmux `Prefix + [` | Medium | Users use TUI selection instead |
| Detach/reattach glitch | tmux detach | Medium | `SIGCONT` → `reenterAltScreen()` (already handled) |
| SSH reconnect stale state | SSH disconnect | High | `reassertTerminalModes()` (already handled in Ink) |
| High-latency frame tearing | SSH over slow link | Medium | BSU/ESU atomic framing (already implemented) |

| CLI | Buffer Mode | Shell Command Visible? |
|-----|------------|------------------------|
| Claude Code | Normal (conditionally alternate) | Yes |
| Gemini CLI | Normal (conditionally alternate) | Yes |
| LiteAI | Alternate (always, by design) | No — required for sidebar layout |

---

## Archive Original Documents

After Phase 5 completion, archive the superseded documents:

```bash
# Move superseded sub-documents to done/
mv roadmap/tui-overhaul/tui-architecture/ roadmap/done/tui-architecture/
mv roadmap/tui-overhaul/settings-ui-overhaul/ roadmap/done/settings-ui-overhaul/
```

---

## Acceptance Criteria

- [ ] Lint rule preventing raw `useInput` in dialog components is active
- [ ] Full verification test matrix passes (all manual tests green)
- [ ] Automated test coverage meets targets
- [ ] Provider tree collapsed from 15 → ~10 wrappers
- [ ] All `useXxx()` hook APIs preserved after provider merges
- [ ] `bun typecheck` passes with zero errors
- [ ] `bun lint:fix` passes
- [ ] Component catalog documentation is complete
- [ ] Feature status document is updated
- [ ] Exit summary renders on quit (Gemini CLI style)
- [ ] Alternate screen kept as default, configurable opt-out, tmux -CC auto-detection added
- [ ] Original documents archived to `roadmap/done/`
- [ ] No known regressions from prior sessions' work
