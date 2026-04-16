# Quickstart: Plan Mode MVP Parity

## Prerequisites

- Bun 1.x runtime
- `packages/core` builds clean (`bun typecheck` passes)
- Access to `liteai_cli_mvp/src` for MVP source reference

## Implementation Order

1. **Start with Layer 1 (Legacy Purge)** — delete `plan-explore.md`, remove inject patterns, clean `agent.ts`
2. **Run `bun typecheck`** — verify no broken references
3. **Layer 2 (MVP Prompt Porting)** — create workflow files, rewrite agent prompts, update system prompt
4. **Layer 3 (Tool Behavior)** — refactor `PlanEnterTool` and `PlanExitTool`
5. **Layer 4 (Plan Reminder)** — invert guard condition
6. **Run `bun test test/plan-mode/`** — expect failures (intentional changes)
7. **Layer 5 (Test Updates)** — update tests for new behavior
8. **Run `bun typecheck && bun lint:fix`** — final verification
9. **Layer 6 (Legacy Verification)** — grep for residual legacy patterns

## Key Commands

```bash
# Scoped typecheck
bun typecheck

# Scoped tests
bun test test/plan-mode/

# Lint fix
bun lint:fix

# Legacy search verification (SC-009)
grep -r 'agent: "plan"' packages/core/src/
grep -r 'agent: "build"' packages/core/src/
grep -r 'plan-explore' packages/core/src/
```

## Critical Rules

1. **Read MVP source before writing any code** (C-006)
2. **Port prompts verbatim from MVP** — no custom authoring (C-004)
3. **Delete before creating** — purge legacy artifacts before writing replacements (C-005)
4. **Verify with grep after completion** — zero residual legacy references (C-007, SC-009)
