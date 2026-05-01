# Phase 3.0: Session Information Layer

> **Status**: ✅ Implemented
> **Completed**: 2026-05-01
> **Estimated Effort**: 2 days
> **Dependencies**: None
> **Scope**: StatusLine enrichment, session stats hook, cost tracking, context window warnings

---

## Goal

Give users real-time visibility into session economics (cost, tokens, context window utilization) and session metadata, replacing the current minimal status line with a configurable, information-rich footer.

---

## Decisions (Finalized)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Stats Hook Pattern | **Materialized View Store** | O(1) incremental updates via Zustand. Avoids recomputing over entire message history. |
| StatusLine Layout | **Priority-based Segment Dropping** | Gemini-style. Drops whole low-priority segments cleanly when narrow, appends `…`. |
| Stats command | **`/stats` as separate command** | `/status` for system health (MCP/LSP). `/stats` for session economics. |
| Per-model tracking | **Yes** | Track per-model token/cost breakdown (`ModelMetrics`). Essential for multi-model sessions. |
| Auto-compact | **Yes, at 95%** | Auto-compact trigger when context >= 95%. Submits `/compact` automatically. |
| Design lineage | **Our own design** | We reference Claude Code and Gemini CLI for threshold logic and layout ideas, but the code is original. |

---

## Implementation Status

### 3.0.1 — `use-session-stats.ts` Hook — ✅ Complete

