# CLI UI Feature Gap Analysis V2

**LiteAI CLI** (`packages/cli`) vs **Claude Code** (`D:\claude-code`) vs **Gemini CLI** (`D:\gemini-cli`)

> [!NOTE]
> This analysis covers **UI/TUI features only** — components, screens, hooks, keybindings, dialogs, and design system elements. Backend tools and non-UI logic are noted but not deeply analyzed.

### Legend
- 🟢 **Implemented & Architecturally Superior**: LiteAI has achieved feature parity with a cleaner architecture.
- 🟡 **Partially Implemented**: The foundation exists in LiteAI, but needs expansion to reach full feature parity.
- 🔴 **Missing (Feature Gap)**: This feature exists in the reference CLIs but is entirely missing from LiteAI.

---

## Executive Summary

| Metric | LiteAI CLI | Claude Code | Gemini CLI |
|---|---|---|---|
| TUI Components | ~37 files | ~113 files | ~177 files |
| TUI Hooks | 18 | 83 | 147 |
| Slash Commands | ~15 (dialogs) | ~100+ | ~42 commands |
| Keybinding Contexts | Basic | 16 contexts | ~26 Providers/Contexts |
| Design System Elements | 12 | 16 + ThemeProvider | Colors + Semantic UI |
| Screens/Views | 2 dirs (home, session) | 3 (REPL, Doctor, Resume) | ~16 view components |
| State Management | Modular Store Contexts | AppStateStore (Global) | Heavy Context Providers |

---

## 1. Components & Architecture Comparison (Core UX Deep Dive)

Based on direct source-code analysis, **LiteAI has successfully achieved parity with the Core UX rendering engine**, porting the most critical performance optimizations while dramatically improving the architectural boundaries.

### 🟢 The Virtual Message List (`VirtualMessageList`)
- **Claude Code (`VirtualMessageList.tsx` - 1082 lines):** A monolithic implementation that tightly couples the virtual scroll engine (`useVirtualScroll`) with a built-in Regex/`indexOf` search engine (`jumpHandle`, `warmSearchIndex`). It utilizes heavy optimizations, such as caching closures in a `VirtualItem` component to prevent garbage collection churn (~1800 closures/sec) and using `WeakMaps` for sticky prompt text.
- **LiteAI (`virtual-message-list.tsx` - 373 lines):** Successfully ported the underlying `use-virtual-scroll` engine and the critical `VirtualItem` GC optimizations. Crucially, the tightly coupled search mechanics were stripped out. State (like `isSelected`) is strictly delegated to `useMessageCursorContext()`, resulting in a much cleaner, composable architecture.
- **Gemini CLI (`DetailedMessagesDisplay.tsx`):** Avoids raw scroll offsets entirely. It uses a `<ScrollableList>` wrapper that relies on an `estimatedItemHeight` callback (similar to a React Native `FlatList`). While simpler, this approach historically struggles with dynamic terminal text wrapping compared to the offset matrix approach used by Claude/LiteAI.

### 🟢 Scroll Handling (`ScrollKeybindingHandler`)
- **Claude Code (`ScrollKeybindingHandler.tsx`):** A massive ~47k byte file that manages mouse tracking, drag-to-select, wheel acceleration, and keyboard history simultaneously.
- **LiteAI (`scroll-handler.tsx` - 336 lines):** Successfully ported the core "Wheel Acceleration" logic (detecting `xterm.js` via `TERM_PROGRAM` for exponential decay vs. linear ramp in native terminals). It isolates this logic into a standalone component leveraging the modular `useKeybindings` registry, dropping the bloat of drag-to-select logic that belongs in the terminal emulator.

### 🟢 Layout & Main Loop
- **Claude Code (`REPL.tsx` - ~8000 lines):** A massive God-component that handles the entire application lifecycle, routing, and UI rendering in one file.
- **Gemini CLI (`AppContainer.tsx`):** Wraps everything in ~26 nested React Context providers (`KeypressContext`, `TerminalContext`, etc.), passing state down the tree, risking widespread re-renders.
- **LiteAI (`session-layout.tsx` + `prompt/`):** A strictly compositional layout that uses smaller, domain-specific contexts (e.g., `useSync`, `useTheme`, `useMessageCursorContext`).

### 🔴 Missing Specialized Views (Gap Identifiers)
While the Core UX engine is complete, the following specialized views are missing in LiteAI:
1. **Context Visualization:** Claude Code has `ContextVisualization.tsx` (18k bytes) to render a grid of token usage per file/agent.
2. **Log / Rewind Viewer:** Claude and Gemini have dedicated views (`MessageSelector.tsx`, `RewindViewer.tsx`) to navigate previous session states.
3. **Advanced Stats / Usage:** Gemini (`StatsDisplay.tsx`) and Claude (`Stats.tsx`) have robust analytic dashboards. LiteAI has a basic placeholder (`dialog-stats.tsx`).

