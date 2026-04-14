# Memory System & Dream/Kairos Engine — liteai_cli_mvp

> Sources:
> - `~\Documents\workspace\liteai_cli_mvp\src\services\autoDream\`
> - `~\Documents\workspace\liteai_cli_mvp\src\memdir\`
> - `~\Documents\workspace\liteai_cli_mvp\src\tasks\DreamTask\`
> - `~\Documents\workspace\liteai_cli_mvp\src\tools\AgentTool\agentMemory.ts`
> - `~\Documents\workspace\liteai_cli_mvp\src\tools\BriefTool\`
> - `~\Documents\workspace\liteai_cli_mvp\src\tools\SleepTool\`

---

## Overview

liteai_cli_mvp's memory system operates at three layers: **per-session memory** (extracting facts from conversations), **persistent agent memory** (scoped to user/project/local), and the **Dream engine** (Kairos) — a background consolidation process that periodically synthesizes recent session knowledge into durable, well-organized memory files. It's the AI equivalent of sleep-based memory consolidation.

---

## 1. Memory Architecture

### Memory Types

```ts
const MEMORY_TYPE_VALUES = ['User', 'Project', 'Local', 'Managed', 'AutoMem', 'TeamMem'] as const
```

| Type | Scope | Location | Purpose |
|---|---|---|---|
| `User` | Cross-project | `~/.claude/agent-memory/<agent>/` | General learnings across all projects |
| `Project` | Per-project, shared | `.claude/agent-memory/<agent>/` | Project-specific knowledge, version controlled |
| `Local` | Per-project, private | `.claude/agent-memory-local/<agent>/` | Machine-specific knowledge, not VCS |
| `Managed` | Admin-controlled | Policy settings | Organization-level memory |
| `AutoMem` | Auto-extracted | `~/.claude/memory/` (or custom) | Session-extracted memories |
| `TeamMem` | Team-shared | Remote mount | Team-level shared memory (feature-gated) |

### Remote Memory Mount

```ts
// When CLAUDE_CODE_REMOTE_MEMORY_DIR is set, local scope persists to mount
if (process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR) {
  return join(
    process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR,
    'projects',
    sanitizePath(findCanonicalGitRoot(getProjectRoot()) ?? getProjectRoot()),
    'agent-memory-local',
    dirName,
  )
}
```

---

## 2. Agent Memory — Persistent Per-Agent State

**Source:** [`agentMemory.ts`](../../liteai_cli_mvp/src/tools/AgentTool/agentMemory.ts)

Each agent can have its own persistent memory directory with a scope declaration:

```yaml
# Agent frontmatter
---
name: my-agent
memory: user  # or 'project' or 'local'
---
```

### Memory Loading

On agent spawn, the memory directory is created (fire-and-forget `mkdir`) and a prompt is injected:

```ts
function loadAgentMemoryPrompt(agentType, scope): string {
  const memoryDir = getAgentMemoryDir(agentType, scope)
  void ensureMemoryDirExists(memoryDir)  // Fire-and-forget — agent won't write until API round-trip
  
  return buildMemoryPrompt({
    displayName: 'Persistent Agent Memory',
    memoryDir,
    extraGuidelines: [
      scopeNote,  // "user-scope: keep learnings general" etc.
    ],
  })
}
```

### Memory Entrypoint

Each memory directory has a `MEMORY.md` index file that serves as the starting point. The entrypoint is capped at `MAX_ENTRYPOINT_LINES` (~25KB) and acts as a table of contents pointing to topic files.

### Memory Snapshots

Project-level memory supports snapshots for bootstrapping:

```ts
async function initializeAgentMemorySnapshots(agents) {
  // For each agent with memory === 'user':
  //   1. Check if project has a snapshot
  //   2. If no local memory exists → initialize from snapshot
  //   3. If newer snapshot available → flag pending update
}
```

### Security

```ts
// Path traversal protection
function isAgentMemoryPath(absolutePath: string): boolean {
  const normalizedPath = normalize(absolutePath)
  // Checks all three scopes (user, project, local) with proper normalization
}
```

---

## 3. The Dream Engine (AutoDream)

**Source:** [`autoDream.ts`](../../liteai_cli_mvp/src/services/autoDream/autoDream.ts)

### What It Does

The Dream engine is a **background memory consolidation process** that fires as a forked sub-agent. It reviews recent session transcripts and synthesizes learnings into durable, organized memory files. It's analogous to how biological sleep consolidates short-term memory into long-term storage.

### Gate Chain (Cheapest First)

```
1. Feature gate:   isAutoDreamEnabled() && !getKairosActive() && !isRemoteMode()
2. Time gate:      hours since lastConsolidatedAt >= minHours (default: 24)
3. Scan throttle:  10 minutes between session scans
4. Session gate:   transcript count since last consolidation >= minSessions (default: 5)
5. Lock gate:      no other process mid-consolidation
```

### Configuration

```ts
const DEFAULTS: AutoDreamConfig = {
  minHours: 24,     // Wait at least 24h between consolidations
  minSessions: 5,   // Need at least 5 new sessions to justify consolidation
}
```

Configurable via feature flag `tengu_onyx_plover` with per-field validation.

### Execution Flow

```
initAutoDream()       ← Called once at startup
  │
  ▼ (registered as post-turn hook)
