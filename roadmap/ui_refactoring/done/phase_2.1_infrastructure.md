# Phase 2.1: Infrastructure & Dependencies

**Branch**: `feat/cli-react`
**Depends on**: Phase 1 (complete)
**Produces**: Compilable `packages/cli` with React deps + foundational utilities in `src/tui/`

## Objective

Set up the `src/tui/` directory structure, add React dependencies alongside existing SolidJS, and create the foundational utilities that all subsequent phases depend on.

## Architectural Decisions (apply to all Phase 2)

| Decision | Choice |
|----------|--------|
| **Theme colors** | Hex strings — no `RGBA` class, clean break from `@opentui/core` |
| **Renderer APIs** | Implement ALL in `@liteai/ink` — no deferrals |
| **Sync store** | Zustand + immer — external store with selective subscriptions |
| **Event system** | Typed emitter utility (~30 lines) — zero deps |

## Dual-Source Strategy (apply to all Phase 2)

| Layer | Source |
|-------|--------|
| **State/Context** (phases 2.1–2.3) | Existing SolidJS architecture, converted to React |
| **Visual Components** (phases 2.4–2.6) | MVP React codebase |

> [!IMPORTANT]
> Do NOT transliterate old SolidJS components to React. Visual layer comes from the MVP.

## Key Paths

| Resource | Path |
|----------|------|
| **CLI package.json** | `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\package.json` |
| **Target directory** | `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\tui\` (NEW) |
| **Existing SolidJS helper** | `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\cli\cmd\tui\context\helper.tsx` |
| **Existing SolidJS flags** | `c:\Users\aghassan\Documents\workspace\liteai\packages\cli\src\cli\cmd\tui\flags.ts` |

## Proposed Changes

### 1. [MODIFY] `packages/cli/package.json`

Add React dependencies alongside existing SolidJS deps (both coexist until phase 2.7):

```diff
+ "react": "catalog:"
+ "@liteai/ink": "workspace:*"
+ "@liteai/hooks": "workspace:*"
+ "zustand": "latest"
+ "immer": "latest"
```

### 2. [NEW] `src/tui/util/color.ts`

Hex-string color utilities. No `RGBA` class — all functions operate on `string` (hex).

**Functions needed** (referenced by theme.tsx in phase 2.3):
- `tint(hex: string, amount: number): string` — lighten/darken
- `luminance(hex: string): number` — relative luminance
- `contrast(hex1: string, hex2: string): number` — contrast ratio
- `fromInts(r: number, g: number, b: number, a?: number): string` — RGBA ints → hex
- `parseHex(hex: string): { r: number, g: number, b: number, a: number }` — hex → components
- `withAlpha(hex: string, alpha: number): string` — set alpha channel

~80 lines. Must handle 3-digit, 6-digit, and 8-digit hex formats.

### 3. [NEW] `src/tui/util/event-emitter.ts`

Typed event emitter replacing `@solid-primitives/event-bus`:

```typescript
type EventMap = Record<string, unknown>
type Handler<T> = (event: T) => void

interface TypedEmitter<T extends EventMap> {
  on<K extends keyof T>(event: K, handler: Handler<T[K]>): () => void
  emit<K extends keyof T>(event: K, event: T[K]): void
  off<K extends keyof T>(event: K, handler: Handler<T[K]>): void
}
```

~30 lines.

### 4. [NEW] `src/tui/context/helper.tsx`

React version of `createSimpleContext`. Reference the existing SolidJS version:

**Existing** (`cli/cmd/tui/context/helper.tsx`, 26 lines):
- Uses SolidJS `createContext`, `useContext`, `Show`
- Has a `ready` gate that conditionally renders children
- Returns `{ provider, use }` tuple

**New React version**:
- Uses React `createContext`, `useContext`
- `ready` gate becomes conditional render in provider (`ready === undefined || ready === true`)
- Same `{ provider, use }` API shape

### 5. [MOVE] `src/cli/cmd/tui/flags.ts` → `src/tui/flags.ts`

Framework-agnostic file, just relocate. Keep the original in place until phase 2.7 cleanup.

### 6. Create directory structure

```
packages/cli/src/tui/
  util/
    color.ts
    event-emitter.ts
  context/
    helper.tsx
  flags.ts
```

## Verification

```powershell
cd c:\Users\aghassan\Documents\workspace\liteai
bun install
bun typecheck 2>&1 | Out-String
bun lint:fix
```

**Gate**: All packages pass typecheck (old SolidJS + new React coexist).

## Review Checklist

- [ ] `bun install` succeeds with new deps
- [ ] `bun typecheck` clean
- [ ] `bun lint:fix` clean
- [ ] `color.ts` has unit tests covering hex parsing, tint, luminance, contrast
- [ ] `event-emitter.ts` has unit tests covering on/emit/off
- [ ] `helper.tsx` API matches existing SolidJS version's shape