**File**: [`use-session-stats.ts`](file:///d:/liteai/packages/cli/src/tui/hooks/use-session-stats.ts) (~8.6 KB)

Standalone Zustand store per session, subscribed to SDK events. Incremental accumulator — never recomputes from the full message list.

**Delivered**:
- `SessionStats` type with `totalTokens` (input, output, reasoning, cache read/write), `totalCost`, `contextUtilization`, `contextLimit`, `turnCount`, `toolCalls`, `duration`, `perModel`
- `ModelMetrics` per-model breakdown (modelID, providerID, tokens, cost, requests)
- `processedMessageIDs` / `processedToolPartIDs` sets for idempotent deduplication
- Bootstrap from existing messages at store creation + live event subscription
- Shared via `StatsProvider` context ([`stats.tsx`](file:///d:/liteai/packages/cli/src/tui/context/stats.tsx)) at the session route boundary

---

### 3.0.2 — StatusLine Enrichment — ✅ Complete

**File**: [`status-line.tsx`](file:///d:/liteai/packages/cli/src/tui/components/status-line.tsx) (~4.9 KB, up from 32 lines)

Legacy `SessionHeader` permanently replaced. Segment-based footer with priority-based width-fitting.

**Delivered Segments** (by display priority):

| Priority | Segment | Format | Color Logic |
|----------|---------|--------|-------------|
| 1 (highest) | Model | `{modelName}` | `theme.text` |
| 2 | Context % | `{N}% ctx` | Green < 60%, Yellow 60-85%, Red > 85% |
| 3 | Cost | `${N.NNN}` | `theme.text`. Hidden when `null`. |
| 4 | Tokens | `{N}k tok` | `theme.textMuted` |
| 5 | CWD | last path segment | `theme.textMuted` |
| 6 | Git Branch | `⎇ {branch}` | `theme.textMuted` |
| 7 | Code Changes | `+{N} -{N}` | success/error |
| 8 (lowest) | Session ID | first 8 chars | `theme.textMuted` |

**Width-Fitting**: `buildSegments()` + `fitSegments()` — calculates available terminal columns, admits high-priority segments first, drops lower-priority entries, appends `…` indicator when segments are omitted.

**Deleted**: [`header.tsx`](file:///d:/liteai/packages/cli/src/tui/routes/session/header.tsx) — removed as dead code.

---

### 3.0.3 — Context Usage Display — ✅ Complete

**File**: [`context-usage-display.tsx`](file:///d:/liteai/packages/cli/src/tui/components/context-usage-display.tsx) (~1.4 KB)

Inline component rendering context utilization as a visual progress bar with percentage text.

**Delivered**:
- 20-char fixed-width bar (`█` filled, `░` empty)
- Color thresholds: green < 60%, yellow 60-85%, red > 85%
- Used in `DialogStats` and `TokenWarning` (StatusLine uses compact `42% ctx` text)

---

### 3.0.4 — Token Warning Component + Auto-Compact — ✅ Complete

**File**: [`token-warning.tsx`](file:///d:/liteai/packages/cli/src/tui/components/token-warning.tsx) (~1.4 KB)

**Delivered Threshold Logic**:

| Condition | Level | Color | Message | Action |
|-----------|-------|-------|---------|--------|
| `utilization >= 0.95` | Critical | `theme.error` | `⚠ Context nearly full ({N}%). Auto-compacting…` | **Auto-triggers `/compact`** via `session.submit("/compact", "prompt")` |
| `utilization >= 0.85` | Warning | `theme.warning` | `⚠ Context at {N}%. Consider /compact.` | No auto-action |
| `utilization < 0.85` | Hidden | — | — | Returns `null` |

**Auto-compact**: Guard ref prevents duplicate firings. Resets when utilization drops below 0.95.

**Wired** at [`session/index.tsx`](file:///d:/liteai/packages/cli/src/tui/routes/session/index.tsx) in the bottom slot before `MessageActionsBar`.

---

### 3.0.5 — Compact Summary Component — ✅ Complete

**File**: [`compact-summary.tsx`](file:///d:/liteai/packages/cli/src/tui/components/compact-summary.tsx) (~0.8 KB)

Renders inline when a `CompactionPart` is encountered in the message stream.

**Delivered Display Variants**:
- Auto: `📋 Conversation automatically summarized`
- Overflow: `📋 Context overflow — conversation summarized`
- Manual: `📋 Conversation summarized (/compact)`

**Wired** at [`parts.tsx`](file:///d:/liteai/packages/cli/src/tui/routes/session/parts.tsx) — `compaction` case added to part type switch dispatching `CompactionPartView`.

---

### 3.0.6 — `/stats` Command (Dialog) — ✅ Complete

**File**: [`dialog-stats.tsx`](file:///d:/liteai/packages/cli/src/tui/components/dialog-stats.tsx) (~7 KB)

Full stats panel rendered as a dialog. Registered as `/stats` TUI command in [`prompt-input.tsx`](file:///d:/liteai/packages/cli/src/tui/components/prompt/prompt-input.tsx).

**Delivered Sections**:
1. **Session Info** — Session ID (full), duration (`Xh Ym Zs`), turn count
2. **Token Usage** — Input, Output, Reasoning, Cache read/write, Total
3. **Cost** — Total cost (`$X.XXX`) or "No cost data available"
4. **Context Window** — `ContextUsageDisplay` bar + percentage, model context limit
5. **Tool Calls** — Total / Success / Failed, success rate (%)
6. **Per-Model Breakdown** (table) — Model, Requests, Input Tok, Output Tok, Cost
7. **Code Changes** — Files changed, lines added/removed

---

## Integration Wiring — ✅ Complete

All integration points confirmed in [`session/index.tsx`](file:///d:/liteai/packages/cli/src/tui/routes/session/index.tsx):

- `StatsProvider` wraps session route (lines 147–175)
- `TokenWarning` renders with `onAutoCompact` callback (line 190)
- `StatusLine` renders at the footer (line 193)
- `useStats()` context hook used instead of direct `useSessionStats()` calls — single Zustand store instance shared across components

---

## File Manifest

| Action | File | Size |
|--------|------|------|
| ✅ NEW | [`use-session-stats.ts`](file:///d:/liteai/packages/cli/src/tui/hooks/use-session-stats.ts) | 8.6 KB |
| ✅ NEW | [`stats.tsx`](file:///d:/liteai/packages/cli/src/tui/context/stats.tsx) | 1.0 KB |
| ✅ MODIFY | [`status-line.tsx`](file:///d:/liteai/packages/cli/src/tui/components/status-line.tsx) | 4.9 KB |
| ✅ NEW | [`context-usage-display.tsx`](file:///d:/liteai/packages/cli/src/tui/components/context-usage-display.tsx) | 1.4 KB |
| ✅ NEW | [`token-warning.tsx`](file:///d:/liteai/packages/cli/src/tui/components/token-warning.tsx) | 1.4 KB |
| ✅ NEW | [`compact-summary.tsx`](file:///d:/liteai/packages/cli/src/tui/components/compact-summary.tsx) | 0.8 KB |
| ✅ NEW | [`dialog-stats.tsx`](file:///d:/liteai/packages/cli/src/tui/components/dialog-stats.tsx) | 7.0 KB |
| ✅ MODIFY | [`session/index.tsx`](file:///d:/liteai/packages/cli/src/tui/routes/session/index.tsx) | wired |
| ✅ MODIFY | [`parts.tsx`](file:///d:/liteai/packages/cli/src/tui/routes/session/parts.tsx) | wired |
| ✅ MODIFY | [`prompt-input.tsx`](file:///d:/liteai/packages/cli/src/tui/components/prompt/prompt-input.tsx) | wired |
| ✅ DELETE | `session/header.tsx` | removed |

---

## Verification

- [x] StatusLine shows model, context %, cost, tokens, CWD
- [x] Color thresholds work for context utilization (green/yellow/red)
- [x] Token warning banner appears at threshold
- [x] `/stats` shows full session breakdown
- [x] StatusLine degrades gracefully when terminal is narrow (drops low-priority segments)
- [x] Cost shows hidden when provider doesn't expose pricing
- [x] Compact summary renders when compaction event fires
- [x] `bun typecheck` passes (0 errors)
- [x] `bun lint` passes

> [!NOTE]
> Standalone component unit tests for `use-session-stats.ts` were not added due to the testing environment lacking jsdom/`@testing-library/react` hooks. This is a known gap — the accumulator logic is exercised indirectly through integration.

---

## Future Considerations

> [!TIP]
> **User-configurable footer items**: Gemini CLI supports `settings.ui.footer.items` array for user-customizable status line segments. Consider adding `tui.json` → `statusLine.items` in a follow-up phase.
