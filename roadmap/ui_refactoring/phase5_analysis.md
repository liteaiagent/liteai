# Phase 5 — Display Density & Productivity: Analysis & Design Decisions

> Source audit date: 2026-05-02  
> References: `D:\claude-code`, `D:\gemini-cli`, `d:\liteai\packages\cli`

---

## 5.0 — Collapsed Read/Search Groups

### Competitive Analysis

**Claude Code** — The gold standard. ~1100-line `collapseReadSearch.ts` with:
- A `GroupAccumulator` type tracking: `searchCount`, `readFilePaths` (Set), `readOperationCount`, `listCount`, `memorySearchCount`, `memoryWriteCount`, `mcpCallCount`, `bashCount`, `commits/pushes/branches/prs`, hook timing, and a `latestDisplayHint`.
- Per-tool `isSearchOrReadCommand()` method on each Tool — the tool itself decides if it's collapsible.
- Groups break on: assistant text, non-collapsible tool use, user messages. Thinking blocks, attachments, system messages skip (don't break).
- Result is a `collapsed_read_search` virtual message type with aggregate counts.
- Renderer shows: `→ Read 5 files, Searched 3 patterns` one-liner in compact mode, full list in verbose mode.
- Click-to-expand toggles verbose for the group.

**Gemini CLI** — No collapsed groups. Each tool renders independently.

### Design Decision: Simplified Group-Based Approach

Claude's implementation is over-engineered for our needs (memory file tracking, team memory, git operation tracking, fullscreen mode branches). We adopt the **core grouping algorithm** without the domain-specific extensions.

**Architecture:**
- New utility: `collapse-tool-groups.ts` — pure function `(messages, toolRegistry) → messages` where consecutive collapsible tool calls are merged into a `CollapsedGroupMessage` virtual type.
- The tool registry (`PART_MAPPING` / tool name) provides a `isCollapsible(toolName): boolean` — a static set, not per-tool methods.
- Group breaks on: text parts, non-collapsible tool parts, assistant messages with text content.
- The `CollapsedGroupMessage` carries: `readCount`, `searchCount`, `listCount`, `messages[]`, `filePaths[]`, `searchPatterns[]`.

**Collapsible tools:** `read`, `grep`, `glob`, `list`, `codesearch`, `websearch`, `webfetch`.

**Non-collapsible tools:** `write`, `edit`, `apply_patch`, `run_command`, `task`, `todowrite`, `ask_user`, `skill`, `command_status`, `send_command_input`, and all unknown/MCP tools.

### UX Impact: Simplified vs Claude's Full Collapsed Groups

Claude's `GroupAccumulator` tracks ~15 separate counters including git commits/pushes/branches/PRs, memory reads/writes, hook timings, and MCP call counts. This produces summary lines like:

```
→ Read 5 files, Searched 3 patterns, 2 git commits, 1 memory write (4.2s)
```

Our simplified version omits git and memory tracking. The UX implications:

| Scenario | Claude Code | LiteAI (Simplified) | Impact |
|---|---|---|---|
| 5 consecutive `read` + `grep` calls | `→ Read 3 files, Searched 2 patterns` | Same | ✅ Identical |
| `read` → `read` → `run_command(git commit)` → `read` | Single collapsed group with git counter | **Two separate groups** — the `run_command` breaks the sequence | ⚠️ Slightly noisier — 3 lines vs 1. But accurate: git is a side-effect, NOT a read. |
| `read` → `memory_write` → `grep` | Single collapsed group with memory counter | **Two separate groups** OR three individual lines | ⚠️ Noisier. But memory tools are rare in practice. |
| Unknown MCP tool interleaved | Collapsed with `mcpCallCount` | Group breaks, MCP renders verbose | ✅ Safer — unknown tools should be visible. |

**Key insight:** Claude's approach treats git/memory as "passive" operations that don't break visual flow. Our approach treats them as first-class operations that deserve visibility. For a developer-facing tool, the latter is arguably better — you _want_ to see when a git commit happened.

**Future extensibility:** When we add memory tools (planned) and if git operations become collapsible, the `COLLAPSIBLE_TOOLS` set can be extended trivially. The architecture supports it without redesign.

**Why not per-tool methods?** LiteAI's tool rendering is in `tools.tsx` with simple switch-case dispatch. Adding an `isCollapsible` method to every tool definition in `@liteai/core` is cross-package coupling for a purely presentational concern. A static allowlist in the CLI package is simpler and more maintainable.

---

## 5.1 — Inline Diff Preview

### Competitive Analysis

**Gemini CLI** — Clean implementation in `DenseToolMessage.tsx`:
- `COMPACT_TOOL_SUBVIEW_MAX_LINES = 15` constant.
- When a compact edit/write tool has a diff payload, shows it inside a bordered `ScrollableList` with max height = min(diffLines, 15) + 2.
- Uses `parseDiffWithLineNumbers()` → `renderDiffLines()` to produce colored React nodes.
- Click toggles expansion (uses `useToolActions` context with `isExpanded`/`toggleExpansion`).
- Only shows in alternate buffer mode (fullscreen).

**Claude Code** — Zero diff lines in compact mode. Stats only.

### Design Decision: Adapt Gemini's Scrollable Preview

LiteAI already has `StructuredDiff` component and diff parsing. We extend the compact view to show N lines of diff inline.

**Architecture:**
- New constant: `COMPACT_DIFF_MAX_LINES = 15` in `constants/`.
- In `Edit`/`Write`/`ApplyPatch` tool renderers: when `!ctx.showDetails` (compact mode) AND diff is present, show the InlineTool one-liner PLUS a truncated `StructuredDiff` capped at `COMPACT_DIFF_MAX_LINES`.
- No ScrollableList needed — our `StructuredDiff` already handles line capping. We simply slice the diff string to N lines and append `… (N more lines)`.

**Why not a scrollable list?** Gemini's `ScrollableList` requires focus management and mouse tracking. Our `StructuredDiff` is simpler and already handles the rendering. A static preview with "ctrl+o for full" is sufficient.

---

## 5.2 — Per-Message Expand/Collapse

### Competitive Analysis

**Claude Code** — Implemented via:
- `expandedKeys: ReadonlySet<string>` state in `Messages.tsx` (the parent).
- `onItemClick` callback toggles keys in the set. Key = `tool_use_id` or `uuid`.
- `isItemExpanded(msg) → boolean` callback checked per message.
- The `verbose` prop OR'd with `isItemExpanded(msg)` on `MessageRow`.
- `isItemClickable(msg) → boolean` limits expand to `collapsed_read_search` and truncated tool results.
- VirtualMessageList gets `onItemClick`, `isItemClickable`, `isItemExpanded`.

**Gemini CLI** — No per-message expand. Config-only density.

### Design Decision: Cursor-Based Expand with OR'd ShowDetails

LiteAI already has `useMessageCursor` with cursor navigation. We extend it.

**Architecture:**
- New field in message cursor state: `expandedIds: Set<string>` (part IDs or message IDs).
- The `messageActions:primary` (Enter) action on a tool message toggles its ID in `expandedIds`.
- In the `SessionContext`, `showDetails` becomes: `displayMode === 'transcript' || expandedIds.has(currentPartId)`.
- Each `ToolPartView` receives a `forceExpand?: boolean` prop derived from the expanded set.
- The `VirtualMessageList` propagates `expandedIds` to per-message rendering.

**Why cursor-based instead of click-based?** LiteAI's TUI runs in a non-alternate-screen mode by default — mouse events are unreliable without alternate screen. The cursor (keyboard) approach is more robust and already proven. If alternate-screen mode is active, click passthrough can be added later.

---

## 5.3 — Hide Past Thinking

### Competitive Analysis

**Claude Code** — Implemented via:
- `lastThinkingBlockId` computed in `Messages.tsx`: scans messages backwards to find the last `thinking` block. Returns `uuid:contentIndex` string.
- When streaming thinking is active, returns `'streaming'` to hide all completed blocks.
- `hideInTranscript` prop on `AssistantThinkingMessage`: when true, returns `null`.
- `MessageRow` compares each thinking block's `uuid:index` against `lastThinkingBlockId`.
- Only the LATEST thinking block is visible; all prior ones are hidden.

**Gemini CLI** — Shows all thinking blocks.

### Design Decision: Sentinel-Based Last-Thinking Tracking

**Architecture:**
- New computed value in message rendering pipeline: `lastReasoningPartId` — scans parts backwards for the last `reasoning` type part.
- In `ReasoningPartView`, a new prop `hideAsPast: boolean`. When true, returns null.
- The scan runs in the session route's message rendering loop (not a hook — it's a pure computation over the parts array).
- During streaming, when the current message is actively producing reasoning, ALL completed reasoning parts are hidden (the streaming one is the "latest").

