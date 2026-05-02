# Phase 7 — Polish & Deferred: Competitive Analysis & Design Decisions

> Analysis doc for Phase 7 planning. This document captures all research, comparison, and design decisions.
> The implementation plan is a separate artifact.

---

## Source Audit Summary

### Reference Implementations Studied

| Source | Key Files Analyzed |
|---|---|
| **Claude Code** (D:\claude-code) | `OutputStylePicker.tsx`, `outputStyles.ts`, `loadOutputStylesDir.ts`, `Feedback.tsx`, `FeedbackSurvey/`, `Stats.tsx`, `TagTabs.tsx`, `AgentsList.tsx`, `AgentDetail.tsx`, `AgentEditor.tsx` |
| **Gemini CLI** (D:\gemini-cli) | Repository structure, compact output allowlist pattern |
| **LiteAI** (D:\liteai) | `dialog-stats.tsx`, `dialog-agent.tsx`, `dialog-settings.tsx`, `dialog-session-list.tsx`, `subagent-progress.tsx`, `status-line.tsx`, `tools.tsx`, `compact-allowlist.ts`, `tui-schema.ts`, `toast.tsx`, `ctx.tsx`, `local.tsx`, `tips.tsx` |

---

## Feature-by-Feature Analysis

### 7.1 — Output File Support

**What it is:** When tool output exceeds a configurable threshold, save it to a temporary file and display the file path instead of inlining massive content.

**Claude Code:** Does NOT implement this. Tool output either shown inline (transcript) or hidden (compact).

**Gemini CLI:** Implements `(Output saved to: path)` pattern. When command output exceeds a threshold, writes to a temp file and renders a one-liner with the path.

**LiteAI Current State:** Tools like `RunCommand` and `CommandStatus` already have `expanded` state and line truncation (10 lines max). No file-save fallback exists.

**Design Decision:**
- Threshold: **5000 characters** (configurable in `tui.json` as `output_file_threshold`)
- Location: Write to `$TMPDIR/liteai-output/<sessionID>/<callID>.txt`
- Rendering: In compact mode, show `$ Ran <cmd> (output saved: ~/.liteai/tmp/<hash>.txt)`. In transcript mode, show first 50 lines + path.
- The save logic lives in `tools.tsx` at the `BlockTool` and `RunCommand` render level — no backend change needed since tool output is already available in metadata.

---

### 7.2 — Subagent Hint Suppression

**What it is:** Inside nested subagent output, suppress the `(ctrl+o to expand)` hint that applies to top-level messages only.

**Claude Code:** Has `CtrlOToExpand.tsx` component with visibility control via `isInsideSubagent` context.

**LiteAI Current State:** The `ctrl+o` hint is rendered in `status-line.tsx` as a global segment. Subagent progress (`subagent-progress.tsx`) renders inline without any ctrl+o hint, so this is a **non-issue in the current architecture**. The hint is already only in the status line, never inside subagent rows.

**Design Decision:** Mark as **already resolved** by architecture. The status line segment "Compact (ctrl+o)" / "Transcript (ctrl+o)" is global, never duplicated inside subagent blocks. No work needed.