executeAutoDream()    ← Called after each model turn
  │
  ├── Gate checks (time, sessions, lock)
  │
  ├── registerDreamTask(setAppState)  ← UI: shows "dreaming" pill
  │
  ├── buildConsolidationPrompt()      ← 4-phase prompt
  │
  ├── runForkedAgent({
  │     promptMessages: [consolidation prompt],
  │     cacheSafeParams: createCacheSafeParams(context),
  │     canUseTool: createAutoMemCanUseTool(memoryRoot),  ← write-restricted
  │     querySource: 'auto_dream',
  │     onMessage: makeDreamProgressWatcher(),
  │   })
  │
  ├── completeDreamTask()  ← UI: hide pill
  │
  └── appendSystemMessage()  ← "Improved N memories" inline notification
```

### The Consolidation Prompt (4 Phases)

```markdown
# Dream: Memory Consolidation

## Phase 1 — Orient
- `ls` the memory directory to see what already exists
- Read `MEMORY.md` to understand the current index
- Skim existing topic files to avoid duplicates

## Phase 2 — Gather recent signal
1. Daily logs (if present)
2. Existing memories that contradict codebase state
3. Narrow grep on JSONL transcripts (DO NOT read whole files)

## Phase 3 — Consolidate
- Merge new signal into existing topic files
- Convert relative dates to absolute
- Delete contradicted facts

## Phase 4 — Prune and index
- Update MEMORY.md (keep under MAX_ENTRYPOINT_LINES, ~25KB)
- Remove stale pointers
- Demote verbose entries
- Resolve contradictions
```

### Tool Constraints

Auto-dream runs with **restricted permissions**:
- Bash: read-only commands only (`ls`, `find`, `grep`, `cat`, `stat`, `wc`, `head`, `tail`)
- File Write/Edit: limited to the memory directory
- No network access, no destructive operations

### DreamTask UI

The dream process is tracked as a background task with a "dreaming" pill label:

```ts
type DreamTaskState = TaskStateBase & {
  type: 'dream'
  phase: DreamPhase  // 'starting' | 'updating'
  sessionsReviewing: number
  filesTouched: string[]
  turns: DreamTurn[]  // { text, toolUseCount }
}
```

Users can kill the dream via the background tasks dialog → `abortController.abort()` → lock rollback.

### Lock System

```ts
// Consolidation lock prevents multiple concurrent dreams
tryAcquireConsolidationLock()   → priorMtime | null
rollbackConsolidationLock(mtime) → restores mtime on failure
readLastConsolidatedAt()         → timestamp of last successful consolidation
```

The lock file's mtime doubles as the "last consolidated at" timestamp — acquiring bumps it, rollback restores it.

---

## 4. KAIROS / Brief System

**Source:** `BriefTool/`, `SleepTool/`

KAIROS is the **proactive agent layer** — when active, it replaces the standard system prompt with an autonomous-agent prompt and adds specialized tools:

### Feature Flag Hierarchy

```
PROACTIVE  → Base proactive features (SleepTool)
KAIROS     → Full Kairos engine (Brief, Sleep, SendFile, PushNotification)
KAIROS_BRIEF → Just the brief generation tool
```

### BriefTool

Generates "briefs" — periodic summary reports of what happened. Has a proactive section in the system prompt:

```ts
const BRIEF_PROACTIVE_SECTION = `...`  // Injected into system prompt
```

### SleepTool

Allows the agent to enter a sleep/idle state, configurable for wake conditions. Used in proactive/KAIROS mode for scheduled wake-ups.

### Memory Integration

When KAIROS is active:
- `getKairosActive()` returns true → auto-dream uses the disk-based `/dream` skill instead of the auto-dream fork
- The system prompt switches to autonomous mode
- Additional tools (PushNotification, SendUserFile, SubscribePR) are unlocked

---

## 5. Session Memory Extraction

**Source:** `services/extractMemories/`

Separate from dream — this runs **during** the session:

```ts
import { createAutoMemCanUseTool } from '../services/extractMemories/extractMemories'
```

Extracts facts from the current conversation and saves them to the auto-memory directory. Dream consolidation later reviews these along with session transcripts.

---

## Comparison: liteai vs liteai_cli_mvp (Memory)

| Dimension | liteai | liteai_cli_mvp |
|---|---|---|
| Session memory | None | Auto-extraction during session |
| Persistent memory | None | Per-agent scoped (user/project/local) |
| Memory consolidation | None | Dream engine — periodic background synthesis |
| Memory index | None | `MEMORY.md` entrypoint with size caps |
| Background task UI | None | DreamTask with "dreaming" pill |
| Lock system | None | File-based mtime lock with rollback |
| Proactive mode | None | KAIROS — autonomous agent with briefs/sleep |
| Tool constraints | N/A | Read-only bash, memory-only writes |
| Remote memory | None | `CLAUDE_CODE_REMOTE_MEMORY_DIR` mount |
| Team memory | None | TeamMem (feature-gated) |
