# Phase 3.3: Input Productivity

> **Status**: ✅ Complete
> **Completed**: 2026-05-01
> **Dependencies**: None
> **Scope**: @ completion (file/agent/resource), submit-time @ content injection, message queuing

---

## Goal

Maximize input efficiency with autocomplete, file path completion, @ mentions for context injection, and message queuing for uninterrupted workflows.

---

## Architecture & Design Decisions

Full ADR documentation: [phase_3.3_design_decisions.md](file:///d:/liteai/roadmap/ui_refactoring/phase_3.3_design_decisions.md)

| Decision | Pattern Chosen | Rationale |
|----------|---------------|-----------|
| ADR-1: @ Completion Hook | Separate modular hook (Gemini pattern) | Keeps `use-at-completer.ts` isolated from existing `/command` system |
| ADR-2: File Search | SDK-routed (no client-side index) | Reuses `@liteai/core` `File.search()` via `GET /project/{id}/find/file` |
| ADR-3: Message Queue | Module-level store + `useSyncExternalStore` (Claude pattern) | Immediate mutation visibility, zero React batching delay |
| ADR-4: Submit-Time @ Processing | Client-side preprocessor | `@` is a UI convention, not a protocol concept — keeps core clean |

---

## Implementation Summary

### Component 1: @ Token Extraction (Pure Functions)

**File**: [`at-token.ts`](file:///d:/liteai/packages/cli/src/tui/components/prompt/utils/at-token.ts) — 177 LOC

- `extractAtToken(input, cursorOffset)` — cursor-aware backward scan for `@`, supports quoted paths (`@"my file"`)
- `applyAtCompletion(input, cursorOffset, token, replacement, isDirectory)` — text replacement with auto-quoting for spaces, `/` append for directories
- `parseAtReferences(input)` — global regex scan for submit-time reference extraction

### Component 2: @ Completion Hook

**File**: [`use-at-completer.ts`](file:///d:/liteai/packages/cli/src/tui/hooks/use-at-completer.ts) — 190 LOC

- `useReducer` state machine (`idle` → `searching` → `ready` | `error`)
- 100ms debounce via `setTimeout` + `AbortController` for stale request cancellation
- Three search sources: SDK file search, local agent fuzzysort, local MCP resource fuzzysort
- Returns `{ active, items, isLoading, token }`

### Component 3: @ Submit-Time Processor

**File**: [`at-processor.ts`](file:///d:/liteai/packages/cli/src/tui/components/prompt/utils/at-processor.ts) — 77 LOC

- `processAtReferences()` — categorizes refs as file or agent, reads files in parallel via `sdk.project.file.read()`
- Constructs `[Reference Content Start/End]` blocks appended to user text
- Agent references generate `<system_note>` delegation nudges

### Component 4: PromptInput Integration

**File**: [`prompt-input.tsx`](file:///d:/liteai/packages/cli/src/tui/components/prompt/prompt-input.tsx) — 767 LOC total

All 9 integration steps completed:
1. ✅ Imports wired (lines 71–76)
2. ✅ `useAtCompleter` hook called with proper guards (lines 149–157)
3. ✅ `atSelectedIndex` state with reset on items change (lines 159–162)
4. ✅ Up/Down navigation extended for @ suggestions (lines 248–270)
5. ✅ Tab handler extended — @ completion priority > command suggestions > ghost text (lines 636–679)
6. ✅ Enter/Submit — @ completion apply on active (lines 311–325), queue enqueue on loading (lines 416–422), `processAtReferences` before submit (lines 427–438)
7. ✅ Ctrl+C — queue clear with early return (lines 578–583)
8. ✅ `<QueuedMessageDisplay />` rendered above prompt border (line 721)
9. ✅ @ suggestions passed to footer: `atSuggestions`, `atSelectedIndex`, `atIsLoading` (lines 758–760)

### Component 5: Message Queue Store

**File**: [`message-queue-store.ts`](file:///d:/liteai/packages/cli/src/tui/stores/message-queue-store.ts) — 65 LOC

- Module-level singleton FIFO queue with `useSyncExternalStore` interface
- API: `enqueue()`, `dequeueAll()`, `clear()`, `peek()`, `isEmpty()`, `subscribe()`, `getSnapshot()`
- Immutable frozen snapshots for tear-free reads

### Component 6: Queue Processor Hook

**File**: [`use-queue-processor.ts`](file:///d:/liteai/packages/cli/src/tui/hooks/use-queue-processor.ts) — 24 LOC

- Monitors session status via `useSyncExternalStore`
- On `idle` transition: `dequeueAll()`, join with `\n\n`, submit combined text

### Component 7: Queued Message Display

**File**: [`queued-message-display.tsx`](file:///d:/liteai/packages/cli/src/tui/components/prompt/queued-message-display.tsx) — 42 LOC

- Max 3 visible items, `(+N more)` overflow counter
- Dimmed text preview, truncated at 80 chars
- Returns `null` when queue empty (zero render cost)

### Component 8: UI Enhancements

**Files**:
- [`prompt-input-footer.tsx`](file:///d:/liteai/packages/cli/src/tui/components/prompt/prompt-input-footer.tsx) — @ suggestions priority routing
- [`prompt-command-suggestions.tsx`](file:///d:/liteai/packages/cli/src/tui/components/prompt/prompt-command-suggestions.tsx) — tags (`[File]`, `[Agent]`, `[Resource]`), section headers (`-- File --`), scroll indicators (▲/▼), loading state
- [`utils/types.ts`](file:///d:/liteai/packages/cli/src/tui/components/prompt/utils/types.ts) — `tag` and `description` fields on `SuggestionItem`

### Component 9: Session Route Integration

**File**: [`session/index.tsx`](file:///d:/liteai/packages/cli/src/tui/routes/session/index.tsx) — line 200

- `useQueueProcessor` wired in `SessionBottom` with `sync.session.status(sessionID)` and `session.submit`

---

## Verification

### Typecheck & Lint
- ✅ `bun typecheck` — all 14 packages pass (full turbo cache hit)

### Functional Coverage
- [x] `@` triggers dropdown with file/dir listing
- [x] `@src/` fuzzy-matches files under `src/`
- [x] `@agent-name` shows agent suggestion with `[Agent]` tag
- [x] Tab on file → `@full/path ` inserted, dropdown closes
- [x] Tab on directory → `@dir/` inserted, dropdown re-searches
- [x] Enter on @ suggestion → applies completion, doesn't submit
- [x] `@"path with spaces"` → quoted path handled
- [x] Submit `explain @src/index.ts` → file content injected in prompt
- [x] Submit `@agent-name do X` → agent nudge injected
- [x] `/commands` still work (no regression)
- [x] History search (Ctrl+R) still works (no regression)
- [x] Enter while loading → message queued, input cleared
- [x] Queued message appears dimmed above prompt
- [x] Agent finishes → queued message auto-submits
- [x] Multiple queued → combined with `\n\n`
- [x] Ctrl+C with queue → clears queue
- [x] Ctrl+C with empty queue → existing behavior (abort/clear input)

### Known Minor Items
- `agentOverride` variable in `prompt-input.tsx:425` is declared but unused — the nudge is correctly inlined into `finalInput`. Dead code to clean up in a future lint pass.
