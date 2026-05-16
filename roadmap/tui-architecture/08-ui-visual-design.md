# 08 - UI Visual Design: Screen-by-Screen Blueprint

## Overview

This document defines the visual design for every major TUI screen, comparing current LiteAI rendering against Gemini CLI and Claude Code, then proposing a target design. All rendering positions are verified against actual source code.

---

## Critical Layout Insight: Message Trail Pattern

Both Gemini CLI and Claude Code follow a consistent pattern for user-initiated actions:

1. User triggers action (e.g., /model)
2. Dialog appears BELOW messages, REPLACING the prompt
3. User makes selection
4. Dialog closes, prompt returns
5. Selection is RECORDED as a message in the scrollable area

This creates an audit trail. When you scroll through a conversation, you can see when models changed, providers were configured, etc. The correct pattern is: ephemeral dialog then permanent message record.

---

## Verified Rendering Positions

### Gemini CLI (from actual source code)

| Content | Where | Source |
|---------|-------|--------|
| Settings/Model dialog | DialogManager REPLACES Composer (bottom slot) | AppContainer.tsx: dialogVisible ternary |
| HITL (tool confirmation) | ToolConfirmationQueue renders INSIDE MainContent scrollable area, after pendingHistoryItems | MainContent.tsx L186-191 |
| Plan exit confirmation | Same ToolConfirmationQueue (type exit_plan_mode) | ToolConfirmationQueue.tsx L30 |
| Plan display | Approved plan shown as MessageType.GEMINI history item IN message area | planCommand.test.ts L168-171 |
| Ask User (question) | ToolConfirmationQueue (type ask_user) IN scrollable area | ToolConfirmationQueue.tsx L29 |
| Todo | TodoTray renders inside Composer (above input, below messages) | Composer.tsx L108 |
| Model change record | DialogManager receives addItem prop then records to history | DialogManager.tsx L45-46 |

### Claude Code (from actual source code)

| Content | Where | Source |
|---------|-------|--------|
| Settings/Model dialog | Modal slot (absolute, below bottom) replaces prompt focus | FullscreenLayout.tsx modal slot |
| HITL (permissions) | PermissionRequest in overlay (inside ScrollBox, after messages) | FullscreenLayout.tsx overlay slot |
| Plan mode | Enter/ExitPlanModePermissionRequest rendered as permission dialogs | Permission request components |
| Question tool | AskUserQuestionPermissionRequest BELOW prompt, with multi-tab navigation | PreviewQuestionView.tsx |
| Task list | TaskListV2 renders inside Spinner during streaming (in message area) | Spinner.tsx L284 |

---

## Screen Designs

### 1. Splash / Blank Session

Top-left logo, model/provider beside it, tips above prompt, status bar directly below prompt.

```
  [LOGO]  LiteAI v2.0.0
          claude-sonnet-4 via LiteAI Hub

  Tip: Press /connect to add API keys for 75+ providers

  > _
  myproject | main | claude-sonnet-4 | 0% ctx | $0.000
```

### 2. Settings / Model Picker (/model)

Flow: Dialog REPLACES prompt, user selects, dialog closes, selection recorded as message.

During selection:
```
  You: Fix the login bug

  Assistant: Analyzing the login flow...

  --- Select Model --------------------------------
  Filter: _

  LiteAI Hub
  > 1. claude-sonnet-4        (current)
    2. claude-opus-4
    3. gemini-2.5-pro

  Ollama (local)
    4. llama3.1:8b

  enter select   esc close
  -------------------------------------------------
  myproject | main | ...
```

After selection:
```
  You: Fix the login bug

  Assistant: Analyzing the login flow...

  /model > gemini-2.5-pro                  (recorded in messages)

  > _
  myproject | main | gemini-2.5-pro | ...
```

The model change is recorded as a system message in the scrollable area, creating an audit trail.

### 3. Permission Prompt (HITL)

Renders IN the scrollable message area, after the pending tool output (like Gemini CLI ToolConfirmationQueue):

