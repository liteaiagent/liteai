# Phase 2.1 Implementation Tasks

- [x] Build & Dependencies
    - [x] Update root `package.json` catalog with `react` and `react-dom`
    - [x] Update `packages/cli/package.json` with new dependencies
    - [x] Run `bun install`
- [x] TUI Infrastructure
    - [x] Create `src/tui/util/color.ts`
    - [x] Create `src/tui/util/event-emitter.ts`
    - [x] Create `src/tui/context/helper.tsx`
    - [x] Copy `src/cli/cmd/tui/flags.ts` to `src/tui/flags.ts`
- [x] Verification
    - [x] Create unit tests for `color.ts`
    - [x] Create unit tests for `event-emitter.test.ts`
    - [x] Run `bun typecheck` in `packages/cli`
    - [x] Run `bun lint:fix`
