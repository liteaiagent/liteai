# Phase 8 Fix-All Tasks

- [x] **1. Fix `getSnapshot()` referential instability** — `session-tab-store.ts`
  - [x] Cache snapshot object, only recreate on mutation
  - [x] Add `MAX_TABS` enforcement with env var + toast
  - [x] Add `next()`/`prev()` cycle methods
  - [x] Use `readonly` types for snapshot

- [x] **2. Fix `f`/`r` direct-action shortcuts** — `dialog-rewind.tsx`
  - [x] `f` = direct fork (no menu)
  - [x] `r` = direct revert (no menu)
  - [x] Add fork indicator (`⑂`) via `session.children` query

- [x] **3. Fix archived session dimming** — `dialog-session-list.tsx`
  - [x] Dim archived session footer timestamps
  - [x] Prefix archived titles with `📦`
  - [x] Add tab gutter indicator `[N]` for tabbed sessions

- [x] **4. Fix `any` type in dialog-rewind.tsx** — typed as `Snapshot.FileDiff`

- [x] **5. Update walkthrough.md** — covers all 5 components

- [x] **Verification**
  - [x] Run `bun typecheck` — 0 errors
  - [x] Run `bun lint:fix` — 2 files auto-formatted, all clean