**Why not a hook?** This is a pure derivation from `sync.message` + `sync.part`. A `useMemo` in the session route that produces a `lastReasoningId: string | null` is simpler than a dedicated hook.

---

## 5.4 — Compact Tool Allowlist

### Competitive Analysis

**Gemini CLI** — Clean implementation in `ToolGroupMessage.tsx`:
```typescript
const COMPACT_OUTPUT_ALLOWLIST = new Set([
  EDIT_DISPLAY_NAME, GLOB_DISPLAY_NAME, WEB_SEARCH_DISPLAY_NAME,
  READ_FILE_DISPLAY_NAME, LS_DISPLAY_NAME, GREP_DISPLAY_NAME,
  WEB_FETCH_DISPLAY_NAME, WRITE_FILE_DISPLAY_NAME, READ_MANY_FILES_DISPLAY_NAME,
]);
```
- `isCompactTool(tool, isCompactModeEnabled)` checks: mode enabled AND tool in allowlist AND not confirming.
- Unknown tools and MCP tools always render verbose — safer default.

**Claude Code** — Implicit per-tool verbose flags. No explicit allowlist.

### Design Decision: Explicit Allowlist in SessionContext

**Architecture:**
- New constant: `COMPACT_TOOL_ALLOWLIST: ReadonlySet<string>` in `tools.tsx` or `constants/`.
- Members: `read`, `grep`, `glob`, `list`, `codesearch`, `websearch`, `webfetch`, `write`, `edit`, `apply_patch`.
- Non-members (always verbose): `run_command`, `task`, `ask_user`, `todowrite`, `skill`, `command_status`, `send_command_input`, and any unknown/MCP tool name.
- `showDetails` logic changes from `displayMode === 'transcript'` to: `displayMode === 'transcript' || !COMPACT_TOOL_ALLOWLIST.has(toolName)`.

