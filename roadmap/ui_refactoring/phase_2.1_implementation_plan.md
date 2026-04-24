# Implementation Plan - Phase 2.1: Infrastructure & Dependencies

This phase establishes the foundational utilities and dependency structure for the new React-based TUI in `packages/cli`.

## Proposed Changes

### Build & Dependencies

#### [MODIFY] [Root package.json](file:///c:/Users/aghassan/Documents/workspace/liteai/package.json)
- Add `react` and `react-dom` to the `workspaces.catalog` to support the `catalog:` reference in `packages/cli`.

#### [MODIFY] [CLI package.json](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/package.json)
- Add React dependencies: `react`, `@liteai/ink`, `@liteai/hooks`, `zustand`, `immer`.
- These will coexist with SolidJS dependencies until Phase 2.7.

---

### TUI Infrastructure

#### [NEW] [color.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/util/color.ts)
Implement hex-string color utilities:
- `parseHex(hex: string)`: Supports `#RGB`, `#RRGGBB`, `#RRGGBBAA`.
- `fromInts(r, g, b, a?)`: Converts RGBA integers to hex string.
- `tint(hex, amount)`: Lightens/darkens a color.
- `luminance(hex)`: Calculates relative luminance (sRGB).
- `contrast(hex1, hex2)`: Calculates contrast ratio.
- `withAlpha(hex, alpha)`: Sets the alpha channel.

#### [NEW] [event-emitter.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/util/event-emitter.ts)
Implement a lightweight, typed event emitter:
- `on(event, handler)`: Returns a cleanup function.
- `emit(event, payload)`: Triggers handlers.
- `off(event, handler)`: Explicitly removes a handler.

#### [NEW] [helper.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/helper.tsx)
React port of `createSimpleContext` with the "ready" gate logic.
- Maintains the same API shape as the SolidJS version: `{ provider, use }`.

#### [NEW] [flags.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/flags.ts)
Copy of `src/cli/cmd/tui/flags.ts` to the new `tui/` directory.

---

## Verification Plan

### Automated Tests
1. **New Unit Tests**:
   - Create `packages/cli/src/tui/util/color.test.ts` to verify hex parsing and math.
   - Create `packages/cli/src/tui/util/event-emitter.test.ts` to verify subscription logic.
2. **System Checks**:
   - `bun install` to verify dependency resolution.
   - `bun typecheck` in `packages/cli` to ensure new utilities and React code are correctly typed.
   - `bun lint:fix` to ensure style compliance.

### Manual Verification
- None required for this infrastructure phase.
