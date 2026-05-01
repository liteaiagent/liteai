# Phase 3.3: Input Productivity

> **Status**: ⚠️ Mostly Complete
> **Estimated Effort**: 1 day (remaining work)
> **Dependencies**: None (can run in parallel)
> **Scope**: Autocomplete overlay, file completion, @ mentions, message queuing

---

## Goal

Maximize input efficiency with autocomplete, file path completion, @ mentions for context injection, and message queuing for uninterrupted workflows.

---

## Current State

### What Exists (✅ Implemented)

| Component | File | Status |
|-----------|------|--------|
| **Slash Suggestion Ghost** | [`hooks/use-slash-suggestion.ts`](file:///d:/liteai/packages/cli/src/tui/hooks/use-slash-suggestion.ts) | ✅ 52 lines. Inline ghost text for `/commands`. Prefix match, deterministic (shortest first). |
| **Command Suggestions** | [`prompt/use-command-suggestions.ts`](file:///d:/liteai/packages/cli/src/tui/components/prompt/use-command-suggestions.ts) | ✅ Dropdown list with up/down navigation, selection, mid-command match detection. |
| **Suggestion Rendering** | [`prompt/prompt-command-suggestions.tsx`](file:///d:/liteai/packages/cli/src/tui/components/prompt/prompt-command-suggestions.tsx) | ✅ Visual dropdown with selected highlight. |
| **Arrow Key History** | [`hooks/use-arrow-key-history.ts`](file:///d:/liteai/packages/cli/src/tui/hooks/use-arrow-key-history.ts) | ✅ 208 lines. Chunk-based lazy loading, draft preservation, rapid-keypress handling. |
| **Ctrl+R History Search** | [`hooks/use-history-search.ts`](file:///d:/liteai/packages/cli/src/tui/hooks/use-history-search.ts) | ✅ 80 lines. Fuzzy search via `fuzzysort`, cancel/accept flow. |
| **History Search Input** | [`prompt/history-search-input.tsx`](file:///d:/liteai/packages/cli/src/tui/components/prompt/history-search-input.tsx) | ✅ Visual search prompt. |
| **Paste Handler** | [`hooks/use-paste-handler.ts`](file:///d:/liteai/packages/cli/src/tui/hooks/use-paste-handler.ts) | ✅ Image + text paste, bracketed paste detection, base64 image decode. |
| **Clipboard** | [`hooks/use-clipboard.ts`](file:///d:/liteai/packages/cli/src/tui/hooks/use-clipboard.ts) | ✅ OSC-52 + platform fallback. |
| **Input Modes** | [`prompt/input-modes.ts`](file:///d:/liteai/packages/cli/src/tui/components/prompt/input-modes.ts) | ✅ Prompt/bash mode switching via `!` prefix. |
| **Keybinding: Ctrl+R** | `keybindings/default-bindings.ts` → Global | ✅ `"ctrl+r": "history:search"` |
| **Keybinding: HistorySearch** | `keybindings/default-bindings.ts` → HistorySearch | ✅ `ctrl+r` next, `escape` accept, `enter` execute |

### What's Missing (🔲 Remaining)

| Feature | Status | Priority |
|---------|--------|----------|
| **@ File Completion** | 🔲 Not Started | High |
| **@ Session/Agent Mentions** | 🔲 Not Started | Medium |
| **Fuzzy file search** | 🔲 Not Started | High |
| **Message Queuing** | 🔲 Deferred | Medium |

---

## Implementation Plan

### 3.3.1 — `use-file-completer.ts` Hook (Remaining Work)

**New file**: `packages/cli/src/tui/hooks/use-file-completer.ts`

Triggered when user types `@` followed by a partial path. Provides fuzzy file/directory completion.

```typescript
export type FileCompletion = {
  path: string
  isDirectory: boolean
  relativeTo: string
}

export function useFileCompleter(opts: {
  query: string | null // null when @ not detected
  cwd: string
  debounceMs?: number // default: 100
}): {
  completions: FileCompletion[]
  isLoading: boolean
}
```

**Behavior**:
1. Detect `@` at cursor position in input
2. Extract partial path after `@` (e.g., `@src/ind` → `src/ind`)
3. Fuzzy match against project files using `fuzzysort`
4. Debounce filesystem reads (100ms)
5. Respect `.gitignore` patterns
6. Show directories with trailing `/` indicator

**Reference Implementations**:
- **Claude Code**: [`fileSuggestions.ts`](file:///D:/claude-code/src/hooks/useTypeahead.tsx) — Background index build on mount, `onIndexBuildComplete` subscriber, longest common prefix. Part of the massive 212KB `useTypeahead.tsx`. Key design: builds file index lazily, uses `fuzzysort` for matching.
- **Gemini CLI**: [`useAtCompletion.ts`](file:///D:/gemini-cli/packages/cli/src/ui/hooks/useAtCompletion.ts) (13KB) — Separate hook for `@` file completion with debounced search. Cleaner separation than Claude.

> [!TIP]
> **From Gemini**: Keep `@` completion in a separate hook (not merged into the command suggestion system). This is cleaner than Claude's monolithic 212KB typeahead. Our existing `use-command-suggestions.ts` handles `/` commands; add `use-file-completer.ts` for `@` mentions.

**Integration with PromptInput**:
- Detect `@` in `prompt-input.tsx`'s `onChange` handler
- When `@` detected, query `useFileCompleter`
- Show results in the existing `PromptCommandSuggestions` dropdown (reuse the component)
- On selection, replace `@partial` with `@full/path`

---

### 3.3.2 — @ Session/Agent Mentions

**Extend**: `use-file-completer.ts` or new `use-mention-completer.ts`

In addition to `@filepath`, support:
- `@agent-name` — reference a configured subagent (from `.liteai/agents/`)
- `@session-name` — reference a named session

These are sourced from `sync.agent` and `sync.session.list()` respectively.

**Display**: Group completions by type:
```
Files
  @src/index.ts
  @src/api/routes.ts
Agents
  @code-review
  @test-writer
```

---

### 3.3.3 — Message Queuing (Deferred → Planned)

> [!WARNING]
> Both Claude Code and Gemini CLI support message queuing (Tab to queue while agent is busy). This was listed as deferred but is a significant UX gap.

**New file**: `packages/cli/src/tui/hooks/use-message-queue.ts`

```typescript
export function useMessageQueue(): {
  queue: string[]
  enqueue: (message: string) => void
  dequeue: () => string | undefined
  clear: () => void
  isEmpty: boolean
}
```

**Behavior**:
1. When the agent is busy and user presses Enter (or Tab), the message is queued
2. A `QueuedMessageDisplay` component shows queued messages above the prompt
3. When the agent finishes, the next queued message is automatically submitted
4. `ctrl+c` while queued messages exist clears the queue (with confirmation)

**Reference Implementations**:
- **Claude Code**: `PromptInputQueuedCommands.tsx` — Queue display + Tab to queue while busy.
- **Gemini CLI**: `QueuedMessageDisplay.tsx` + `useMessageQueue.ts` — Tab to queue, auto-submit on completion.

---

## Verification

- [ ] `@src/` triggers file completions with debounced fuzzy matching
- [ ] Completing a file inserts the full relative path
- [ ] Directories show trailing `/` and allow drill-down
- [ ] `@agent-name` suggests configured agents
- [ ] File completions respect `.gitignore`
- [ ] Existing `/command` suggestions still work without regression
- [ ] (Future) Tab queues message when agent is busy
- [ ] (Future) Queued messages auto-submit when agent finishes