---

## 2. Hooks & Interaction Layer (Input Productivity Deep Dive)

Based on direct source-code analysis of the autocomplete and typeahead implementations, **LiteAI's architecture is significantly cleaner and more scalable** than Claude Code, though it currently relies on the backend SDK for file resolution rather than local fuzzy caching.

### 🟢 Typeahead & Autocomplete Engines
- **Claude Code (`useTypeahead.tsx` - 1385 lines):** A monolithic God-hook. It handles *everything* in one file: slash commands, file paths, bash shell history completions, agent tagging, and Slack channels. It relies on complex inline regex (with Unicode character classes) and manual debounce loops. Because it runs background cache-warming directly in the UI thread, it is heavily reliant on refs and scattered `useState` calls to prevent blocking the render loop.
- **Gemini CLI (`useAtCompletion.ts` - 480 lines):** Separates concerns. `useAtCompletion` only handles `@` tokens, utilizing a strict `useReducer` state machine (`INITIALIZING`, `SEARCHING`, `READY`). It instantiates native `FileSearchFactory` watchers and uses `AsyncFzf` for local fuzzy finding of agents/resources. It is robust but highly complex due to managing file system watchers inside the UI layer.
- **LiteAI (`use-at-completer.ts` - 190 lines):** Highly focused and architecturally distinct. It uses a clean `useReducer` like Gemini, but **offloads file search entirely to the backend SDK** (`sdk.project.find.files`). This keeps the TUI completely stateless regarding the file system. For agents and resources, it uses local `fuzzysort`. Token extraction is correctly abstracted to a dedicated utility (`extractAtToken`), avoiding Claude's inline regex nightmare.

### 🟡 Input & Shell Handling
- **Claude Code (`useVimInput.ts` & `useTextInput.ts`):** 25k+ bytes of logic handling text selection, clipboard formats, and vim motions manually integrated into the TUI.
- **Gemini CLI (`vim.ts` - 49k bytes):** An extremely heavy, standalone Vim emulator built into the CLI input layer.
- **LiteAI (`use-vim-input.ts` & `use-text-input.ts`):** You have ported the critical text manipulation routines, but the gap here remains around advanced shell completions (e.g., parsing Bash AST to suggest command flags), which Claude Code implements heavily.

### 🔴 Missing Productivity Hooks (Gap Identifiers)
1. **Background Tasks UI:** Claude Code has `useInboxPoller.ts` (34k bytes) to fetch and sync background agent tasks. LiteAI is missing background task visualization.
2. **Bash/Shell Completion:** Claude Code connects directly to shell completion APIs to suggest flags (`-rf`) and environment variables inside the prompt.
3. **Session Bridge:** Gemini uses `useGeminiStream.ts` (70k bytes) for SSE event handling; LiteAI's `use-queue-processor.ts` is lean but may need expansion for complex multi-agent streaming events.

---

## 3. Session Context & Token Tracking (Deep Dive)

Based on direct source-code analysis of the token tracking and context visualization systems, **LiteAI possesses a superior data aggregation layer but severely lacks the visualization UI found in Claude Code.**

### 🟢 The Token Data Aggregation Layer
- **LiteAI (`use-session-stats.ts` - 242 lines):** Calculates tokens flawlessly at the source. It subscribes directly to the SDK SSE event stream (`sdk.event.on`) to aggregate input, output, reasoning, and cache read/write tokens in real-time. It effortlessly handles complex multi-model sessions via a `perModel` map.
- **LiteAI (`status-line.tsx` - 140 lines):** An elegant, priority-based UI that gracefully drops segments (e.g., Git Diff, CWD, Token Count) right-to-left as terminal width decreases, ensuring the most critical data (Model, Context %) remains visible.

### 🔴 Context Visualization (The Major Gap)
- **Claude Code (`ContextVisualization.tsx` - 489 lines):** Features a highly advanced UI that renders a literal "disk defragmenter" grid showing exactly how tokens are distributed. It breaks down context across granular categories: `memoryFiles`, `mcpTools`, `systemPromptSections`, `agents`, `skills`, and provides deep analytics on `messageBreakdown` (tool calls vs. attachments vs. user messages).
- **Gemini CLI (`ContextUsageDisplay.tsx` / `ContextSummaryDisplay.tsx`):** Very basic. It shows a simple percentage ("45% used") and text summaries ("3 open files · 1 MCP server").
- **LiteAI Gap:** While LiteAI calculates total context percentages accurately, it provides **zero UI** for the user to understand *what* is consuming their context window. A port of Claude's grid-based `ContextVisualization` is highly recommended.

