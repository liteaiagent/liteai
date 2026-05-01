# Phase 3.2: Active Operation UX — Design Decisions

Competitive analysis and architectural decisions for the Active Operation UX layer.
Evaluated against Claude Code (v1.0.33) and Gemini CLI (v0.5.x).

## Feature Matrix

| Feature | Claude Code | Gemini CLI | LiteAI Decision |
|---------|-------------|------------|------------------|
| Elapsed time (spinner) | ✅ `useElapsedTime` + `useSyncExternalStore` | ✅ `useTimer` hook | ✅ ADOPT — use `useAnimationFrame` instead of `setInterval` for auto-pause on terminal blur |
| Elapsed time (per-tool) | ✅ via `ToolState.time` | ❌ | ✅ ADOPT — freeze on `endTime` (Claude's key insight) |
| Stall detection | ✅ 3s onset, 2s exponential ramp, RGB interpolation to `{171,43,63}` | ❌ | ✅ ADOPT — animation-clock-driven, not `setInterval` |
| Shimmer/glimmer sweep | ✅ grapheme-aware 3-segment split, 150ms tick, right-to-left sweep | ❌ | ✅ ADOPT — port `computeShimmerSegments` with `Intl.Segmenter` |
| Spinner glyphs | ✅ decorative `· ✢ ✳ ✶ ✻ ✽` forward+reverse, platform-aware | ✅ rainbow gradient (Google brand) | ✅ ADOPT Claude's — decorative chars are terminal-universal; brand gradients are not |
| Reduced motion | ✅ pulsing `●` with 2s dim/bright cycle | ❌ | ✅ ADOPT — accessibility requirement |
| Token counter | ✅ smooth animated catch-up with 3-tier increment speed | ❌ | ✅ ADOPT — premium feel, driven by shared 50ms animation clock |
| Thinking shimmer | ✅ sine-wave RGB pulse on "thinking" text, 2s period, 3s delay | ❌ | ✅ ADOPT — uses shared animation clock, zero extra cost |
| Witty loading verbs | ✅ ~190 verbs ("Cogitating…"), picked once per turn | ❌ | ✅ ADOPT — curate ~80 verbs, mix whimsical + technical |
| Witty loading phrases | ❌ | ✅ ~130 sentences ("Trying to exit Vim"), cycle every 5s | ✅ ADOPT — display below spinner as tip line after 10s |
| Informative tips | ❌ (time-based tips only: /clear, /btw) | ✅ ~165 tips (shortcuts, commands, settings), cycle every 10s | ✅ ADOPT — curate ~30 LiteAI-specific tips |
| Cancel hint | ✅ `(esc to interrupt)` for teammates | ✅ `(esc to cancel, 3s)` | ✅ ADOPT Gemini's style — simpler, clearer |
| Subagent progress | ✅ full tree with selection, stats, idle detection (~600 LOC compiled) | ❌ | ✅ ADOPT simplified — flat list from Task ToolParts, no selection mode |
| Progressive width gating | ✅ 4 tiers based on `columns` | ✅ `isNarrow` binary check | ✅ ADOPT Claude's 4-tier — more responsive |
| Turn completion verbs | ✅ ~7 past-tense verbs ("Baked for 5s") | ❌ | ✅ ADOPT — small detail, big personality |

---

## Architecture Decisions

### ADR-1: Animation Clock Strategy

**Context**: Both Claude and Gemini use `setInterval` for some timing (elapsed time, phrase cycling). Claude additionally uses `useAnimationFrame` for the 50ms render loop.

**Decision**: Use `useAnimationFrame` from `@liteai/ink` as the single timing source for all animation-driven state (elapsed time, stall detection, shimmer, token counter, thinking shimmer). Use `setInterval` only for phrase cycling (doesn't need render sync).

**Rationale**: Our `useAnimationFrame` already handles terminal focus/blur and clock synchronization. `setInterval`-based stall detection fires false alerts when the user switches terminals. `useAnimationFrame` automatically pauses, preventing both false stalls and wasted CPU.

### ADR-2: Render Architecture — Split Clock

**Context**: Claude splits into `SpinnerWithVerb` (parent, re-renders on props/state ~25x/turn) and `SpinnerAnimationRow` (child, owns `useAnimationFrame(50)`, re-renders ~383x/turn). This keeps task filtering, tips, and tree rendering off the 50ms hot path.

**Decision**: Adopt this split. `RichSpinner` (parent) handles phrase selection, width gating decisions, tip cycling, and subagent derivation. `SpinnerAnimationRow` (child) owns the 50ms clock and computes frame, shimmer, stall intensity, token counter, thinking color, and elapsed time.

**Rationale**: Without this split, every 50ms tick re-evaluates all parent logic. With ~5 hooks and sync reads in the parent, this would cause measurable jank in the terminal renderer.

### ADR-3: Shimmer Implementation

**Context**: Claude's `GlimmerMessage` (~328 LOC compiled) uses per-grapheme RGB interpolation with the React Compiler. This is their most complex visual effect.

**Decision**: Port the core shimmer algorithm (`computeShimmerSegments` from `bridgeStatusUtil.ts`) which splits text into `{before, shimmer, after}` by visual column position. Render `before`/`after` as `dimColor` and `shimmer` as full brightness. Skip per-character RGB interpolation — the 3-segment approach gives 90% of the visual impact at 10% of the complexity.

**Rationale**: Per-character RGB requires `getGraphemeSegmenter()` per render + individual `<Text>` nodes per character. The 3-segment approach uses the same segmenter but produces only 3 `<Text>` nodes. Visual difference is minimal in terminal contexts where character cells are large.

### ADR-4: Stall Color Transition

**Context**: Claude uses RGB interpolation from theme color → `{171,43,63}` (error red). Our theme uses semantic hex colors.

**Decision**: Implement RGB interpolation. Parse the theme's hex color to RGB at render time (with cache), interpolate to the same error red, output as `rgb(r,g,b)` string. Ink supports `rgb()` color strings.

**Rationale**: Discrete state transitions (dim on/off, color swap) produce jarring jumps. The smooth RGB ramp is what makes stall detection feel "high-tech" rather than "broken". The parsing cost is negligible with caching.

### ADR-5: Witty Phrase Hybrid Model

**Context**: Claude uses witty *verbs* as the spinner message itself. Gemini uses witty *sentences* in a separate tip area. Both are memorable and users mention them positively.

**Decision**: Hybrid approach:
- **Spinner message**: Witty verb + "…" (e.g., "Cogitating…"), selected once on mount per turn
- **Tip line below spinner**: After 10s, cycles between informative tips (every 10s) and witty phrases (every 5s)
- Both are configurable: `showTips`, `showWittyPhrases` settings

**Rationale**: The verb gives personality to every interaction. The tip line provides value during longer waits. Combining both is strictly superior to either alone.

### ADR-6: Subagent Data Source

**Context**: The roadmap references `sync.fork[sessionID]`, but `SyncState` has no `fork` property. Two options:
- (A) Wire `agent.spawned/progress/completed` events into a new `agents` map in SyncState
- (B) Derive subagent status from existing `Task` ToolParts in the message stream

**Decision**: Both. Wire agent events into SyncState (provides real-time activity text like "reading src/api.ts…"). Also derive progress from Task ToolParts (provides tool counts and completion status). The SubagentProgress component merges both data sources.

**Rationale**: Agent events provide the activity granularity users expect ("what is it doing right now?"). Task ToolParts provide the structural overview ("how many tools has it used?"). Neither alone is sufficient.

---

## Status

| Decision | Status |
|----------|--------|
| ADR-1: Animation Clock | ✅ Decided |
| ADR-2: Render Split | ✅ Decided |
| ADR-3: Shimmer | ✅ Decided |
| ADR-4: Stall Colors | ✅ Decided |
| ADR-5: Phrase Model | ✅ Decided |
| ADR-6: Subagent Source | ✅ Decided |

---

## Reference Appendix — Source Code Paths

### LiteAI Existing Files (dependencies for new code)

| File | What it provides | Relevant exports |
|------|-----------------|------------------|
| `packages/ink/src/hooks/use-animation-frame.ts` | Shared animation clock, auto-pauses on terminal blur/offscreen | `useAnimationFrame(intervalMs)` → `[ref, time]` |
| `packages/ink/src/hooks/use-terminal-focus.ts` | Terminal focus detection | `useTerminalFocus()` → `boolean` |
| `packages/cli/src/tui/ui/spinner.tsx` | **Current spinner to replace** — simple braille `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` at 120ms + `SpinnerWithVerb` wrapper | `Spinner`, `SpinnerWithVerb` |
| `packages/cli/src/tui/components/tool-use-loader.tsx` | **Current tool loader** — simple blink animation, no elapsed time | `ToolUseLoader` |
| `packages/cli/src/tui/hooks/useBlink.ts` | Blink animation hook using `useAnimationFrame` | `useBlink()` → `boolean` |
| `packages/cli/src/tui/context/sync.tsx` | Zustand store with SSE event handling, session/message/part state | `useSync()`, `SyncState`, event handler `switch` block at L266–L457 |
| `packages/cli/src/tui/context/session.tsx` | Session lifecycle, `isLoading` derived from sync status | `useSession()` → `{ sessionID, isLoading, submit, abort }` |
| `packages/cli/src/tui/context/theme.tsx` | Theme colors as hex strings | `useTheme()` → `{ theme }` where `theme.primary`, `theme.error`, etc. are hex strings like `"#ab2b3f"` |
| `packages/cli/src/tui/routes/session/messages.tsx` | Message list rendering — where `RichSpinner` row gets added | `Messages` component, uses `VirtualMessageList` |
| `packages/cli/src/tui/routes/session/tools.tsx` | Tool rendering — `InlineTool` and `BlockTool` components to modify for elapsed time | 697 lines, `InlineTool`, `BlockTool`, per-tool renderers |
| `packages/cli/src/tui/routes/session/parts.tsx` | Part type → component mapping | `PART_MAPPING`, `ToolPartView` extracts tool props |
| `packages/cli/src/tui/routes/session/message.tsx` | `AssistantMessageContent` — renders parts + completion line with duration | Already uses `Locale.duration()` for completed message duration |
| `packages/util/src/locale.ts` | Duration/number formatting (decimal style, not suitable for live display) | `Locale.duration(ms)` → `"3.2s"`, `Locale.number(n)` → `"1.2K"` |
| `packages/cli/src/tui/components/prompt/prompt-input-mode-indicator.tsx` | Prompt `❯` indicator, dims when loading | `PromptInputModeIndicator` — does NOT show spinner currently |
| `packages/cli/src/tui/util/color.ts` | **Existing color utilities** — hex parsing, RGB interpolation, luminance, contrast | `parseHex(hex) → RGBA`, `fromInts(r,g,b,a?) → hex`, `tint(hex, amount)`, `withAlpha(hex, alpha)`, `RGBA` type |

### SDK Types (from `packages/sdk/src/gen/types.gen.ts`)

| Type | Location (line) | Key fields for this feature |
|------|----------------|----------------------------|
| `ToolStatePending` | L501 | `status: 'pending'`, no `time` field |
| `ToolStateRunning` | L513 | `status: 'running'`, `time: { start: number }` |
| `ToolStateCompleted` | L527 | `status: 'completed'`, `time: { start, end }`, `output`, `title` |
| `ToolStateError` | L545 | `status: 'error'`, `time: { start, end }`, `error` |
| `ToolPart` | L562 | `type: 'tool'`, `tool: string`, `state: ToolState`, `callID` |
| `ReasoningPart` | L434 | `type: 'reasoning'`, `time: { start, end? }` — for thinking status |
| `SubtaskPart` | L419 | `type: 'subtask'`, `prompt`, `description`, `agent` |
| `EventAgentSpawned` | L746 | `agentId`, `agentType`, `parentId`, `isAsync` |
| `EventAgentProgress` | L771 | `agentId`, `activity` |
| `EventAgentCompleted` | L756 | `agentId`, `status`, `duration`, `usage: { totalTokens, toolCalls, duration }` |
| `SessionStatus` | L683 | `{ type: 'idle' } \| { type: 'retry' } \| { type: 'busy' }` |
| `AssistantMessage` | L350 | `time: { created, completed? }`, `tokens`, `finish` |

### Claude Code Source Files (port reference)

| File | What to port | Port approach |
|------|-------------|---------------|
| `D:\claude-code\src\components\Spinner\utils.ts` | `interpolateColor`, `toRGBColor`, `parseRGB`, `getDefaultCharacters`, `hueToRgb` | Direct port → `spinner-color.ts` |
| `D:\claude-code\src\bridge\bridgeStatusUtil.ts` (L60–L111) | `computeGlimmerIndex`, `computeShimmerSegments` | Direct port → `shimmer.ts` |
| `D:\claude-code\src\components\Spinner\useStalledAnimation.ts` | Stall detection logic (3s threshold, exponential smoothing) | Adapt → `use-stalled-animation.ts` (use `time` param instead of own `useAnimationFrame`) |
| `D:\claude-code\src\components\Spinner\SpinnerGlyph.tsx` | Glyph rendering with stall color, reduced motion pulsing dot | Adapt → `SpinnerGlyph` in `spinner.tsx` |
| `D:\claude-code\src\components\Spinner\SpinnerAnimationRow.tsx` | 50ms animation loop, token counter, width gating, thinking shimmer | Adapt → `SpinnerAnimationRow` in `spinner.tsx` |
| `D:\claude-code\src\components\Spinner\GlimmerMessage.tsx` (L23–L110) | Stalled color interpolation on message text | Simplify → 3-segment approach in `SpinnerAnimationRow` |
| `D:\claude-code\src\constants\spinnerVerbs.ts` | 190 witty verbs list | Curate subset → `spinner-phrases.ts` |
| `D:\claude-code\src\constants\turnCompletionVerbs.ts` | 7 past-tense completion verbs | Direct port → `spinner-phrases.ts` |

### Gemini CLI Source Files (port reference)

| File | What to port | Port approach |
|------|-------------|---------------|
| `D:\gemini-cli\packages\cli\src\ui\hooks\usePhraseCycler.ts` | Phrase cycling with `setInterval`, dedup via refs, min display time | Adapt → `use-phrase-cycler.ts` (simplify — drop `isWaiting`/`shouldShowFocusHint`) |
| `D:\gemini-cli\packages\cli\src\ui\constants\wittyPhrases.ts` | 130 witty loading sentences | Curate subset → `spinner-phrases.ts` |
| `D:\gemini-cli\packages\cli\src\ui\constants\tips.ts` | 165 informative tips | Write LiteAI-specific → `spinner-phrases.ts` |
| `D:\gemini-cli\packages\cli\src\ui\hooks\useLoadingIndicator.ts` | Timer + phrase + retry orchestration | Reference only (our `RichSpinner` replaces this) |

### Key Integration Patterns

**Theme color access** (for RGB parsing):
```typescript
const { theme } = useTheme()
// theme.primary → "#7c5cbf" (hex string)
// theme.error → "#d32f2f"
// Pass to parseRGB() for interpolation
```

**Animation frame usage** (from `@liteai/ink`):
```typescript
const [ref, time] = useAnimationFrame(50) // 50ms = 20fps
// ref → attach to <Box ref={ref}> for viewport tracking
// time → monotonic ms, pauses when offscreen or terminal blurred
```

**Sync part access** (for responseLength):
```typescript
const sync = useSync()
const parts = sync.part[messageID] ?? []
const textLength = parts.reduce((acc, p) => p.type === "text" ? acc + p.text.length : acc, 0)
```

**Tool state timing** (from SDK types):
```typescript
// ToolStatePending → no time field
// ToolStateRunning → time: { start: number }
// ToolStateCompleted → time: { start: number, end: number }
// ToolStateError → time: { start: number, end: number }
```

### Critical Implementation Notes

**REUSE `tui/util/color.ts`** — We already have `parseHex(hex) → { r, g, b, a }` and `fromInts(r, g, b, a?) → hex` in `packages/cli/src/tui/util/color.ts`. The planned `spinner-color.ts` should import and reuse these rather than duplicating parsing logic. The `interpolateColor` and `toRGBString` functions are the only new additions needed. The existing `RGBA` type is `{ r: number; g: number; b: number; a: number }` — our `RGBColor` can extend or alias it.

**REUSE `theme.tsx:tint()`** — `packages/cli/src/tui/context/theme.tsx` L406 exports `tint(base: hex, overlay: hex, alpha: number) → hex` which does hex-based interpolation. However, this operates on hex strings (requires parse+format per call), while the animation loop needs raw RGB for performance. So `spinner-color.ts` should still have `interpolateColor(rgb1, rgb2, t) → rgb` operating on pre-parsed values, but delegate to `parseHex` from `color.ts` for the initial parse.

**`Spinner` (glyph-only) consumers** — these import `Spinner` and must not break:
- `packages/cli/src/tui/routes/session/tools.tsx` → used inline for tool loading indicators
- `packages/cli/src/tui/components/dialog-session-list.tsx` → loading state
- `packages/cli/src/tui/components/design-system/LoadingState.tsx` → generic loading

**`SpinnerWithVerb`** — defined in `spinner.tsx` but **zero external consumers**. Safe to replace with `RichSpinner`.

**`ToolUseLoader`** — defined in `tool-use-loader.tsx` but **zero external consumers** (dead code). Can be left as-is or removed.

**`stringWidth`** — available via `import { stringWidth } from "@liteai/ink"` (L48 of ink index.ts). Uses `Bun.stringWidth` when available, JavaScript fallback otherwise. Required for shimmer grapheme positioning.

**`Intl.Segmenter`** — available in Bun runtime natively. Required for `computeShimmerSegments` grapheme-aware splitting. Usage: `new Intl.Segmenter(undefined, { granularity: "grapheme" })`.

**Import path conventions** — The codebase uses relative paths without `.js` extensions for local imports within packages, and bare specifiers for cross-package imports:
```typescript
// Within cli package (relative, no .js extension):
import { parseHex, fromInts, type RGBA } from "../util/color"
import { useTheme } from "../../context/theme"
// From ink package:
import { Box, Text, useAnimationFrame, stringWidth } from "@liteai/ink"
import type { DOMElement } from "@liteai/ink"
// From sdk package:
import type { ToolPart, AssistantMessage } from "@liteai/sdk"
// From util package:
import { Locale } from "@liteai/util/locale"
```

