# Quickstart: Agent Taxonomy & Rename (Phase 1)

**Branch**: `012-agent-taxonomy-rename`

## Prerequisites

- Bun installed and available on PATH
- Repository cloned and dependencies installed (`bun install`)
- On branch `012-agent-taxonomy-rename`

## Verification After Implementation

### 1. Type Check

```bash
bun typecheck
```

Must pass with zero errors.

### 2. Lint Fix

```bash
bun lint:fix
```

Must pass cleanly.

### 3. Scoped Tests

```bash
bun test test/agent
bun test test/tool
bun test test/coordinator
bun test test/plan-mode
bun test test/session/engine
bun test test/permission-task.test.ts
bun test test/bundled
```

All scoped tests must pass.

### 4. Grep Validation (No Stale References)

```bash
# No "task" tool ID in source (excluding comments, test fixtures, and this spec)
grep -rn '"task"' packages/core/src/ --include="*.ts" | grep -v "// " | grep -v test

# No "build" agent name in source
grep -rn '"build"' packages/core/src/agent/ --include="*.ts" | grep -v "// "

# No old file names
ls packages/core/src/tool/task.ts 2>/dev/null && echo "FAIL: task.ts still exists"
ls packages/core/src/tool/task_stop.ts 2>/dev/null && echo "FAIL: task_stop.ts still exists"
ls packages/core/src/bundled/agents/build.md 2>/dev/null && echo "FAIL: build.md still exists"
ls packages/core/src/bundled/prompts/tools/task.txt 2>/dev/null && echo "FAIL: task.txt still exists"
```

### 5. Manual Smoke Test

```bash
bun run dev
# In LiteAI:
# 1. Verify root agent is "liteai" (check session title/agent name)
# 2. Send a request that triggers subagent delegation
# 3. Verify tool call uses "agent" ID in trace output
```

## Implementation Order

1. **File renames** (git mv) — `task.ts`, `task_stop.ts`, `build.md`, `task.txt`
2. **Class/export renames** — `TaskTool` → `AgentTool`, `TaskStopTool` → `AgentStopTool`
3. **String literal updates** — tool IDs, permission names, filter sets
4. **Prompt text updates** — reword task.txt → agent.txt content
5. **Agent definition update** — `build.md` → `liteai.md` with updated frontmatter
6. **Migration logic** — `default_agent: "build"` → `"liteai"` remap
7. **Test updates** — update all test references
8. **Verify** — typecheck, lint, scoped tests, grep validation