> [!NOTE]
> If we later add per-message expand hints (like Claude's inline `ctrl+o` on each message), we'd need subagent suppression. For now, this is a no-op.

---

### 7.3 — Agent Management UI

**What it is:** Full CRUD experience for agents: list with grouping by source, detail view showing config, inline editor for system prompt/tools/model.

**Claude Code Architecture (reference):**
- `AgentsList.tsx` (440 lines): Grouped by source (built-in, project, user, plugin), keyboard navigation (up/down/enter), "Create new agent" action, shadow/override detection
- `AgentDetail.tsx` (220 lines): Read-only view showing description, tools list, model, permission mode, memory scope, hooks, skills, color, system prompt (rendered as Markdown)
- `AgentEditor.tsx` (6.4KB): Form with text inputs for name, whenToUse, model selector, tool selector, save/cancel
- `agentFileUtils.ts` (7.5KB): File path resolution, YAML serialization, file write
- `generateAgent.ts` (10KB): LLM-driven agent scaffolding
- Navigation: `AgentsMenu.tsx` → `AgentsList.tsx` → `AgentDetail.tsx` (or `AgentEditor.tsx`)

**LiteAI Current State:**
- `dialog-agent.tsx` (34 lines): Bare-bones select list — name + description, no grouping, no detail, no create/edit
- Agent data comes from `useLocal().agent.list()` which returns `Agent[]` from `@liteai/sdk`
- Agent data structure includes: `name`, `description`, `native`, `mode`, `hidden`, `model`, `color`, `tools`

**Design Decision: 3-screen flow using existing DialogSelect**

1. **Agent List** (`dialog-agent-list.tsx`): Replaces `dialog-agent.tsx`. Groups agents by source (native vs custom). Shows model + tool count in description. Footer: `↑↓ navigate · Enter view · ctrl+n new · ctrl+d delete`.
2. **Agent Detail** (`dialog-agent-detail.tsx`): Read-only view showing name, description, model, tools, system prompt preview. Footer: `Enter edit · Esc back`.
3. **Agent Editor** (`dialog-agent-editor.tsx`): Form-based editor with fields for name, whenToUse, model (opens model picker), tools (toggle list). Saves to `.liteai/agents/<name>.md`.

The file I/O for agents already exists in `@liteai/core`'s agent loader. The TUI just needs to call the SDK to write back.

---

### 7.4 — Advanced Stats

**What it is:** Activity heatmap, usage streaks, date range cycling.

**Claude Code Architecture (reference):**
- `Stats.tsx` (1228 lines, ~39KB): Full tabbed stats dashboard
  - **Overview tab**: GitHub-style activity heatmap (via `generateHeatmap()`), date range selector (7d/30d/all), session count, longest session, active days, longest/current streak, peak day, fun factoid (book comparisons, time comparisons)
  - **Models tab**: Per-model token breakdown with bar chart, daily token trend chart (via `asciichart`)
  - Date range cycling via `r` key
  - Screenshot/copy via `ctrl+s`
  - Uses `aggregateClaudeCodeStatsForRange()` which reads session storage files
  - React 19 `use()` for suspense-based loading

**LiteAI Current State:**
- `dialog-stats.tsx` (199 lines): Session-scoped only — duration, turn count, context window, cost, tool calls, code changes, per-model breakdown table
- No cross-session aggregation, no heatmap, no streaks, no date ranges

**Design Decision: Extend stats dialog with 2 tabs**

1. **Session tab** (existing): Current session stats, unchanged
2. **Global tab** (new): Cross-session aggregation
   - **Heatmap**: Terminal-width-aware activity heatmap using Unicode block characters (▁▂▃▅▆█) with themed colors. Data source: SDK's session list with timestamps.
   - **Streaks**: Longest streak, current streak (calculated from daily activity array)
   - **Date range**: `r` key cycles through 7d/30d/all, displayed as highlighted labels
   - **Factoids**: Token-count book comparisons (War and Peace = 730k tokens, etc.)
   - No external dependencies (no `asciichart`) — we render with ANSI box characters

Data aggregation: New utility `use-global-stats.ts` that fetches sessions from SDK, aggregates tokens/cost/activity per day, computes streaks.

---

### 7.6 — Session Tagging/Renaming

**What it is:** Tag system for sessions with tab-based filtering in the session list.

**Claude Code Architecture (reference):**
- `TagTabs.tsx` (139 lines): Horizontal scrollable tab bar with tag names, "All" tab, overflow indicators (← N / → N (tab to cycle))
- Tags stored in session metadata
- Tag-based filtering in session browser

**LiteAI Current State:**
- `dialog-session-list.tsx` (205 lines): Session list with search, rename (ctrl+r), delete (ctrl+d), archive (ctrl+a). No tags.
- Session data structure from SDK includes `time.archived` but no tag field

**Design Decision: Inline tag approach**

- Tags stored as comma-separated string in session metadata via SDK's `session.update()`. The SDK's session update already accepts arbitrary metadata fields.
- **Tag UI in session list**: Add `ctrl+t` to tag selected session. Opens a mini-input for tag name (autocomplete from existing tags).
- **Tag filter bar**: Above the session list, show `All | #tag1 | #tag2` with `tab` to cycle. Uses existing `DialogSelect` filter mechanism.
- **Enhanced rename**: `ctrl+r` already works via `DialogSessionRename`. Enhance by adding an inline text input pre-populated with current title.

---

### 7.7 — Toast Positioning

**What it is:** Position toasts at absolute bottom of terminal instead of inline.

**LiteAI Current State:**
- `toast.tsx` (63 lines): Context-based toast with `show()` and `error()` methods
- Toast rendering is currently handled inline in `session-layout.tsx`
- No absolute positioning — Ink doesn't support CSS-like absolute positioning natively

**Design Decision:**
- Use Ink's `Box` with `position="absolute"` (which IS supported in @liteai/ink) at the bottom of the terminal
- Toast container rendered at the root layout level (`app.tsx` or `session-layout.tsx`) as the last child in a `position="absolute"` Box
- Each toast gets a slide-in animation using `useAnimationFrame`

---

### 7.8 — Feedback/Survey System

**What it is:** Thumbs up/down per message + optional transcript sharing for bug reports.

**Claude Code Architecture (reference):**
- `Feedback.tsx` (592 lines): Multi-step dialog — description input → consent → submitting → done
  - Generates GitHub issue URL with sanitized transcript
  - Auto-generates issue title via Haiku LLM call
  - Redacts API keys, AWS keys, GCP keys from transcripts
  - Posts to `api.anthropic.com/api/claude_cli_feedback`
- `FeedbackSurvey/` (9 files): Inline per-response rating (1-3 scale), debounced digit input, transcript share opt-in
  - Appears after each assistant response
  - `useFeedbackSurvey.tsx` manages survey lifecycle and analytics

**LiteAI Current State:** No feedback system exists.

**Design Decision: Lightweight local-first approach**

Since LiteAI is self-hosted (no Anthropic backend), we cannot submit to a central API. Instead:

1. **Per-message rating**: After each assistant response, show `👍/👎` hint. User presses `1` (good) or `2` (bad). Rating stored in session metadata via SDK.
2. **Feedback dialog** (`dialog-feedback.tsx`): `/feedback` command opens a dialog:
   - Text input for description
   - Consent screen showing what will be included
   - Exports to a local feedback file (`~/.liteai/feedback/<timestamp>.json`) containing: description, session ID, timestamps, redacted transcript
   - Optional: Opens GitHub issue URL (configurable repo in `liteai.json`)
3. **Redaction**: Port Claude Code's `redactSensitiveInfo()` patterns (API keys, AWS keys, bearer tokens) — straightforward regex set.

---

### 7.9 — Output Style Picker

**What it is:** Named output styles (response personalities) selectable from settings.

**Claude Code Architecture (reference):**
- `outputStyles.ts` (217 lines): 3 built-in styles (Default, Explanatory, Learning) with system prompt overrides
- `loadOutputStylesDir.ts` (99 lines): Loads custom `.md` files from `.claude/output-styles/` with frontmatter (name, description, keep-coding-instructions)
- `OutputStylePicker.tsx` (112 lines): `Select` dialog listing all available styles
- Style applied by replacing/augmenting the system prompt

**LiteAI Current State:**
- Agents already serve as "personalities" with custom system prompts
- No dedicated output style system
- `dialog-settings.tsx` has no output style entry

**Design Decision: Markdown-based output styles**

- Output styles are `.md` files in `.liteai/styles/` with YAML frontmatter:
  ```yaml
  ---
  name: Explanatory
  description: Explains implementation choices with educational insights
  ---
  [system prompt content]
  ```
- 2 built-in styles shipped as embedded strings: `Default` (null prompt) and `Explanatory`
- `dialog-output-style.tsx`: Select dialog listing styles, activated via `/style` command or settings hub
- Active style stored in `tui.json` as `outputStyle: "default" | "explanatory" | "<custom-name>"`
- Core integration: The selected style's prompt is injected as an additional system instruction by the agent's system prompt builder. This requires a small core change to read the active style from config.

---

### 7.10 — MCP Tool Compact Opt-In

**What it is:** Allow MCP servers to declare tools as compact-eligible via manifest metadata, extending the static `COMPACT_TOOL_ALLOWLIST`.

**LiteAI Current State:**
- `compact-allowlist.ts` (17 lines): Static `Set<string>` with hardcoded tool names
- `isCompactEligible()` checks against this set
- `ctx.tsx`'s `isToolCompact()` uses the allowlist + display mode

**Design Decision: Dynamic allowlist from MCP metadata**

- MCP tool definitions already have a `metadata` field in the protocol
- Add `compactEligible: true` to MCP tool metadata schema
- At MCP server initialization, scan tool metadata and merge compact-eligible tools into the runtime allowlist
- Implementation:
  1. Extend `compact-allowlist.ts` with a mutable `Set` for dynamic entries
  2. Add `registerCompactTool(name: string)` and `isCompactEligible(name: string)` that checks both sets
  3. In the MCP connection handler (core package), after tool discovery, call `registerCompactTool` for tools with `compactEligible` metadata
  4. The `SessionContext`'s `isToolCompact()` already delegates to `isCompactEligible()` — no context change needed

---

## Design Pattern Decisions

### Dialog Navigation Pattern
All Phase 7 features that add new dialogs follow the existing pattern:
- `DialogSelect` for list views with keyboard navigation
- `dialog.push()` / `dialog.pop()` for stack-based navigation
- Entry via `/command` slash commands AND settings hub entries

### State Persistence Pattern
- **Session-scoped data** (ratings, tags): SDK `session.update()` with metadata fields
- **Global user preferences** (output style, stats prefs): `tui.json` via `useTuiConfig()`
- **Ephemeral data** (output files): `$TMPDIR/liteai-output/`

### Component Size Budget
No single new component should exceed 300 lines. Complex features split into:
- Container component (data fetching, state)
- View component (rendering)
- Utility functions (computation)

---

## Excluded from Phase 7

Per `excluded_features.md`, these will NOT be implemented:
- `/output-style` as a top-level slash command (use settings hub instead)
- `/tag` as a standalone command (integrated into session list dialog)
- Session sharing backend
- Analytics/GrowthBook integration
- Voice mode, Bridge mode, Coordinator

---

## Effort Estimates (Revised)

| # | Feature | Estimate | Complexity |
|---|---|---|---|
| 7.1 | Output File Support | 0.5 day | Low — render-layer change in `tools.tsx` |
| 7.2 | Subagent Hint Suppression | 0 days | Already resolved |
| 7.3 | Agent Management UI | 2.5 days | High — 3 new dialog components + file I/O |
| 7.4 | Advanced Stats | 2 days | Medium — heatmap renderer + data aggregation |
| 7.6 | Session Tagging/Renaming | 1 day | Medium — session list enhancement + tag store |
| 7.7 | Toast Positioning | 0.5 day | Low — layout change |
| 7.8 | Feedback/Survey System | 1.5 days | Medium — new dialog + redaction + file export |
| 7.9 | Output Style Picker | 1 day | Medium — file loader + dialog + core integration |
| 7.10 | MCP Tool Compact Opt-In | 0.5 day | Low — allowlist extension + MCP metadata |
| **Total** | | **9.5 days** | |
