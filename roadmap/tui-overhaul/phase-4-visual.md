# Phase 4: Visual Design & UX

> **Status**: Not Started  
> **Depends On**: Phase 3 (Focus & Navigation)  
> **Estimated Effort**: High (~1-2 weeks)

---

## Agent Context

Load these files before starting implementation.

### Roadmap Docs
- `d:\liteai\roadmap\tui-overhaul\phase-4-visual.md` — this file (screen blueprints, feature specs)
- `d:\liteai\roadmap\tui-overhaul\design\architecture-comparison.md` — rendering slot comparison across CLIs, boot flow, exit summary
- `d:\liteai\roadmap\tui-overhaul\tui-architecture\08-ui-visual-design.md` — **comprehensive screen-by-screen blueprint** (message rendering, thinking blocks, plan mode, command palette, shell commands, provider auth, icon system — 850 lines of verified design specs)

### LiteAI Source (modification targets — load per feature)

**Model Picker + Message Trail:**
- `d:\liteai\packages\cli\src\tui\components\dialog-model.tsx` — current model picker
- `d:\liteai\packages\cli\src\tui\components\dialog-provider.tsx` — provider selection

**Permission / Question Prompts:**
- `d:\liteai\packages\cli\src\tui\routes\session\permission.tsx` — HITL permission prompt
- `d:\liteai\packages\cli\src\tui\routes\session\question.tsx` — AI question tool

**Shell Commands / Status:**
- `d:\liteai\packages\cli\src\tui\routes\session\parts.tsx` — message part rendering
- `d:\liteai\packages\cli\src\tui\components\status-line.tsx` — status bar

**Primitives (from Phase 1):**
- `d:\liteai\packages\cli\src\tui\primitives\index.ts` — all standard primitives

### Gemini CLI Reference
- `D:\gemini-cli\packages\cli\src\ui\commands\modelCommand.ts` — model picker with grouped providers (2042 LOC)
- `D:\gemini-cli\packages\cli\src\ui\components\ToolConfirmationQueue.tsx` — HITL permissions in scroll area
- `D:\gemini-cli\packages\cli\src\ui\hooks\useModelCommand.ts` — dialog state hook pattern

### Claude Code Reference
- `D:\claude-code\src\screens\REPL.tsx` — command dispatch + result recording as messages
- `D:\claude-code\src\components\permissions\PermissionPrompt.tsx` — permission rendering
- `D:\claude-code\src\components\permissions\AskUserQuestionPermissionRequest\AskUserQuestionPermissionRequest.tsx` — question tool UI
- `D:\claude-code\src\components\messages\UserCommandMessage.tsx` — message trail pattern
- `D:\claude-code\src\components\design-system\Pane.tsx` — bordered dialog chrome


## Goal

Implement the visual design system and new UX patterns that bring LiteAI's TUI to production quality. This phase covers screen-by-screen visual blueprints, the Message Trail audit pattern, and several new features.

---

## Design Principle: Message Trail Pattern

Both Gemini CLI and Claude Code follow a consistent pattern for user-initiated actions:

1. User triggers action (e.g., `/model`)
2. Dialog appears BELOW messages, REPLACING the prompt
3. User makes selection
4. Dialog closes, prompt returns
5. **Selection is RECORDED as a message in the scrollable area**

This creates an audit trail. When scrolling through a conversation, you can see when models changed, providers were configured, etc.

```
  You: Fix the login bug

  Assistant: Analyzing the login flow...

  /model → gemini-2.5-pro                  ← recorded in messages

  > _
  myproject | main | gemini-2.5-pro | ...
```

---

## Feature 1: Model Picker Visual Overhaul

### During Selection
```
  ── Select Model ──────────────────────────────
  Filter: _

  LiteAI Hub
  → 1. claude-sonnet-4        (current)
    2. claude-opus-4
    3. gemini-2.5-pro

  Ollama (local)
    4. llama3.1:8b

  enter select   esc close
  ───────────────────────────────────────────────
  myproject | main | ...
```

### After Selection (Message Trail)
```
  /model → gemini-2.5-pro

  > _
  myproject | main | gemini-2.5-pro | ...
```