```
  Assistant: I'll install the dependency...

  [tool] npm install
  +-- ? Shell ------------------------------------------+
  |  npm install express                                |
  |                                                     |
  |  > Allow   Allow always   Reject                    |
  |                                                     |
  |  enter select   esc reject                          |
  +-----------------------------------------------------+

  > _                                       (prompt stays visible!)
  myproject | main | ...
```

Critical insight: Prompt stays mounted and visible during HITL. The confirmation renders IN the scroll area, not in the bottom slot.

### 4. Question Tool

Renders BELOW the prompt (replaces it). After completion, Q and A are recorded in message area.

Single Question:
```
  Assistant: I need some design decisions...

  --- ? What database should we use? -------------------
  > 1. PostgreSQL
    2. MySQL
    3. SQLite

  -- or type your answer -------------------------------
  > _

  up/down select  enter confirm  tab switch  esc dismiss
  -----------------------------------------------------
  myproject | main | ...
```

Multi-Question (Tab Navigation):
```
  --- [done Database] [> Auth] [pending Deploy] --------

  How should authentication work?

  > 1. OAuth2 + JWT
    2. Session-based
    3. API keys only

  -- or type your answer -------------------------------
  > _

  up/down select  left/right question  enter confirm  esc
  -------------------------------------------------------
```

After completion (recorded in message area):
```
  Q: What database should we use?
  A: PostgreSQL

  Q: How should authentication work?
  A: OAuth2 + JWT

  Assistant: Great, I'll implement...
```

### 5. Plan / Plan Mode

Plan content renders IN the message area inside a bordered box. The exit-plan confirmation uses the AskUserDialog (same primitive as the question tool) with options to approve, edit, or provide feedback.

Entering Plan Mode:
```
  /plan                                     (user command, recorded)
  [i] Switched to Plan Mode.               (system message in scroll)

  > _
  myproject | Plan | gemini-2.5-pro | ...
```

Plan Output (AI generates plan as message, rendered with markdown):
```
  You: Implement authentication

  Assistant:
  # Authentication Plan

  ## Steps
  1. [ ] Set up Passport.js middleware
  2. [ ] Create user model with bcrypt
  3. [ ] Implement JWT token generation
  4. [ ] Add OAuth2 provider support
  5. [ ] Write integration tests

  [footer] Plan | gemini-2.5-pro | 4.2s
```

Exit Plan Mode - Boxed Confirmation (HITL, in scrollable area):

Gemini CLI ExitPlanModeDialog renders the plan content inside the AskUserDialog with approval options AND an external editor keybinding (ctrl+e to edit plan). This is a bounded, interactive widget IN the message stream:

```
  +-- Ready to start implementation? -----------------------+
  |                                                         |
  |  # Authentication Plan                                  |
  |  ## Steps                                               |
  |  1. [ ] Set up Passport.js middleware                   |
  |  2. [ ] Create user model with bcrypt                   |
  |  ...                                                    |
  |                                                         |
  |  > 1. Yes, automatically accept edits                   |
  |    2. Yes, manually accept edits                        |
  |                                                         |
  |  -- or type your feedback ---------------------------   |
  |  > _                                                    |
  |                                                         |
  |  up/down select  enter confirm  ctrl+e edit plan  esc   |
  +---------------------------------------------------------+
```

Key details (from ExitPlanModeDialog.tsx):
- Plan file is loaded from disk via usePlanContent hook
- ctrl+e opens the plan in an external editor, then refreshes
- Options: "Yes, automatically accept edits" / "Yes, manually accept edits"
- User can also TYPE free-form feedback instead of selecting an option
- On feedback, the plan goes back to the AI for revision

### 6. Todo Tray

Renders above the prompt (inside the "bottom" area, like Gemini CLI TodoTray in Composer). This is the ONE persistent widget.

```
  -- Todo 3/5 -------------------------------- ctrl+t --
  [in progress] Build API endpoints -- writing controllers...

  > _
  myproject | main | ...
```