**Why a static set?** It's the simplest, most maintainable approach. If MCP tools want to opt into compact, they can be added to the set via configuration later (Phase 7 scope).

---

## 5.5 — External Editor

### Competitive Analysis

**Claude Code** — Full implementation in `promptEditor.ts` + `editor.ts`:
- `getExternalEditor()`: checks `$VISUAL` → `$EDITOR` → platform-specific fallback (Windows: `start /wait notepad`, others: search `code` → `vi` → `nano`).
- `classifyGuiEditor(editor)`: identifies GUI editors (code, subl, atom, etc.) vs terminal editors (vim, nano, etc.).
- GUI editors: spawn detached, Ink pauses + suspends stdin.
- Terminal editors: `enterAlternateScreen()` → `spawnSync` → `exitAlternateScreen()`.
- `editPromptInEditor(currentPrompt, pastedContents)`: writes current prompt to temp file, opens editor, reads result back, re-collapses pasted content references.
- Keybinding: `ctrl+x ctrl+e` (registered in their keybinding system).

**Gemini CLI** — No external editor support.

### Design Decision: Port Claude's Two-Path Architecture

LiteAI's `@liteai/ink` already has `enterAlternateScreen()` / `exitAlternateScreen()` on the Ink instance. We need:

**Architecture:**
- New utility: `editor.ts` in `tui/util/`:
  - `getExternalEditor(): string | undefined` — `$VISUAL` → `$EDITOR` → platform fallback.
  - `classifyGuiEditor(editor): string | undefined` — GUI vs terminal classification.
  - `editPromptInEditor(currentPrompt: string): { content: string | null; error?: string }` — temp file → editor → read back.
- Integration in `prompt-input.tsx`:
  - The `chat:externalEditor` keybinding (already registered as `ctrl+x ctrl+e` and `ctrl+g`) calls `editPromptInEditor(input)`.
  - On success, sets input to the edited content.
  - GUI editors: `ink.pause()` + `ink.suspendStdin()` → spawn → resume.
  - Terminal editors: `ink.enterAlternateScreen()` → `spawnSync` → `ink.exitAlternateScreen()`.

**Ink instance access:** The Ink instance is available via the internal instances map. We need to expose a hook or utility to access `pause/resume/suspendStdin/resumeStdin/enterAlternateScreen/exitAlternateScreen`.

**Open question:** LiteAI's ink fork — does it expose `pause()`/`resume()`/`suspendStdin()`/`resumeStdin()` on the instance? Need to verify. If not, we need to add them.

---

## 5.6 — Prompt Stash

### Competitive Analysis

**Claude Code** — `hasUsedStash` config flag exists, but the actual stash implementation is integrated into the prompt input state management. The `ctrl+s` keybinding saves current prompt text; restoring happens on view switch or dialog close.

### Design Decision: Simple Save/Restore Buffer

**Architecture:**
- New ref in `prompt-input.tsx`: `stashRef = useRef<string | null>(null)`.
- `chat:stash` keybinding handler (already registered as `ctrl+s`):
  - If input is non-empty AND stash is null: save input → stashRef, clear input.
  - If stash is non-null: restore stash → input, clear stashRef.
  - If input is non-empty AND stash is non-null: swap (current → stash, stash → input).