### Implementation
- Grouped items by provider (category field in `SelectItem`)
- `SelectList` renders group headers between items
- On selection: close dialog + inject system message into scrollable area

---

## Feature 2: Plan Mode UI

### Entering Plan Mode
```
  /plan                                     (user command, recorded)
  [i] Switched to Plan Mode.               (system message)

  > _
  myproject | Plan | gemini-2.5-pro | ...
```

### Plan Review Confirmation (In Scrollable Area)
```
  ╭─ 📋 Review Plan ──────────────────────────────╮
  │                                                 │
  │  # Authentication Plan                          │
  │                                                 │
  │  ## Steps                                       │
  │  1. Set up Passport.js middleware               │
  │  2. Create user model with bcrypt               │
  │  3. Implement JWT token generation              │
  │                                                 │
  │  → 1. Accept (auto-approve edits)               │
  │    2. Accept (manual approval)                  │
  │    3. (type feedback to revise...)              │
  │                                                 │
  │  ↑↓ select  enter confirm  ctrl+e edit  esc     │
  ╰─────────────────────────────────────────────────╯
```

### Implementation
- Plan content renders IN the scrollable area (not bottom slot)
- Bordered box (`borderStyle="round"`, accent color)
- Markdown rendering inside using `<Markdown>` component
- `ctrl+e` opens `$EDITOR`, reloads plan on return
- Free text feedback sends revision request to the model
- After acceptance, plan collapses in history

---

## Feature 3: Command Palette (Ctrl+P)

Renders as a dialog (replaces prompt, bottom slot):

```
  ─────────────────────────────────────────
  ⌨ Command Palette
  Filter: _

  Actions
  → 1. Switch model          ctrl+x m
    2. Connect provider      /connect
    3. Export conversation    ctrl+x x
    4. New session            ctrl+x n
    5. Session list           ctrl+x l

  ↑↓ select  enter run  / filter  esc close
  ─────────────────────────────────────────
```

### Implementation
- Uses `useSelectList` + `DialogPane` — same primitives as all other dialogs
- Filter input for fuzzy search
- Shows keybinding next to each action (right-aligned)
- Grouped by category (Actions, Navigation, Display)
- After selection: closes and executes the action directly

---

## Feature 4: Question Tool (Multi-Tab)

### Single Question
```
  ── ? What database should we use? ────────────
  → 1. PostgreSQL
    2. MySQL
    3. SQLite

  -- or type your answer ───────────────────────
  > _

  up/down select  enter confirm  tab switch  esc
  ──────────────────────────────────────────────
```

### Multi-Question (Tab Navigation)
```
  ── [done Database] [→ Auth] [pending Deploy] ─
  
  How should authentication work?

  → 1. OAuth2 + JWT
    2. Session-based
    3. API keys only

  -- or type your answer ───────────────────────
  > _

  up/down select  left/right question  enter  esc
  ──────────────────────────────────────────────
```

### After Completion (Message Trail)
```
  Q: What database should we use?
  A: PostgreSQL

  Q: How should authentication work?
  A: OAuth2 + JWT
```

### Implementation
- `AskUserDialog` component with tab navigation bar for multi-question
- Each question is a tab: `[done Label]`, `[→ Active]`, `[pending Label]`
- Free text input as alternative to selection
- Results recorded as messages after completion

---

## Feature 5: Shell Command Rendering

### Live Execution
```
  ! npm test
  ╭─ $ npm test ──────────────── ctrl+b ──╮
  │  PASS src/auth.test.ts                 │
  │  PASS src/routes.test.ts               │
  │  ◌ Running tests...                    │
  ╰────────────────────────────────────────╯

  > _
```

### After Completion (Success)
```
  ! ls -la
  ╭─ $ ls -la ────────────────────────────╮
  │  total 128                             │
  │  drwxr-xr-x  5 user staff  160 ...    │
  ╰─────────── exit 0 ─── 0.3s ───────────╯
```

### After Completion (Error)
```
  ! git push origin main
  ╭─ $ git push origin main ──────────────╮  ← red border
  │  error: failed to push some refs      │
  ╰─────────── exit 1 ─── 1.2s ───────────╯
```