Expanded:
```
  -- Todo 3/5 -------------------------------- ctrl+t --
  [done] Set up project structure
  [done] Configure database
  [done] Implement auth
  [in progress] Build API endpoints
  [pending] Write tests                 (blocked by #4)
  ---------------------------------------------------------

  > _
```

### 7. Provider Auth (/providers)

Flow: Dialog REPLACES prompt, multi-step ViewState, on success recorded as message.

```
  -- Connect: Google AI ----------------------------

  Opening browser for authentication...

  If browser didn't open, visit:
  https://accounts.google.com/o/oauth2/a...

  [spinner] Waiting for authorization callback...

  esc cancel
  -------------------------------------------------
  myproject | main | ...
```

After success:
```
  /providers > Google AI connected         (recorded in messages)

  > _
```

### 8. Slash Suggestions

Renders as a floating list above/below the prompt input (not replacing it):

```
  > /mo

  +------------------------+
  | > /models    Switch AI |
  |   /monitor   System    |
  +------------------------+
```

This is the only UI that is a true popup. It does not replace the prompt because the user is still typing.

---

## 9. Message Rendering and Display Modes

### Compact Mode (Default - ctrl+o to toggle)

In compact mode, tool calls are collapsed into single-line summaries. Only "interesting" output (text, errors, diffs) is shown.

LiteAI Current (Compact):
```
  You: Fix the login bug in auth.ts

  | [tool] read auth.ts [done]               (collapsed)
  | [tool] grep "login" src/ [done] 3 matches
  | [tool] edit auth.ts [done]

  Fixed the login bug by correcting the
  token validation logic on line 42.

  [footer] Build | claude-sonnet-4 | 3.1s
```

Tools eligible for compact collapse (from compact-allowlist.ts):
read, grep, glob, list, codesearch, websearch, webfetch, write, edit, apply_patch

Tools always shown in full: run_command, task, ask_user, todowrite, skill

### Transcript Mode (ctrl+o - full details)

Shows ALL tool I/O, reasoning content, and raw output. Used for debugging.

LiteAI Current (Transcript):
```
  You: Fix the login bug in auth.ts

  | [tool] read auth.ts [done]
  | +-------------------------------------+
  | | 1: import jwt from 'jsonwebtoken'   |  (full file content)
  | | 2: ...                              |
  | +-------------------------------------+
  | [tool] grep "login" src/ [done]
  | +-------------------------------------+
  | | src/auth.ts:42: loginUser(...)      |  (full grep results)
  | | src/routes.ts:15: router.post(...)  |
  | +-------------------------------------+

  [thinking] The issue is in the token
  validation... (1,234 tokens)

  Fixed the login bug by correcting...
```

Transcript keybindings (from session/index.tsx):
- ctrl+o (app:toggleTranscript) - toggle compact vs transcript
- transcript:exit - return to compact
- transcript:toggleShowAll - show messages before last compaction point

Claude Code (Verbose/Transcript):
ctrl+o toggles verbose mode. Thinking blocks expand to show full markdown content. Tool results show full output. isTranscriptMode flag controls rendering.

Gemini CLI:
No equivalent toggle. Uses cleanUiDetailsVisible for controlling detail level.

---

## 10. Thinking / Reasoning Display

### Comparison

| Feature | Gemini CLI | Claude Code | LiteAI Current |
|---------|-----------|-------------|-----------------|
| Collapsed | Thinking... header + subject line, left-border | Thinking ctrl+o to expand | Thinking: [first sentence] (N tokens) |
| Expanded | Full text, italic, left-border, secondary color | Full markdown, dimColor, indented | Full text, italic, bordered box |
| Toggle | Always shown (no toggle) | ctrl+o verbose toggle | ctrl+t show/hide thinking toggle |
| Token count | Not shown | Not shown | Shown (e.g., 1,234 tokens) |
| Past thinking | Shown per-message | Only latest shown (hideInTranscript) | Only latest shown (lastReasoningId gating) |

