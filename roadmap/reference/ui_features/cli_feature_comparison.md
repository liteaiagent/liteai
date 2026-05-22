# CLI Feature Comparison: LiteAI vs Claude Code vs Gemini CLI

High-level feature-by-feature comparison based on direct source code audit of `D:\claude-code` and `D:\gemini-cli`.

---

## Architecture

| Aspect | LiteAI | Claude Code | Gemini CLI |
|---|---|---|---|
| **Main loop** | Compositional layout (`session-layout.tsx` + `prompt/`) | Monolithic `REPL.tsx` (~258KB) | 26+ nested Context Providers (`AppContainer.tsx`) |
| **State management** | Modular stores (Zustand + Context) | Monolithic `AppStateStore` (21KB) | Heavy Context Providers |
| **Hook count** | 18 focused | 83 monolithic | 147 |
| **Component count** | ~39 + 12 design-system | ~113 | ~177 |

---

## Core UX Engine

| Feature | LiteAI | Claude Code | Gemini CLI |
|---|---|---|---|
| **Virtual message list** | ✅ `VirtualItem` GC-optimized, search decoupled | ✅ Tightly coupled scroll + search | ✅ `ScrollableList` (estimated height) |
| **Scroll handling** | ✅ Wheel acceleration, xterm.js detection | ✅ + mouse tracking, drag-to-select | Basic scroll provider |
| **Message rendering** | ✅ Parts-based with cursor mode | ✅ Rich with tool output, attachments | ✅ History item display |
| **Layout** | ✅ Compositional, domain-specific contexts | Monolithic REPL | 26 nested providers |

---

## Display Density & Transcript Mode

| Feature | LiteAI | Claude Code | Gemini CLI |
|---|---|---|---|
| **Default view** | Compact (one-liner tools) | Compact (non-verbose) | Compact (`compactToolOutput: true`) |
| **Runtime toggle** | ✅ `ctrl+o` | ✅ `ctrl+o` | ❌ Config-only (requires restart) |
| **Mode indicator** | ✅ StatusLine segment | Footer hint | None |
| **Transcript modality** | **Non-modal** (prompt stays active) | **Modal** (swaps entire screen) | N/A |
| **Thinking in compact** | `▼ Thinking (N tokens)` + first-sentence title | Hidden entirely | `subject` line only |
| **Thinking in transcript** | Full text (all blocks) | Full text (last block only) | Full text with left border |
| **Token count on thinking** | ✅ Yes | ❌ No | ❌ No |
| **Per-message expand** | ❌ Not yet | ✅ Click/cursor to expand individual messages | ❌ |
| **Collapsed read/search groups** | ❌ Not yet | ✅ `collapsed_read_search` message type | ❌ |
| **Compact tool allowlist** | ❌ Uniform (all tools compacted) | Implicit (per-tool verbose flag) | ✅ Explicit `COMPACT_OUTPUT_ALLOWLIST` |
| **Inline diff preview** | Zero lines (stats only) | Zero lines (stats only) | ✅ Scrollable preview (max 15 lines) |
| **Show-all toggle** | ✅ `ctrl+e` | ✅ `ctrl+e` | N/A |
| **Transcript exit** | `q` / `esc` / `ctrl+c` | `q` / `esc` / `ctrl+c` | N/A |
| **Hide past thinking** | ❌ Not yet | ✅ Only shows latest block | ❌ |
| **Output file fallback** | ❌ | ❌ | ✅ `(Output saved to: path)` |
| **Error verbosity** | Always verbose | Always verbose | ✅ `errorVerbosity: 'low' | 'full'` |

---

## Tool Output (Compact Mode)

| Tool | LiteAI | Claude Code | Gemini CLI |
|---|---|---|---|
| **Read file** | `→ Read src/index.ts` | `→ Read src/index.ts` | One-liner with path |
| **Write file** | `← Wrote src/index.ts` | `← Write src/index.ts` | `✏ Write file.ts` + diff stats |
| **Edit file** | `← Edit src/index.ts +5/-3` | `← Edit src/index.ts` | `✏ Edit file.ts` + max 15 diff lines |
| **Run command** | `$ Ran bun typecheck` (zero output) | `$ bun typecheck` (zero output) | Bordered block, scrollable |
| **Grep** | `✱ Grep "pattern" (7 matches)` | `Grep "pattern" (7 matches)` | One-liner with count |
| **Subagent** | `│ Task (N toolcalls)` | One-line + `ctrl+o` hint | Collapsed group with spinner |