### Implementation
- Shell commands render IN the scrollable message area
- Bordered box (round border, like Gemini CLI)
- Command shown in header with `$` prefix
- Exit code + duration in footer
- `ctrl+b` to background (match Gemini CLI)
- Border color: default for success, red for non-zero exit code
- AI context: command + output injected into AI's context

---

## Feature 6: Todo Tray

Renders above prompt, inside the bottom area:

### Collapsed
```
  ── Todo 3/5 ─────────────────── ctrl+t ──
  [in progress] Build API endpoints -- writing controllers...

  > _
```

### Expanded
```
  ── Todo 3/5 ─────────────────── ctrl+t ──
  [done] Set up project structure
  [done] Configure database
  [done] Implement auth
  [in progress] Build API endpoints
  [pending] Write tests
  ─────────────────────────────────────────

  > _
```

### Implementation
- Persistent widget between scrollable area and prompt
- `ctrl+t` toggles collapsed/expanded
- Shows current item summary when collapsed
- Shows all items when expanded

---

## Feature 7: Thinking Block Refinement

### Current (Keep)
Compact mode: `[v] Thinking: Analyzing the auth flow... (1,234 tokens)`

### Proposed Change: Left-Border Style (Transcript Mode)
```
  [v] Thinking (1,234 tokens)
  |
  |  I need to analyze the authentication...
  |  The issue appears to be in the JWT...
  |
```

Switch from boxed style to left-border style (matches Gemini CLI, lighter visual weight).
Keep token count (unique LiteAI feature).

---

## Feature 8: Permission Prompt (HITL) Refinement

Renders IN the scrollable message area, after the pending tool output:

```
  Assistant: I'll install the dependency...

  [tool] npm install
  ╭─ ? Shell ──────────────────────────────╮
  │  npm install express                    │
  │                                         │
  │  → Allow   Allow always   Reject        │
  │                                         │
  │  enter select   esc reject              │
  ╰─────────────────────────────────────────╯

  > _                                       ← prompt stays visible
```

Prompt stays mounted and visible during HITL. Confirmation renders IN scroll area, not bottom slot.

---

## Icon System

| Icon | Meaning | Usage |
|------|---------|-------|
| `→` | Active selection cursor | Select lists |
| `●` | Connected / active | Provider list, status |
| `○` | Disconnected / pending | Provider list, steps |
| `◌` | In progress (with spinner) | Plan items during execution |
| `✓` | Completed / success | Plan items, confirmed |
| `✗` | Failed / cancelled | Errors |
| `△` | Warning / permission | HITL prompts |
| `❓` | Question from AI | AI question tool |
| `📋` | Plan mode indicator | Plan tray, status bar |
| `⌨` | Command palette | Ctrl+P header |
| `▼` | Collapsed/expandable | Thinking blocks |
| `▣` | Agent marker | Footer |
| `⎇` | Git branch | Status bar |
| `⊙` | MCP connection | Status bar |

---

## Implementation Priority

| # | Feature | Effort | User Impact |
|---|---------|--------|-------------|
| 1 | Model Picker overhaul | Low | High — most used dialog |
| 2 | Message Trail recording | Medium | High — audit trail for all actions |
| 3 | Permission prompt refinement | Low | High — used constantly during agentic workflows |
| 4 | Shell command rendering | Medium | Medium — improves `!` command UX |
| 5 | Thinking block refinement | Low | Medium — cleaner visual weight |
| 6 | Command Palette | Medium | Medium — power user discovery |
| 7 | Question Tool multi-tab | High | Medium — used by AI agents |
| 8 | Plan Mode UI | High | Medium — enables plan-driven workflow |
| 9 | Todo tray | Medium | Low-Medium — informational |

---

## Acceptance Criteria

- [ ] Model picker renders with grouped items and footer hints
- [ ] All user-initiated actions record a message in the scrollable area (Message Trail)
- [ ] Plan mode uses bordered confirmation in scrollable area with approval options
- [ ] Command palette opens with Ctrl+P, supports fuzzy filter, executes actions
- [ ] Shell commands render with bordered output, exit code, and duration
- [ ] Todo tray renders above prompt, toggles with ctrl+t
- [ ] Thinking blocks use left-border style in transcript mode
- [ ] Permission prompts render inside scrollable area with proper selection
- [ ] Icon system is consistent across all screens