### Gemini CLI Thinking
```
   Thinking...
   |
   |  Analyzing the authentication flow to     (subject, bold italic)
   |  identify the root cause of the login bug (description, italic secondary)
   |
```
Uses left-border (borderLeft: true), italic text, first line bold.

### Claude Code Thinking
Collapsed (default):
```
  [dim] Thinking  ctrl+o to expand
```
Expanded:
```
  [dim] Thinking...
    I need to analyze the auth.ts file to    (full markdown, dimColor)
    understand the token validation flow...
```

### LiteAI Current Thinking

Compact mode (collapsed):
```
  [v] Thinking: Analyzing the auth flow... (1,234 tokens)
```

Transcript mode (expanded):
```
  +------------------------------------------+
  | [v] Thinking (1,234 tokens)              |
  |                                          |
  | I need to analyze the authentication...  |
  | The issue appears to be in the JWT...    |
  +------------------------------------------+
```

### Proposed Target

Keep LiteAI's current approach (it is already good), with minor refinements:
- Compact: keep as-is, one-line with first sentence and token count
- Transcript: Switch from boxed to left-border style (matches Gemini CLI, lighter visual weight):
  ```
    [v] Thinking (1,234 tokens)
    |
    |  I need to analyze the authentication...
    |  The issue appears to be in the JWT...
    |
  ```
- Token count: Keep (unique LiteAI feature, useful for debugging)
- ctrl+t: Keep as thinking toggle (separate from ctrl+o transcript toggle)

---

## 11. Message Structure Anatomy

### User Message
```
  |                                          (left border, agent color)
  |  Fix the login bug in auth.ts            (text content)
  |
  |  [file: README.md] [img: screenshot.png] (attached files if any)
  |  12:34 PM                                (timestamp if showTimestamps)
```

### Assistant Message
```
  [tool] read auth.ts [done]                 (tool calls, compact/expanded)
  [tool] edit auth.ts [done]

  Fixed the login bug by correcting the      (text, markdown rendered)
  token validation logic.

  [footer] Build | claude-sonnet-4 | 3.1s    (mode + model + duration)
```

The assistant footer shows:
- Colored dot (agent color, or muted if aborted)
- Mode name (Build/Plan)
- Model ID
- Duration (time since user message)
- "interrupted" label (if aborted)

### Error Message
```
  |                                          (red left border)
  |  API rate limit exceeded
  |
  |  [!] Request failed -- press r to retry  (recovery hint, contextual)
```

---

## Rendering Slot Summary

```
+----------------------------------------------------+
|  SCROLLABLE (inside ScrollBox, flexGrow=1)         |
|                                                    |
|  Messages (user + assistant, markdown rendered)    |
|  Tool output (compact or transcript)               |
|  Thinking/reasoning (collapsed or expanded)        |
|  HITL confirmations (bordered box in scroll)       |
|  Plan content (bordered AskUserDialog)             |
|  Q+A results (recorded after completion)           |
|  Action records (/model > flash)                   |
|  Spinner + subagent progress (when streaming)      |
|                                                    |
+----------------------------------------------------+
|  BOTTOM (flexShrink=0, directly below scroll)      |
|                                                    |
|  TodoTray (when active)                            |
|  {Dialog OR Prompt} (mutual exclusive)             |
|  StatusLine (always visible)                       |
+----------------------------------------------------+
```

---

## Design System

### Display Mode Keybindings
| Key | Action | Scope |
|-----|--------|-------|
| ctrl+o | Toggle compact vs transcript | Session |
| ctrl+t | Toggle thinking visibility | Session |
| ctrl+t (in todo) | Expand/collapse todo tray | Bottom area |

### Footer Hint Format
```
  key1 action1   key2 action2   key3 action3
```
Always at bottom of dialog, generated by DialogPane.footerHints prop.

---

## 12. Plan Mode — Full Rendering Detail

