# Phase 1A — Project Registry & Directory Bootstrap

> Sub-phase of [02-roadmap.md](./02-roadmap.md) Phase 1.
> Dependencies: None (foundation layer).
> Estimated effort: 5 days.

---

## Goal

Establish the `~/.liteai/projects/<id>/` filesystem structure with deterministic project ID derivation, directory scaffolding on registration, and startup validation. This is the foundation every subsequent phase builds on.

---

## Current State (LiteAI)

### What Already Exists

| Component | File | Status |
|---|---|---|
| `Brand.home` (`.liteai`) | [brand.ts](file:///d:/liteai/packages/core/src/brand.ts) | ✅ Exists |
| `Global.Path.root` (`~/.liteai`) | [global/index.ts](file:///d:/liteai/packages/core/src/global/index.ts#L14) | ✅ Exists |
| `Global.Path.config` (same as root) | [global/index.ts](file:///d:/liteai/packages/core/src/global/index.ts#L17) | ✅ Exists |
| `ProjectID` branded type | [project/schema.ts](file:///d:/liteai/packages/core/src/project/schema.ts) | ✅ Exists |
| `Project.resolve()` (git root → ID) | [project/project.ts](file:///d:/liteai/packages/core/src/project/project.ts#L119-L246) | ✅ Exists |
| `Project.register()` (upsert DB) | [project/project.ts](file:///d:/liteai/packages/core/src/project/project.ts#L252-L361) | ✅ Exists |
| `Project.fromDirectory()` | [project/project.ts](file:///d:/liteai/packages/core/src/project/project.ts#L367-L371) | ✅ Exists |
| `Instance.provide()` (boot + cache) | [project/instance.ts](file:///d:/liteai/packages/core/src/project/instance.ts#L80-L98) | ✅ Exists |
| `InstanceBootstrap()` | [project/bootstrap.ts](file:///d:/liteai/packages/core/src/project/bootstrap.ts#L19-L44) | ✅ Exists |
| `Project.list()` (with auto-archive) | [project/project.ts](file:///d:/liteai/packages/core/src/project/project.ts#L410-L443) | ✅ Exists |
| `ProjectTable` (SQLite schema) | [project/project.sql.ts](file:///d:/liteai/packages/core/src/project/project.sql.ts) | ✅ Exists |

### What's Missing

| Component | Status |
|---|---|
| `~/.liteai/projects/<id>/` filesystem directory per project | ❌ Not created |
| `memory/`, `conversation-history/`, `snapshot/` subdirectory scaffolding | ❌ Not created |
| `Global.Path.projects` path constant | ❌ Not defined |
| Startup scan to validate filesystem artifacts against DB | ❌ Not implemented |

---

## Reference Implementations

### Claude Code — Project Directory Structure

**Source:** [paths.ts](file:///d:/claude-code/src/memdir/paths.ts#L223-L235)

Claude Code derives the project memory path as:
```
~/.claude/projects/<sanitized-git-root>/memory/
```

Key implementation details:
- `getAutoMemPath()` — memoized, keyed on `getProjectRoot()` to recompute if mock changes mid-test
- `sanitizePath(getAutoMemBase())` — sanitizes the canonical git root into a filesystem-safe slug
- `getAutoMemBase()` — resolves via `findCanonicalGitRoot()` so worktrees of the same repo share one memory directory
- `ensureMemoryDirExists()` — called once per session from `loadMemoryPrompt()`, uses recursive mkdir
- **No registry file** — no `projects.json`. The memory directory IS the registry artifact

**What we reuse (pattern):** The concept of `~/.brand/projects/<id>/` with subdirectories. The memoized path resolution pattern.

**What we DON'T reuse:**
- Claude Code sanitizes the git root path into a slug (`sanitizePath()`). We use a SHA-based ID because LiteAI already has `ProjectID` as a branded type derived from git root commits, and slug-based paths would leak worktree paths into the filesystem hierarchy.
- Claude Code has no DB — project metadata lives entirely on the filesystem. LiteAI already has `ProjectTable` in SQLite. The filesystem is a secondary artifact layer, not the source of truth.

### Gemini CLI — Project Directory Structure

**Source:** [memoryDiscovery.ts](file:///d:/gemini-cli/packages/core/src/utils/memoryDiscovery.ts#L506-L545)

Gemini CLI uses:
```
~/.gemini/tmp/<project-hash>/memory/MEMORY.md
```

Key implementation details:
- `getUserProjectMemoryPaths()` — checks for `MEMORY.md` in the project memory dir, falls back to legacy `GEMINI.md`
- Project hash is derived from the working directory
- `findProjectRoot()` — traverses upward looking for `.git` boundary markers
- Memory path is computed per-session, not cached globally

**What we reuse (pattern):** The project-hash-based directory naming. The fallback/migration pattern for legacy files.

**What we DON'T reuse:** The `tmp/` path segment (implies ephemerality, our data is persistent). The single-file memory model (we use index + topic files).

---

## Implementation Plan

### 1. Extend `Global.Path` with `projects` constant

**File:** [global/index.ts](file:///d:/liteai/packages/core/src/global/index.ts)

```typescript
// Add to Global.Path:
projects: path.join(root, "projects"),
```

Add `projects` directory to the startup `mkdir` batch (line 36-43):
```typescript
fs.mkdir(Global.Path.projects, { recursive: true }),
```

> **Origin:** 🔵 LiteAI own implementation. Neither CC nor GC defines a top-level `projects` constant — CC computes it inline from `getMemoryBaseDir() + 'projects'`, GC uses `tmp/<hash>/`.

---

### 2. Add `ProjectFilesystem` namespace

**File:** `src/project/filesystem.ts` (NEW)

A pure filesystem utility namespace — no DB access, no side effects beyond mkdir.

```typescript
export namespace ProjectFilesystem {
  /** Subdirectories scaffolded per project */
  const SUBDIRS = ["memory", "conversation-history", "snapshot"] as const

  /** Resolve the per-project data directory */
  export function projectDir(projectId: string): string {
    return path.join(Global.Path.projects, projectId)
  }

  /** Scaffold the full directory tree for a project */
  export async function scaffold(projectId: string): Promise<void> { ... }

  /** Validate that a project's filesystem artifacts exist */
  export async function validate(projectId: string): Promise<{
    exists: boolean
    missing: string[]
  }> { ... }

  /** Scan ~/.liteai/projects/ for all project directories */
  export async function scan(): Promise<string[]> { ... }
}
```

> **Origin:** 🔵 LiteAI own implementation. CC doesn't have a project filesystem abstraction — `ensureMemoryDirExists()` is called inline. GC's `memoryDiscovery.ts` is a monolithic 950-line file that mixes filesystem ops with instruction loading. We keep these concerns separated.

---

### 3. Hook scaffolding into `Project.register()`

**File:** [project/project.ts](file:///d:/liteai/packages/core/src/project/project.ts#L252-L361)

After the DB upsert in `register()` (line ~353), add:
```typescript
// Scaffold per-project filesystem directory after DB registration
await ProjectFilesystem.scaffold(data.id)
```

This ensures directory creation is triggered on every `fromDirectory()` → `register()` call, which is the single entry point for project creation.

> **Origin:** 🔵 LiteAI own implementation. CC creates the memory dir lazily on first `loadMemoryPrompt()`. GC doesn't create project dirs at all (memory is written by the tool on first `save_memory`). We scaffold eagerly because we have multiple subdirectories (memory, conversation-history, snapshot) that should exist before any subsystem tries to write.

---

### 4. Add startup filesystem validation

**File:** [project/bootstrap.ts](file:///d:/liteai/packages/core/src/project/bootstrap.ts) or `Instance.provide()`

After `Project.resolve()` and `Project.register()` complete during instance boot, validate that the filesystem artifacts exist:

```typescript
const validation = await ProjectFilesystem.validate(project.id)
if (!validation.exists) {
  await ProjectFilesystem.scaffold(project.id)
  log.info("scaffolded missing project filesystem", { projectId: project.id })
}
```

On `Project.list()` (which already does auto-archive for missing worktrees), optionally cross-reference with `ProjectFilesystem.scan()` to detect orphaned directories.

> **Origin:** 🟡 Hybrid. CC's `loadMemoryPrompt()` calls `ensureMemoryDirExists()` which is effectively a lazy validation. GC's `getUserProjectMemoryPaths()` does `fs.access()` checks before returning paths. We combine both patterns: eager scaffolding on registration + validation on boot.

---

### 5. Project ID derivation — Current behavior analysis

The current `Project.resolve()` already implements a sophisticated ID derivation:

| Scenario | ID Source | Code Reference |
|---|---|---|
| Git repo with commits | Root commit SHA | [project.ts:L177-L198](file:///d:/liteai/packages/core/src/project/project.ts#L177-L198) |
| Git repo, no commits | `directoryId(sandbox)` → SHA-1 of path | [project.ts:L189-L196](file:///d:/liteai/packages/core/src/project/project.ts#L189-L196) |
| Non-git directory | `directoryId(directory)` → SHA-1 of path | [project.ts:L239-L245](file:///d:/liteai/packages/core/src/project/project.ts#L239-L245) |
| Cached ID (`.git/liteai`) | Read from cache file | [project.ts:L108-L113](file:///d:/liteai/packages/core/src/project/project.ts#L108-L113) |
| Git worktrees | Shares parent's root commit SHA | [project.ts:L149-L166](file:///d:/liteai/packages/core/src/project/project.ts#L149-L166) |

> **Architecture note:** The 00-architecture.md specifies "SHA-256 of canonical git root, truncated to 12 hex chars." The current implementation uses root commit SHA (full 40 hex chars for git repos) or SHA-1 of the path (truncated to 16 hex chars with `dir_` prefix). **No change needed** — the current ID derivation is more robust than the architecture doc's initial proposal. Root commit SHA is deterministic, collision-resistant, and already handles worktree sharing.

**Comparison:**

| Platform | ID Strategy | Sharing |
|---|---|---|
| Claude Code | `sanitizePath(canonicalGitRoot)` — filesystem slug | Worktrees share via `findCanonicalGitRoot()` |
| Gemini CLI | Hash of working directory | No explicit worktree sharing |
| LiteAI | Root commit SHA (or `dir_<sha1>` fallback) + `.git/liteai` cache | Worktrees share via `--git-common-dir` resolution |

> **Origin:** ✅ LiteAI existing implementation. No changes needed.

---

## File Change Summary

| File | Action | Origin |
|---|---|---|
| [global/index.ts](file:///d:/liteai/packages/core/src/global/index.ts) | MODIFY — add `projects` path + mkdir | 🔵 LiteAI |
| `src/project/filesystem.ts` | NEW — `ProjectFilesystem` namespace | 🔵 LiteAI |
| [project/project.ts](file:///d:/liteai/packages/core/src/project/project.ts) | MODIFY — call `scaffold()` in `register()` | 🔵 LiteAI |
| [project/bootstrap.ts](file:///d:/liteai/packages/core/src/project/bootstrap.ts) | MODIFY — add filesystem validation on boot | 🟡 Hybrid (CC lazy ensure + GC access check) |

---

## Verification Plan

### Unit Tests
- `ProjectFilesystem.scaffold()` creates all expected subdirectories
- `ProjectFilesystem.validate()` correctly detects missing/present directories
- `ProjectFilesystem.scan()` returns all project IDs from filesystem
- `ProjectFilesystem.projectDir()` resolves to `~/.liteai/projects/<id>`

### Integration Tests
- `Project.register()` creates filesystem directory alongside DB row
- `Instance.provide()` scaffolds missing directories on boot
- Worktrees sharing a git root share a project directory
- `Project.list()` + `ProjectFilesystem.scan()` cross-reference correctly

### Manual Verification
- Start core with a new project → verify `~/.liteai/projects/<id>/` exists with all subdirectories
- Delete `~/.liteai/projects/<id>/memory/` → restart → verify it's recreated
