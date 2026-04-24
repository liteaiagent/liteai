# Phase 2.3: Complex Contexts

- [x] Extend `@liteai/ink`
    - [x] Create `packages/ink/src/components/FocusContext.ts`
    - [x] Modify `packages/ink/src/components/AppContext.ts`
    - [x] Modify `packages/ink/src/components/App.tsx` (implement new APIs)
    - [x] Create `packages/ink/src/hooks/use-focus.ts`
    - [x] ~~Create `packages/ink/src/hooks/use-renderer.ts`~~ *(merged into `useApp()` / `AppContext` — no standalone file)*
- [x] Port Contexts to `@liteai/cli`
    - [x] Port `packages/cli/src/tui/context/sync.tsx`
    - [x] Port `packages/cli/src/tui/context/theme.tsx`
    - [x] Port `packages/cli/src/tui/context/local.tsx`
    - [x] Port `packages/cli/src/tui/context/keybind.tsx`
- [x] Verification
    - [x] Run `bun typecheck`
    - [x] Run `bun lint:fix`
