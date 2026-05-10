# Permission Storage Rationalization

> **Status:** Proposed  
> **Package:** `packages/core`  
> **Prerequisite for:** Phase 1+ of [Coordinator Swarms](./07-coordinator-swarms.md)

## Problem Statement

LiteAI currently maintains **two separate permission persistence mechanisms** that overlap in
purpose and create confusion about where the source of truth lives:

| Storage | Table | Keyed by | Stores |
|---------|-------|----------|--------|
| **Project-level** | `PermissionTable` | `project_id` | "Always allow" rules (accumulated cross-session) |
| **Session-level** | `SessionTable.permission` | `session_id` | A `Ruleset` column on each session row |

The session-level column conflates two things:
1. **Session-scoped rules** — ephemeral "for this session" overrides. These should be runtime-only.
2. **Initial ruleset seeding** — a coordinator creating a child session with pre-configured rules.

Claude Code does **not** persist permission rules in a database at all. Their model:
- Durable rules → settings files on disk (`userSettings`, `projectSettings`, `localSettings`)
- Session-scoped rules → in-memory only (die when session ends)
- `session` destination explicitly does NOT support persistence

The `SessionTable.permission` column is a legacy artifact that should be removed.

## Proposed Changes

### Phase 1: Remove `SessionTable.permission` column

1. **Drop column** from `SessionTable` definition in `session.sql.ts`
2. **Remove `Session.setPermission()`** function in `session/index.ts`
3. **Remove `permission` field** from `Session.Info` schema and `fromRow()`/`toRow()` mappers
4. **Update rule merge sites** in `tools.ts` and `loop.ts` — stop merging `session.permission`
5. **Migration** — add a SQLite migration to drop the column (or leave it as unused; SQLite
   doesn't reclaim space on column drops without `VACUUM`)

### Phase 2: Consolidate "Always Allow" to Settings Files (future)

Align with Claude Code's model:
- Move "always allow" rules from `PermissionTable` (SQLite) → project settings file (`.liteai/settings.json`)
- Keep `PermissionTable` only if DB-backed persistence is architecturally preferred over flat files
- Add UI for rule review/revocation (blocked on CLI permission management UI)

> [!NOTE]
> Phase 2 is deferred. The current `PermissionTable` (project-keyed) is functional and correct
> for the "always allow" use case. The session column is the urgent problem.
