# Web App API Refactor — Overview

## Context

Phase 2 of the API Path Refactor: migrate `packages/web` to:
1. **New flat global API** — remove `global.` prefix (e.g., `client.global.health()` → `client.health()`)
2. **New project-scoped API** — pass `projectID` as method parameter instead of relying on `x-liteai-directory` header

## Key Insight

> **`projectID === base64Encode(directory)`**
>
> The current URL slug `/:dir` is already the project ID. No URL restructuring needed — just pass `projectID` explicitly to SDK methods.

## Architecture

```
CURRENT:  directory → x-liteai-directory header → SDK client auto-scopes all calls
NEW:      directory → projectID = base64(directory) → SDK method param: { projectID }
```

**Design Decision**: Keep `directory` as internal state key (child stores, caches, lookups). Add `projectID` as a derived value for SDK API calls. Both coexist.

## Phases

| Phase | Scope | Files | Depends On |
|-------|-------|-------|------------|
| **1. Foundation** | `toProjectID` utility + SDK context | 3 | — |
| **2. Global Renames** | `client.global.*` → `client.*` | 7 | P1 |
| **3. Core State** | bootstrap, global-sync, sync | 4 | P2 |
| **4. Navigation + Layout** | routing, navigation, sidebar | 6 | P3 |
| **5. Session + Components** | session page, sub-components | 8 | P3 |
| **6. Settings + Dialogs** | remaining components | 4 | P5 |
| **7. Cleanup** | tests, remove deprecated code | 3+ | P6 |

Phases 4 and 5 can run in parallel.

## Impact

- **~28 files** in `web`
- **1 new file** (`utils/project-id.ts`)
- **6 heavily impacted** files (bootstrap.ts, global-sync.tsx, sync.tsx, navigation.ts, session.tsx, workspace-ops.ts)

## Detailed Plans

- [Phase 1-2: Foundation + Global Renames](./webapp-refactor-phase1-2.md)
- [Phase 3: Core State Layer](./webapp-refactor-phase3.md)
- [Phase 4-5: Navigation + Session](./webapp-refactor-phase4-5.md)
- [Phase 6-7: Settings + Cleanup](./webapp-refactor-phase6-7.md)

## Open Questions

1. **File browsing in `dialog-select-directory.tsx`**: `file.list()` and `find.files()` browse arbitrary directories, not registered projects. May need a separate global file browsing API or keep directory-header for these.
2. **TUI sync** (`liteai/src/cli/cmd/tui/context/sync.tsx`): Outside `web`, separate task.
3. **Route param naming**: Should `/:dir` rename to `/:projectID`? Cosmetic — recommend yes for clarity.
