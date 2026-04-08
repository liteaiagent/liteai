# Phase 1: Flag Cleanup — Execution Spec

> **Parent:** [`experimental-audit.md`](../spec/experimental-audit.md) — full audit plan covering all 4 phases + design rationales
> **Risk:** Low — env var renames, flag removals, one package move
> **Verification:** `bun typecheck` + `bun lint:fix` after each task. Scoped tests per task.

---

## Scope

Remove the master `LITEAI_EXPERIMENTAL` toggle and promote/rename 10 environment flags. Two flags (`OXFMT`, `LSP_TY`) are **deferred** to Phase 1b (mutex refactor). One flag (`DISABLE_COPY_ON_SELECT`) moves from `core` to `cli`.

---

## Tasks

### 1. Remove `LITEAI_EXPERIMENTAL` master flag
- **File:** `packages/core/src/flag/flag.ts`
- **Action:** Delete the `LITEAI_EXPERIMENTAL` definition. Find all `LITEAI_EXPERIMENTAL ||` fallback expressions and replace with the sub-flag's own default.
- **Consumers:** `ICON_DISCOVERY`, `OXFMT`, `WORKSPACES` use `EXPERIMENTAL || false` as their default
- **Test:** `bun typecheck`

### 2. Promote `EXPERIMENTAL_FILEWATCHER`
- **Files:** `flag/flag.ts`, `file/watcher.ts:78`
- **Action:** Remove the flag gate. The file watcher should always subscribe to `Instance.directory` (enable by default).
- **Test:** `bun test test/file`

### 3. Rename `EXPERIMENTAL_DISABLE_FILEWATCHER` → `DISABLE_FILEWATCHER`
- **Files:** `flag/flag.ts`, `file/watcher.ts:121`
- **Action:** Simple rename. Update the env var name in flag definition and the consumer.
- **Test:** `bun typecheck`

### 4. Promote `EXPERIMENTAL_ICON_DISCOVERY`
- **Files:** `flag/flag.ts`, `project/project.ts:311`
- **Action:** Remove flag gate. Always run icon `discover()`.
- **Test:** `bun test test/project`

### 5. Move `EXPERIMENTAL_DISABLE_COPY_ON_SELECT` to `packages/cli`
- **This is a cross-package move, not a simple rename.**
- **From:** `packages/core/src/flag/flag.ts` — delete the definition entirely
- **To:** `packages/cli` — create a local flag definition (e.g. `cli/flags.ts` or inline in consumers)
- **Consumers (all in CLI):**
  - `packages/cli/src/cli/cmd/tui/ui/dialog.tsx:179`
  - `packages/cli/src/cli/cmd/tui/app.tsx:224`
  - `packages/cli/src/cli/cmd/tui/app.tsx:809`
- **Rename:** `EXPERIMENTAL_DISABLE_COPY_ON_SELECT` → `DISABLE_COPY_ON_SELECT`
- **Default:** `true` on Windows, `false` otherwise
- **Test:** `bun typecheck` for both `core` and `cli` packages

### 6. Rename `EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` → `BASH_TIMEOUT_MS`
- **Files:** `flag/flag.ts`, `tool/run_command.ts:20`
- **Action:** Rename env var. Update consumer reference.
- **Test:** `bun typecheck`

### 7. Rename `EXPERIMENTAL_OUTPUT_TOKEN_MAX` → `OUTPUT_TOKEN_MAX`
- **Files:** `flag/flag.ts`, `provider/transform/options.ts:8`
- **Action:** Rename env var. Update consumer reference.
- **Test:** `bun typecheck`

### 8. Promote `EXPERIMENTAL_WORKSPACES`
- **Files:** `flag/flag.ts`, `control-plane/workspace-router-middleware.ts:40`, `cli/app.tsx:380`, `cli/header.tsx:106,163`
- **Action:** Remove flag gate. Enable workspace routing by default.
- **Test:** `bun typecheck`, `bun test test/control-plane` (if exists)

### 9. Promote `EXPERIMENTAL_MARKDOWN`
- **Files:** `flag/flag.ts`, `cli/parts.tsx:76,84`
- **Action:** Already default `true`. Remove the flag entirely — always render markdown.
- **Test:** `bun typecheck`

### 10. Rename `ENABLE_EXPERIMENTAL_MODELS` → `ENABLE_ALPHA_MODELS`
- **Files:** `flag/flag.ts`, `provider/state.ts:386`
- **Action:** Rename env var. Update consumer reference.
- **Test:** `bun typecheck`

---

## Deferred (Phase 1b)

The following flags are **NOT** included in this phase. They require the mutex-per-extension refactor first:

| Flag | Reason |
|------|--------|
| `EXPERIMENTAL_OXFMT` | Promoting oxfmt without a per-extension mutex allows both oxfmt AND prettier to format `.ts` files — causing conflicts |
| `EXPERIMENTAL_LSP_TY` | Promoting ty without a per-extension mutex means both ty AND pyright run on `.py` files |

See Phase 1b in [`experimental-audit.md`](../spec/experimental-audit.md) for the mutex refactor plan.

---

## Execution Order

Tasks are ordered by dependency and risk:
1. **Task 1** first (master flag removal unlocks sub-flag changes)
2. **Tasks 2–4** (simple promotions — remove gates)
3. **Tasks 6–7** (simple renames in core)
4. **Task 10** (simple rename in core)
5. **Task 8** (promotion with CLI consumers)
6. **Task 9** (promotion with CLI consumers)
7. **Task 5** last (cross-package move — highest risk in this phase)

Run `bun typecheck` after each task. Run `bun lint:fix` at the end.
