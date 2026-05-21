# Verification Plan — Settings UI Overhaul

---

## Test Matrix

### Phase 1: BlankSession Modal Slot

| # | Test Case | Steps | Expected | Pass? |
|---|-----------|-------|----------|-------|
| 1.1 | `/models` in BlankSession | Start fresh TUI → type `/models` → Enter | Modal pane appears with model list | ☐ |
| 1.2 | `/config` in BlankSession | Start fresh TUI → type `/config` → Enter | Config tabs appear in modal pane | ☐ |
| 1.3 | `/help` in BlankSession | Start fresh TUI → type `/help` → Enter | Help dialog renders | ☐ |
| 1.4 | Escape from modal in BlankSession | 1.1 → press Escape | Modal closes, prompt regains focus | ☐ |
| 1.5 | Input after modal close | 1.4 → type any text | Text appears in prompt | ☐ |
| 1.6 | Session creation still works | Type a prompt → Enter | Session creates, messages flow | ☐ |
| 1.7 | Modal layout sizing | 1.1 → observe modal dimensions | Bottom-anchored, divider visible, max 50% height | ☐ |

### Phase 2: Focus Centralization

| # | Test Case | Steps | Expected | Pass? |
|---|-----------|-------|----------|-------|
| 2.1 | Single useInput active | Open `/models` → check keystroke handling | Only modal's TextInput receives keys | ☐ |
| 2.2 | Focus returns on close | Open `/models` → Escape → type text | Prompt accepts input immediately | ☐ |
| 2.3 | Stack push (Config→Models) | `/config` → navigate to Models tab → Enter | Model dialog pushes on top of config | ☐ |
| 2.4 | Stack pop (Models→Config) | 2.3 → press Escape | Returns to Config tabs, not all the way to prompt | ☐ |
| 2.5 | Stack clear (close all) | 2.3 → Ctrl+C or multiple Escapes | Returns to prompt | ☐ |
| 2.6 | Navigation.replace | In Config → switch tabs | Tabs switch without focus flicker | ☐ |

### Phase 3: Input Conflict Resolution

| # | Test Case | Steps | Expected | Pass? |
|---|-----------|-------|----------|-------|
| 3.1 | Type in model filter | `/models` → type "gpt" | Filter shows "gpt", list filters | ☐ |
| 3.2 | Arrow key navigation | `/models` → ↑/↓ | Selection moves, filter unchanged | ☐ |
| 3.3 | Type "j" in filter | `/models` → type "j" | "j" appears in filter, selection does NOT move | ☐ |
| 3.4 | Type "k" in filter | `/models` → type "k" | "k" appears in filter, selection does NOT move | ☐ |
| 3.5 | Type space in filter | `/models` → type "gpt 4" | Space appears in filter, item NOT selected | ☐ |
| 3.6 | Enter selects item | `/models` → navigate → Enter | Item is selected, dialog closes | ☐ |
| 3.7 | Ctrl+N/P still work | `/models` → Ctrl+N, Ctrl+P | Selection moves up/down | ☐ |
| 3.8 | PageUp/PageDown | `/models` → PageUp, PageDown | Selection jumps 10 items | ☐ |

### Phase 4: Escape Chain

| # | Test Case | Steps | Expected | Pass? |
|---|-----------|-------|----------|-------|
| 4.1 | Top-level Escape | `/models` → Escape | Dialog closes, prompt active | ☐ |
| 4.2 | Nested Escape (pop) | `/config` → open Models → Escape | Returns to Config (not prompt) | ☐ |
| 4.3 | Full Escape chain | `/config` → Models → Escape → Escape | Returns to prompt | ☐ |
| 4.4 | Escape in search filter | `/models` → type text → Escape | Dialog closes (not just filter clear) | ☐ |

### Phase 5: Regression

| # | Test Case | Steps | Expected | Pass? |
|---|-----------|-------|----------|-------|
| 5.1 | In-session `/models` | Create session → `/models` | Same behavior as BlankSession | ☐ |
| 5.2 | Keybinding F2 (config) | Press F2 in session | Config dialog opens | ☐ |
| 5.3 | Multiple rapid commands | Type `/models` → Escape → `/config` quickly | No stuck state, each dialog renders correctly | ☐ |
| 5.4 | Ctrl+C during modal | Open any modal → Ctrl+C | Modal closes OR app exits cleanly | ☐ |
| 5.5 | Session list (Ctrl+S) | Press Ctrl+S | Session list renders in modal | ☐ |

---

## Automated Test Scope

### Unit Tests (scoped)
```bash
# Run only TUI-related tests
bun test test/tui
```

### Typecheck
```bash
bun typecheck 2>&1 | Out-String
```

### Lint
```bash
bun lint:fix
```

---

## Manual Verification Protocol

Since TUI interactions are inherently visual and input-driven, automated tests cover structure but not the focus/input behavior. The following **manual verification is required**:

### Pre-Session Flow
1. Start `liteai` fresh (no existing session)
2. Verify splash screen / logo renders
3. Type `/models` → Enter
4. Verify modal pane appears with model list
5. Type filter text → verify list filters
6. Press ↑/↓ → verify selection moves
7. Press Escape → verify modal closes
8. Type regular prompt → verify session creates

### In-Session Flow
1. Create a session (send a message)
2. Type `/config` → Enter
3. Verify config tabs render
4. Navigate to "Models" tab → Enter
5. Verify model list pushes onto stack
6. Press Escape → verify returns to config tabs
7. Press Escape again → verify returns to prompt
8. Send another message → verify session continues

### Edge Cases
1. Type `/invalid` → verify "unknown command" message, not a crash
2. Open `/models` → immediately Ctrl+C → verify clean exit
3. Resize terminal while modal is open → verify layout adapts
4. Open modal → wait 30 seconds → interact → verify no stale state