---

## 4. Log & Rewind Viewers (Deep Dive)

Based on source-code analysis of the session history mechanics, **LiteAI lacks any time-travel or historical navigation capabilities**, representing a significant functional gap for long-lived sessions.

### 🟢 Time-Travel Debugging (Claude Code)
- **Claude Code (`MessageSelector.tsx` - 831 lines):** Acts as a time-machine. When scrolling back through messages, it deeply integrates with a `fileHistory` system to compute exact `DiffStats`. It tells the user exactly which files, insertions, and deletions will be reverted if they rewind. It offers complex actions: "Restore Code & Conversation", "Restore Conversation Only", or "Summarize from here".
- **Claude Code (`LogSelector.tsx` - 1575 lines):** A massive cross-session browser. It supports "Deep Search" (using `fuse.js` to search transcripts across all historical sessions), filters by git branch, and visualizes tree forks where sidechain sessions split from main sessions.

### 🟡 Basic Rewind (Gemini CLI)
- **Gemini CLI (`RewindViewer.tsx` - 335 lines):** A cleaner, simpler implementation. It uses a `BaseSelectionList` to let users jump back to previous prompts. It calculates file change diffs to warn the user about what code is being reverted, but lacks the complex "partial restore" or "summarization" options found in Claude.

### 🔴 LiteAI Implementation Gap
- **LiteAI (`N/A`):** There is currently no UI for navigating historical messages (`/rewind`) or browsing past sessions (`/history`). This is a critical roadmap item to achieve parity.

---

## 5. Slash Commands

**Gemini CLI** features ~42 slash commands in `src/ui/commands`.
**Claude Code** has 100+ command permutations.
**LiteAI CLI** currently has ~15 mapped mostly to dialogs.

### Missing/Discrepancy Matrix

| Command | Claude Code | Gemini CLI | LiteAI (Status) |
|---|---|---|---|
| `/compact` / `/compress` | ✅ | ✅ | ❌ Missing |
| `/cost` / `/stats` | ✅ | ✅ | ✅ Dialog (`/stats`) |
| `/diff` / `/docs` | ✅ | ✅ | ❌ Missing |
| `/doctor` / `/bug` | ✅ | ✅ | ❌ Missing |
| `/feedback` | ✅ | ❌ | ❌ Missing |
| `/help` | ✅ | ✅ | ❌ Missing |
| `/history` / `/rewind` | ✅ | ✅ | ❌ Missing |
| `/memory` / `/skills` | ✅ | ✅ | ✅ Dialog (`/skill`) |
| `/permissions` / `/policies` | ✅ | ✅ | ❌ Missing |
| `/plan` | ✅ | ✅ | ❌ Missing |

---

## 6. State Management & Architecture Notes

### Gemini CLI Context Density
Gemini CLI relies heavily on React Context Providers (26+). Key examples:
- `KeypressContext.tsx` (25k)
- `ScrollProvider.tsx` (13k)
- `MouseContext.tsx`, `TerminalContext.tsx`, `SessionContext.tsx`
- **Impact**: High coupling, potential for widespread re-renders if contexts aren't carefully memoized.

### Claude Code Centralization
Claude Code uses a monolithic `AppStateStore` paired with huge localized hooks (e.g., `useTypeahead.tsx` at 61k, `REPL.tsx` at 258k).
- **Impact**: Very difficult to refactor without breaking unrelated systems.

### LiteAI Modular Approach
LiteAI CLI uses separated, smaller context stores and highly granular hooks (`use-text-input.ts`, `use-virtual-scroll.ts`).
- **Opportunity**: Keep architectural boundaries clean while addressing feature gaps (e.g., extracting typeahead logic into modular hooks instead of 60k line monolithic files).

---

## 5. Implementation Priorities (Updated Roadmap)

### Phase 1 — Core Parity
1. **Context Visualization & Tokens**: Add robust token visualization to status lines or context dialogs.
2. **Log/Rewind Viewer**: Implement session navigation comparable to `SessionBrowser`/`RewindViewer`.
3. **Advanced Completion Rules**: Deepen `@` completion to match `useAtCompletion.ts`/`useTypeahead.tsx` robustness.

### Phase 2 — Productivity Features
4. **Agent & MCP Management**: Advanced UI for agents and remote environments.
5. **Background Tasks UI**: Better polling and synchronization feedback (`useInboxPoller` equivalent).
6. **Robust Keyboard Layer**: Fill gaps in keybindings, particularly for dialogs and scroll bounds.