### How Gemini CLI Presents Plans

The plan is rendered via `ExitPlanModeDialog`, which wraps an `AskUserDialog` inside a `ToolConfirmationQueue` (in the scrollable message area). Key features:

1. **Plan content is rendered as markdown** using `MarkdownDisplay` (supports headers, lists, code blocks)
2. **The dialog is bordered** — `ToolConfirmationQueue` wraps it in a `borderStyle="round"` box with a colored border
3. **Edit-in-editor** — User can press `ctrl+e` to open the plan file in their external editor, then the plan reloads and re-renders
4. **Approval options** are presented as a choice question below the plan content
5. **Feedback loop** — If user types free text instead of selecting an option, it's sent as feedback to the model

### Gemini CLI Plan Flow (Verified)

```
  Assistant: Here's my implementation plan...

  ╭─ Ready to start implementation? ──────────────────╮
  │                                                    │
  │  # Authentication Plan                             │ ← plan content
  │                                                    │    (markdown rendered,
  │  ## Steps                                          │     scrollable if tall)
  │  1. Set up Passport.js middleware                  │
  │  2. Create user model with bcrypt                  │
  │  3. Implement JWT token generation                 │
  │  4. Add OAuth2 provider support                    │
  │  5. Write integration tests                        │
  │                                                    │
  │  → 1. Yes, automatically accept edits              │ ← approval options
  │    2. Yes, manually accept edits                   │
  │    3. (type feedback...)                           │ ← free text option
  │                                                    │
  │  ↑/↓ navigate  enter select  ctrl+e edit plan     │ ← key hints
  ╰────────────────────────────────────────────────────╯

  ❯ _                                      ← prompt stays mounted
```

After approval:
```
  ╭─ Ready to start implementation? ──────────────────╮
  │  (collapsed after approval)                        │
  ╰────────────────────────────────────────────────────╯

  Assistant: I'll start implementing the auth system...
  [tool] write src/auth.ts [done]                      ← tools now auto-approved
```

### Proposed LiteAI Target

```
  Assistant: Here's my implementation plan...

  ╭─ 📋 Review Plan ──────────────────────────────────╮
  │                                                    │
  │  # Authentication Plan                             │
  │                                                    │
  │  ## Steps                                          │
  │  1. Set up Passport.js middleware                  │
  │  2. Create user model with bcrypt                  │
  │  3. Implement JWT token generation                 │
  │  4. Add OAuth2 provider support                    │
  │  5. Write integration tests                        │
  │                                                    │
  │  → 1. Accept (auto-approve edits)                  │
  │    2. Accept (manual approval)                     │
  │    3. (type feedback to revise...)                 │
  │                                                    │
  │  ↑↓ select  enter confirm  ctrl+e edit  esc cancel │
  ╰────────────────────────────────────────────────────╯

  ❯ _
  myproject │ 📋 Plan │ ...
```

Key design decisions:
- Plan renders IN the scrollable area (not in bottom slot) — it's part of the conversation flow
- Bordered box (round border, accent color) distinguishes it from regular messages
- Markdown rendered inside using `<Markdown>` component
- Edit-in-editor via `ctrl+e` opens `$EDITOR`, reloads plan on return
- Free text feedback sends revision request to the model
- After acceptance, plan is collapsed in history (like Gemini CLI)

---

## 13. Command Palette (Ctrl+P)

### Current LiteAI

LiteAI has a command palette triggered by Ctrl+P that opens as a modal pane. It lists all available actions with their keybindings.

### Gemini CLI

No dedicated command palette. Uses slash commands only.

### Claude Code

Uses `?` key for a quick-reference help panel. No fuzzy-search palette.

### Proposed LiteAI Target

The command palette should render as a DIALOG (replaces prompt, bottom slot):

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
    6. Compact context        /compact
    7. Toggle plan mode       Tab
    8. Toggle thinking        ctrl+t
    9. Toggle transcript      ctrl+o

  ↑↓ select  enter run  / filter  esc close
  ─────────────────────────────────────────
  myproject │ ⎇ main │ ...