- On dialog open/close: no auto-stash. The user explicitly controls it.
- Toast notification: "Prompt stashed" / "Prompt restored" via the existing toast system.

**Why not auto-stash?** Claude's auto-stash on view switch adds complexity (what if the user navigated away intentionally?). Explicit `ctrl+s` is simpler and more predictable.

---

## 5.7 — Permission Mode Cycling

### Competitive Analysis

Both CLIs provide ways to change permission modes during permission prompts.

**Claude Code** — In permission prompts, users can switch between `auto-accept` / `confirm` / etc. modes inline.

### Design Decision: Already Implemented

Per the feature status doc, Permission Mode Cycling is marked as ✅ in `default-bindings.ts` (`shift+tab` → `confirm:cycleMode`). **No work needed here.**

---

## Summary of Design Patterns

| Feature | Pattern | Complexity |
|---|---|---|
| 5.0 Collapsed Groups | Pure-function message transform | High (new virtual message type) |
| 5.1 Inline Diff Preview | Component enhancement | Low (extend existing renderers) |
| 5.2 Per-Message Expand | State extension on cursor | Medium (cross-cutting concern) |
| 5.3 Hide Past Thinking | Computed derivation + prop drilling | Low |
| 5.4 Compact Allowlist | Static constant + guard check | Low |
| 5.5 External Editor | New utility + Ink instance integration | High (cross-package) |
| 5.6 Prompt Stash | Ref-based state in prompt-input | Low |
| 5.7 Permission Cycling | Already implemented | None |

## Resolved Questions

### 1. Ink Instance API Surface ✅ RESOLVED

`@liteai/ink` has **all required methods** on the `Ink` class (`ink.tsx`):

| Method | Line | Status |
|---|---|---|
| `pause()` | L869 | ✅ Flushes pending React updates, sets `isPaused = true` |
| `resume()` | L878 | ✅ Sets `isPaused = false`, triggers `onRender()` |
| `suspendStdin()` | L1464 | ✅ Stores and removes all `readable` listeners, disables raw mode |
| `resumeStdin()` | L1495 | ✅ Re-attaches stored listeners, re-enables raw mode |
| `enterAlternateScreen()` | L435 | ✅ Pauses + suspends stdin + enters alt screen + disables kitty keyboard |
| `exitAlternateScreen()` | L466 | ✅ Resumes stdin + exits alt screen + re-enables extended keys |
| `repaint()` | L888 | ✅ Resets frame buffers for full repaint |

**Access path:** `AppContext` exposes `suspend` and `resume` via `useApp()` hook. However, `suspend` uses SIGSTOP (Unix process suspension), not editor handoff. For external editor (5.5), we need `enterAlternateScreen/exitAlternateScreen` from the `Ink` class directly.

**Resolution:** The `Ink` instance is accessible via `instances.get(process.stdout)` (from `instances.ts`). This is the same pattern Claude Code uses. We'll create a `useInkInstance()` hook that wraps this access, or access it directly from a synchronous helper function since `editPromptInEditor` is necessarily synchronous (it blocks on `spawnSync`).

### 2. Collapse Transform Location ✅ RESOLVED

**Decision: Session route (`useMemo`), NOT VirtualMessageList.**

| Criterion | Session Route (Early) | VirtualMessageList (Late) |
|---|---|---|
| **Re-computation trigger** | Only when messages/parts change | Every scroll, resize, render |
| **Performance** | O(n) once per data change | O(n) per frame — unacceptable for long sessions |
| **Separation of concerns** | Data transform stays in data layer | Rendering layer owns data transforms — blurs responsibilities |
| **Expand/collapse state** | Trivially integrated with `expandedIds` in session context | Would need upward state propagation |
| **Height cache** | Collapsed group = 1 cached height entry | VML would need to re-measure on every collapse/expand |
| **Integration with 5.2** | `expandedIds.has(groupId)` → skip collapse for that group | Would need bidirectional state flow |

**UI/UX impact of the choice:** The user sees identical output either way. The difference is purely performance. Session-route placement means collapsed groups are computed once and cached — scroll performance is unaffected. VML placement would recompute on every scroll tick in a 500+ message session.

Claude does it "late" (in `Messages.tsx` which is equivalent to our session route — above VirtualMessageList), not inside VML itself. Our approach matches.

### 3. MCP Tool Compact Opt-In → Deferred to Phase 7

Added as [roadmap item 7.10](file:///d:/liteai/roadmap/ui_refactoring/roadmap.md). MCP servers will declare compact eligibility via manifest metadata, extending the static `COMPACT_TOOL_ALLOWLIST`.
