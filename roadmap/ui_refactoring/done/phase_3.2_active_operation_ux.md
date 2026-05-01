# Phase 3.2: Active Operation UX

> **Status**: ✅ Completed
> **Estimated Effort**: 2 days
> **Dependencies**: None (can run in parallel with 3.0/3.1)
> **Scope**: Rich spinner, stall detection, tool execution timing, subagent progress tree

---

## Goal

Provide users with clear feedback about what the system is doing, how long it's been doing it, and whether it's stuck — replacing the current basic dot spinner with a rich, multi-phase loading experience.

---

## Current State

### What Exists

| Component | File | Status |
|-----------|------|--------|
| Spinner | [`ui/spinner.tsx`](file:///d:/liteai/packages/cli/src/tui/ui/spinner.tsx) | 61 lines. Animated braille dots (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`), `SpinnerWithVerb` variant with message. Uses `useAnimationFrame`. |
| Tool Use Loader | [`components/tool-use-loader.tsx`](file:///d:/liteai/packages/cli/src/tui/components/tool-use-loader.tsx) | 40 lines. Blinking dot indicator — `●` green (success), red (error), dim (pending). No timing info. |
| useBlink | [`hooks/useBlink.ts`](file:///d:/liteai/packages/cli/src/tui/hooks/useBlink.ts) | Simple boolean blink toggle |

### What's Missing

- Stall detection (no new tokens for N seconds)
- Elapsed time display per operation
- Multi-phase spinner (thinking → working → stalled)
- Tool execution timing
- Subagent/fork progress tree
- "Still working" message after extended wait

---

## Implementation Plan

### 3.2.1 — `use-elapsed-time.ts` Hook

**New file**: `packages/cli/src/tui/hooks/use-elapsed-time.ts`

Provides a reactive elapsed time counter with automatic formatting.

```typescript
export type UseElapsedTimeProps = {
  startTime: number | null
  endTime?: number | null // Set when operation completes (prevents runaway counting)
  interval?: number // Update interval in ms (default: 1000)
}

export type UseElapsedTimeResult = {
  elapsed: number // milliseconds
  formatted: string // "3s", "1m 42s", "5m 30s"
}

export function useElapsedTime(props: UseElapsedTimeProps): UseElapsedTimeResult
```

**Reference Implementations**:
- **Claude Code**: [`useElapsedTime.ts`](file:///D:/claude-code/src/hooks/useElapsedTime.ts) (38 lines) — Uses `useSyncExternalStore` with `setInterval`. Supports `endTime` to freeze the display for completed tasks. Key insight: without `endTime`, viewing an old completed tool call would show a misleadingly large elapsed time.
- **Gemini CLI**: `useTimer.ts` — Similar hook with `setInterval`-based elapsed tracking.

> [!TIP]
> **From Claude**: The `endTime` prop is critical. Without it, a completed tool call viewed 5 minutes later shows "5m 42s" instead of the actual "2s" it took. Always set `endTime` when the operation completes.

---

### 3.2.2 — `use-stalled-animation.ts` Hook

**New file**: `packages/cli/src/tui/hooks/use-stalled-animation.ts`

Detects when an active operation has stalled (no new tokens/progress for a configurable duration).

```typescript
export type StalledState = {
  isStalled: boolean
  intensity: number // 0.0–1.0 — ramps over 2s for smooth visual transition
}

export function useStalledAnimation(opts: {
  isActive: boolean
  lastTokenTime: number | null
  stallThresholdMs?: number // default: 3000
  activeToolDetected?: boolean // suppress stall during tool execution
}): StalledState
```

**Reference Implementation**:
- **Claude Code**: [`useStalledAnimation.ts`](file:///D:/claude-code/src/components/Spinner/useStalledAnimation.ts) (76 lines) — Uses animation-clock-driven timing (not `setInterval`). Stall detection after 3s of no new tokens. Smooth intensity fade over 2s. **Suppresses stall indicator when a tool is actively running** (the tool itself is making progress, just not generating tokens). Slows tick rate when terminal is blurred (saves CPU).

> [!IMPORTANT]
> **Adopt from Claude**: Use animation-clock-driven timing rather than `setInterval`. Our `useAnimationFrame` hook from `@liteai/ink` provides this naturally. This means stall detection automatically pauses when the terminal is backgrounded — preventing false stall alerts.

---

### 3.2.3 — Rich Spinner Component (Replace `spinner.tsx`)

**Modify**: [`ui/spinner.tsx`](file:///d:/liteai/packages/cli/src/tui/ui/spinner.tsx)

Enhance the existing spinner with multi-phase visual feedback:

**Phase 1 — Normal** (0–3s): Standard braille animation, "Thinking…" message, elapsed time.
**Phase 2 — Extended** (3–30s): Shimmer effect on message text, elapsed time updates.
**Phase 3 — Stalled** (30s+): Red color tint, "Still working…" message, elapsed time.

```
⠹ Thinking… (3s)                          ← Phase 1
⠹ Thinking… (12s)                         ← Phase 2, shimmer on text
⠹ Still working… (45s)                    ← Phase 3, red tint
```

**Props Evolution**:
```typescript
type RichSpinnerProps = {
  mode: SpinnerMode
  message?: string
  startTime: number
  isStalled?: boolean
  stallIntensity?: number
  showElapsedTime?: boolean
  reducedMotion?: boolean
}
```

**Reference Implementations**:
- **Claude Code**: Full `Spinner/` directory (12 files, ~170KB) — `SpinnerAnimationRow.tsx`, `ShimmerChar.tsx`, `FlashingChar.tsx`, `GlimmerMessage.tsx`. Massively complex. We should NOT replicate this complexity.
- **Gemini CLI**: [`LoadingIndicator.tsx`](file:///D:/gemini-cli/packages/cli/src/ui/components/LoadingIndicator.tsx) (183 lines) — Simpler approach: spinner + message + elapsed time + cancel hint. Supports inline and block modes. Responsive for narrow terminals.

> [!NOTE]
> Claude's spinner system is an order of magnitude more complex than needed. We adopt Gemini's approach: single component with inline/block modes, elapsed time, cancel hint. Add stall detection from Claude's hook on top.

---

### 3.2.4 — Tool Use Loader Enhancement

**Modify**: [`components/tool-use-loader.tsx`](file:///d:/liteai/packages/cli/src/tui/components/tool-use-loader.tsx)

Add elapsed time display next to the tool indicator:

```
● read_file src/index.ts (2s)
● write_file src/output.ts (completing…)
● bash npm test (running… 15s)
```

**Integration**: Wire `useElapsedTime` with `startTime` from the tool call metadata and `endTime` from the tool result.

---

### 3.2.5 — Subagent Progress Display

**New file**: `packages/cli/src/tui/components/subagent-progress.tsx`

When a subagent (fork) is active, display a tree-style progress indicator:

```
⠹ Agent: code-review (12s)
  ├── read_file src/api.ts ✓
  ├── read_file src/types.ts ✓
  └── ⠹ analyzing patterns… (3s)
```

**Data Source**: Read from `sync.fork[sessionID]` — fork metadata includes child session IDs and their current status.

**Reference Implementation**:
- **Claude Code**: `TeammateSpinnerTree.tsx` (28KB) + `TeammateSpinnerLine.tsx` (38KB) — Full tree rendering for agent/teammate progress. **Far too complex for our needs.**

> [!NOTE]
> Start with a flat list of active forks with their status. Tree nesting is a follow-up if subagents spawn sub-subagents.

---

## Verification

- [x] Spinner shows elapsed time while agent is thinking
- [x] After 3s of no tokens, stall intensity begins ramping
- [x] After 30s, spinner turns red and shows "Still working…"
- [x] Tool calls show elapsed time next to their indicator
- [x] Completed tool calls show final duration (not live-counting)
- [x] `escape` to cancel hint is shown during active operations
- [x] Reduced motion mode shows static `●` indicator
- [x] Subagent forks show progress when active