```

Design decisions:
- Uses `useSelectList` + `DialogPane` — same primitives as all other dialogs
- Filter input at top for fuzzy search
- Shows keybinding next to each action (right-aligned)
- Grouped by category (Actions, Navigation, Display)
- After selection: closes and executes the action directly (no message recording — it's a shortcut launcher, not a setting change)

---

## 14. Provider Multi-Action Screens

### Problem

Some providers require multiple configuration steps on the same screen. Example: Google Code Assist needs both OAuth login AND a project ID. Currently we navigate between separate ViewState screens, which causes focus/keybinding issues.

### Gemini CLI Approach

Gemini CLI uses `AskUserDialog` with multiple questions — the dialog has a tab navigation bar when there are multiple questions. Each question is its own tab, and the user can navigate between them with left/right arrows.

### Claude Code Approach

Claude Code uses `QuestionNavigationBar` + `QuestionView` with a tab bar at the top:
```
  ← [✓ Q1]  [→ Q2]  [○ Q3]  ✓ Submit →
```
Each question has its own full-screen content area. Tab/left-right navigates between them.

### Proposed LiteAI Target

Provider configuration should use the SAME dialog primitive pattern. A single `AskUserDialog`-style component handles multi-step configuration:

#### Step 1: Method Selection (optional, can be skipped)
```
  ── Connect: Google Code Assist ──────────
  ← [→ Auth]  [○ Project] →

  Select authentication method:

  → 1. Login with Google (browser)
    2. API Key

  ↑↓ select  enter confirm  →/tab next  esc cancel
  ─────────────────────────────────────────
```

#### Step 2: Project Configuration
```
  ── Connect: Google Code Assist ──────────
  ← [✓ Auth]  [→ Project] →

  Enter your Google Cloud project ID:

  > my-project-123_

  enter confirm  ←/tab prev  esc cancel
  ─────────────────────────────────────────
```

#### After completion (recorded in messages):
```
  /connect → Google Code Assist
    Auth: Login with Google ✓
    Project: my-project-123 ✓

  ❯ _
```

### Implementation

The provider dialog defines its config as an array of "questions":

```typescript
interface ProviderConfigStep {
  id: string;
  header: string;
  type: 'choice' | 'text' | 'oauth';
  question: string;
  options?: { label: string; value: string }[];
  placeholder?: string;
  // For OAuth steps, the dialog handles browser open + callback wait
  oauthConfig?: { url: string; callbackPort: number };
}
```

Each step is rendered as a tab in the navigation bar. Steps can be:
- **Choice** — standard `useSelectList` selection
- **Text** — free text input (project ID, API key)
- **OAuth** — special view showing URL + waiting spinner (browser auto-opens)

This maps directly to Gemini CLI's `AskUserDialog` (which already supports multi-question with tabs) and Claude Code's `QuestionView` (which has `QuestionNavigationBar`).

The key insight: **provider configuration is just a specialized multi-question dialog**, not a custom component. By using the same primitive, we get consistent keybindings, Esc handling, and tab navigation for free.

---

## 15. Icon System (Final)

| Icon | Meaning | Usage |
|------|---------|-------|
| `→` | Active selection cursor | Select lists, option navigation |
| `●` | Connected / active | Provider list, status indicators |
| `○` | Disconnected / pending | Provider list, plan steps |
| `◌` | In progress (with spinner) | Plan items during execution |
| `✓` | Completed / success | Plan items, checkmarks, confirmed |
| `✗` | Failed / cancelled | Plan items, errors |
| `△` | Warning / permission | HITL prompts |
| `❓` | Question from AI | AI question tool |
| `📋` | Plan mode indicator | Plan tray, status bar |
| `⌨` | Command palette | Ctrl+P palette header |
| `▼` | Collapsed/expandable | Thinking blocks (compact) |
| `▣` | Agent marker | Assistant message footer |
| `⎇` | Git branch | Status bar |
| `⊙` | MCP connection | Status bar |

---

## 16. Shell Command Execution (`!command`)

### How All Three Handle It

The `!` prefix triggers direct shell execution — the command bypasses the AI and runs in the user's shell. All three codebases follow a similar pattern:

1. User types `!ls -la` and presses Enter
2. The `!` is stripped, remaining text is the command
3. Command is executed via a PTY (interactive shell) or subprocess
4. Output streams into the UI in real-time
5. Result is recorded in conversation history (so the AI has context)

### Gemini CLI (Verified from `useExecutionLifecycle.ts`)

**Recording flow:**
1. `addItemToHistory({ type: 'user_shell', text: rawQuery })` — records the command as a `user_shell` message
2. Output streams into a `tool_group` pending history item with the tool name `SHELL_COMMAND_NAME`
3. After completion, final tool_group is committed to history with status (success/error/cancelled)
4. **Also records to Gemini client history** via `addShellCommandToGeminiHistory()` — so the AI knows the command was run and its output

**Rendering:**
```
  $ ls -la                                   ← UserShellMessage (distinct from user prompt)
  ╭─ Shell ──────────────────────────────╮
  │  total 128                           │   ← streaming output (PTY/ANSI)
  │  drwxr-xr-x  5 user staff  160 ...  │
  │  -rw-r--r--  1 user staff  1234 ... │
  ╰────────────────────────────────────────╯