---

## Input Productivity

| Feature | LiteAI | Claude Code | Gemini CLI |
|---|---|---|---|
| **@ completion** | ✅ Files (via SDK), agents, resources | ✅ Files (client-side cache), agents, channels | ✅ Files (client-side `AsyncFzf`), agents |
| **Slash commands** | ~17 (dialogs) | ~100+ | ~42 |
| **Message queue** | ✅ `useSyncExternalStore` pattern | ✅ Queue manager | ✅ |
| **History search** | ✅ `ctrl+r` with cross-session sqlite + fuzzysort | ✅ `ctrl+r` fuzzy | ❌ |
| **Vim mode** | ✅ Core motions | ✅ Full motions + text objects | ✅ 49KB standalone emulator |
| **External editor** | Keybinding exists, no handler | ✅ `$EDITOR` spawn | ❌ |
| **Prompt stash** | ❌ | ✅ Save/restore on view switch | ❌ |
| **Bash completion** | ❌ | ✅ Shell flag suggestions | ❌ |

---

## Keybindings

| Aspect | LiteAI | Claude Code | Gemini CLI |
|---|---|---|---|
| **Total contexts** | 19 | 20 | ~26 providers |
| **User customization** | ✅ `tui.json` | ✅ JSON overrides | ❌ |
| **Chord support** | ✅ `ctrl+x` prefix (Emacs-style) | ❌ | ❌ |
| **Conflict detection** | ✅ Validation layer | ✅ | ❌ |
| **Global search** | ❌ | ✅ `ctrl+shift+f` | ❌ |
| **Quick open** | ❌ | ✅ `ctrl+shift+p` | ❌ |

---

## Session & Token Management

| Feature | LiteAI | Claude Code | Gemini CLI |
|---|---|---|---|
| **Token tracking** | ✅ Real-time SSE, per-model breakdown | ✅ | ✅ |
| **Context visualization** | ✅ Bar + % + category grid dialog | ✅ Defragmenter-style grid | Basic text percentage |
| **Auto-compact** | ✅ 80% threshold + circuit breaker | ✅ Dynamic ~93% + circuit breaker | ✅ 50% default |
| **Manual compact** | ✅ `/compact` | ✅ `/compact` | ✅ `/compress` |
| **Rewind viewer** | ✅ Per-turn DiffStats, restore options | ✅ Full time-travel + cross-session search | ✅ Jump to prompts |
| **Session browser** | ✅ AI descriptions, archive, branch | ✅ Deep search, git branch filter, fork tree | ✅ Session browser |
| **Output style** | ❌ | ✅ Named styles + picker | ❌ |

---

## Search

| Feature | LiteAI | Claude Code | Gemini CLI |
|---|---|---|---|
| **Transcript search** | ❌ | ✅ In-memory with DOM scanning + highlights | ❌ |
| **Global file search** | ❌ | ✅ Ripgrep + preview pane | ❌ |
| **Cross-session search** | ❌ | ✅ fuse.js across all sessions | ❌ |

---

## Where Each CLI Excels

| Strength | Winner | Why |
|---|---|---|
| **Architecture** | LiteAI | Modular vs. monolithic; clean hook boundaries |
| **Runtime density toggle** | LiteAI ≈ Claude | Both have `ctrl+o`; Gemini requires config edit |
| **Non-modal transcript** | LiteAI | Prompt stays active during expanded view |
| **Thinking titles** | LiteAI | First-sentence heuristic + token count; unique feature |
| **Per-message expand** | Claude | Click/cursor individual messages; granular control |
| **Read/search collapse** | Claude | 10+ reads become one summary line |
| **Inline diff preview** | Gemini | 15-line scrollable diff in compact mode |
| **Search** | Claude | Full transcript + workspace + cross-session search |
| **Compact allowlist** | Gemini | Unknown tools default to verbose; safer policy |
| **Error verbosity** | Gemini | Separate control for error detail level |
| **Chord keybindings** | LiteAI | `ctrl+x {key}` namespace; Claude/Gemini lack chords |