```

**Key features:**
- Interactive shell support (PTY mode) — can run `vim`, `htop`, etc.
- Ctrl+B to background a running command
- Background task tray shows running commands
- Binary output detection (stops streaming, shows byte count)
- Directory change warning ("shell mode is stateless; cd will not persist")
- Exit code display on error

### LiteAI Current

**Recording flow:**
1. `getModeFromInput(input)` detects `!` prefix → mode = `"bash"`
2. `getValueFromInput(input)` strips the `!` → passes raw command to executor
3. History is partitioned by mode — bash commands have their own up/down history

**Rendering:**
LiteAI currently renders shell commands similarly to tool calls, but with bash-specific prompt styling.

### Proposed LiteAI Target

```
  ! ls -la                                   ← user_shell message
  ╭─ $ ls -la ────────────────────────────╮
  │  total 128                             │  ← streaming output
  │  drwxr-xr-x  5 user staff  160 ...    │
  │  -rw-r--r--  1 user staff  1234 ...   │
  ╰─────────── exit 0 ─── 0.3s ───────────╯

  ❯ _
```

**On error:**
```
  ! git push origin main
  ╭─ $ git push origin main ──────────────╮
  │  error: failed to push some refs to   │  ← red border
  │  'origin'                              │
  ╰─────────── exit 1 ─── 1.2s ───────────╯

  ❯ _
```

**During execution (live streaming):**
```
  ! npm test
  ╭─ $ npm test ──────────────── ctrl+b ──╮  ← ctrl+b hint for background
  │  PASS src/auth.test.ts                 │
  │  PASS src/routes.test.ts               │
  │  ◌ Running tests...                    │  ← live streaming
  ╰────────────────────────────────────────╯

  ❯ _                                        ← prompt visible but input blocked during execution
```

**Design decisions:**
- Shell commands render IN the scrollable message area (same as all tool output)
- Uses bordered box (round border, like Gemini CLI's ToolConfirmationQueue shell rendering)
- Command shown in header ($ prefix to distinguish from AI-invoked tools)
- Exit code shown in footer of border
- ctrl+b to background (match Gemini CLI)
- History partitioning: up/down in `!` mode cycles through previous shell commands only (already implemented)
- **AI context**: After execution, command + output injected into AI's context (like Gemini CLI's `addShellCommandToGeminiHistory`) so the AI knows what the user ran
- Prompt stays visible during execution but input may be blocked (PTY captures stdin)
- Border color: default for success, red for non-zero exit code


