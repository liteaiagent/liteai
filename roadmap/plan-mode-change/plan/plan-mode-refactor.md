# Plan Mode — Complete Port from liteai2

Reference docs:
- [liteai plan mode](../specs/plan-mode.md)
- [liteai2 plan mode](../specs/plan-mode-liteai2.md)

---

## Goal

A complete adoption of the liteai2 plan mode architecture, adapted to liteai's codebase.

**Key commitments:**
- Plans stored in `~/.liteai/plans/` via `Global.Path.root` (equivalent of liteai2's `~/.claude/plans/`)
- Plan filenames keep the current `<timestamp>-<slug>.md` format (liteai exception vs liteai2's word-slug)
- Tool renamed: `plan_exit` → `exit_plan_mode` / `plan_enter` → `enter_plan_mode`
- `question` tool renamed to `ask_user` (**core-only change** — web/vscode use the `Question` system via bus events and API routes, not the tool ID)
- Attachment-style, ephemeral prompt injection replacing persisted synthetic DB parts for reminders
- Full/sparse reminder cycle: full on first turn, sparse every 5 human turns thereafter
- Plan content embedded in `exit_plan_mode` tool result (model enters build with plan in context)
- `enter_plan_mode` tool re-enabled (bidirectional plan↔build switching)
- Post-compaction plan file reference injection

---

## Phase 1 — `ask_user` Tool Rename

**Goal:** Rename the `question` tool to `ask_user` to match liteai2's `AskUserQuestion` semantics.

**Scope:** `packages/core` only. Web and vscode do **not** reference the tool ID at all. Their `question.*` references (`question.asked` bus events, `QuestionRequest` types, `project.question.reply` API routes, UI state keys) belong to the `Question` subsystem — a separate concept named after what it does, not after the tool. They are completely unaffected by this rename.

### Subsystems

| File | Action |
|---|---|
| `src/tool/question.ts` | **Modify** — change tool ID `"question"` → `"ask_user"` |
| `src/tool/question.txt` | **Modify** — update description text |
| `src/bundled/agents/plan.md` | **Modify** — `question: allow` → `ask_user: allow`; update prose |
| `src/bundled/agents/build.md` | **Modify** — `question: allow` → `ask_user: allow` |
| `src/bundled/prompts/misc/plan-reminder-new.md` | **Modify** — `question tool` → `ask_user` |
| `src/bundled/prompts/misc/plan-reminder-exists.md` | **Modify** — same |
| `src/bundled/prompts/system/trinity.md` | **Modify** — `question tool` → `ask_user` |
| Any other `.md`/`.txt` under `src/bundled/` referencing `question tool` | **Search and update** |

---

## Phase 2 — Plan File Subsystem

**Goal:** Replace `Session.plan()` (project-relative, `timestamp-slug.md`) with a global `~/.liteai/plans/` directory. **Plan filenames keep the current `<timestamp>-<slug>.md` format** — deliberate exception from liteai2's word-slug approach.

### Subsystems

| File | Action |
|---|---|
| `src/plan/index.ts` | **New** — `Plan` namespace: `getPlansDirectory()`, `getPlanFilePath()`, `getPlan()` |
| `src/session/index.ts` | **Modify** — remove `Session.plan()`; replace all callsites with `Plan.getPlanFilePath(session)` |
| `src/session/engine/plan-reminder.ts` | **Modify** — `Session.plan(session)` → `Plan.getPlanFilePath(session)` |
| `src/tool/plan.ts` | **Modify** — `Session.plan(...)` → `Plan.getPlanFilePath(session)` |
| `src/bundled/agents/plan.md` | **Modify** — update path description to `~/.liteai/plans/` |
| `src/config/` (settings schema) | **Modify** — add optional `plansDirectory?: string` |

### Plan File Path

```ts
// src/plan/index.ts
export namespace Plan {
  export function getPlansDirectory(): string {
    // Configurable via settings.plansDirectory (relative to project cwd)
    // Default: ~/.liteai/plans using Global.Path.root
    const settings = Config.get()
    if (settings.plansDirectory) {
      return path.resolve(Instance.directory, settings.plansDirectory)
    }
    return path.join(Global.Path.root, "plans")
  }

  // Keeps liteai's timestamp-slug naming convention
  export function getPlanFilePath(session: Session.Info): string {
    const base = [session.time.created, session.slug].join("-")
    return path.join(getPlansDirectory(), `${base}.md`)
  }

  export function getPlan(session: Session.Info): string | null {
    try { return fsSync.readFileSync(getPlanFilePath(session), "utf-8") }
    catch (e) { if (isENOENT(e)) return null; throw e }
  }
}
```

`getPlansDirectory()` creates the directory with `mkdirSync({ recursive: true })` on first access, replacing the inline `fs.mkdir` in `plan-reminder.ts`.

`settings.plansDirectory` mirrors liteai2 — allows a project-relative path to use local plans instead of the global directory.

---

## Phase 3 — Attachment-Style Reminder Injection

**Goal:** Replace the one-shot persisted `Session.updatePart()` injection with an ephemeral, per-turn attachment pipeline implementing the full/sparse reminder cycle.

### Subsystems

| File | Action |
|---|---|
| `src/session/engine/plan-reminder.ts` | **Rewrite** — turn counting, full/sparse selection, ephemeral injection |
| `src/bundled/prompts/misc/plan-reminder.md` | **New** — single unified full reminder |
| `src/bundled/prompts/misc/plan-reminder-sparse.md` | **New** — one-paragraph sparse variant |
| `src/bundled/prompts/misc/plan-reminder-new.md` | **Delete** |
| `src/bundled/prompts/misc/plan-reminder-exists.md` | **Delete** |
| `src/bundled/agents/plan.md` | **Modify** — strip 5-phase workflow (now owned by reminder MD); keep identity + constraints only |
| `src/session/engine/loop.ts` | **No change** — already calls `insertPlanReminder` every turn |
| `src/session/message.ts` | **No change** — `toModelMessages` already passes synthetic parts |

### Reminder Cycle

```
TURNS_BETWEEN_INJECTIONS = 5   // skip if < 5 human turns since last reminder
FULL_EVERY_N_INJECTIONS  = 5   // full on 1st, 6th, 11th... sparse in between
```

Walk backwards through `messages[]`, count non-synthetic, non-tool-result user messages since the last plan-reminder injection. Use cumulative injection count to decide full vs sparse.

### Persistence Model

| Injection | Persisted to DB? | Visible in UI? |
|---|---|---|
| Full / first-turn | ✅ `Session.updatePart` | Yes — "SYSTEM INJECTED" |
| Sparse / subsequent | ❌ in-memory `msgs[]` append only | No — same pattern as `max-steps` |

### Reminder MD Content

`plan-reminder.md` placeholders:
- `{{PLAN_STATUS}}` — TS inline ternary: new file or existing
- `{{PLAN_PATH}}` — `Plan.getPlanFilePath(session)`
- Full 5-phase workflow (moved from `plan.md`)

`plan-reminder-sparse.md`:
> *"Plan mode active. Read-only except for the plan file at `{{PLAN_PATH}}`. End turn with `ask_user` (clarifications) or `exit_plan_mode` (plan approval). Do not ask about approval via text."*

---

## Phase 4 — `exit_plan_mode` Tool + Build-Switch Content Injection

**Goal:** Rename `plan_exit` → `exit_plan_mode`, embed full plan content in its tool result so the model enters build mode with the approved plan already in context.

### Subsystems

| File | Action |
|---|---|
| `src/tool/plan.ts` | **Modify** — rename `PlanExitTool` → `ExitPlanModeTool`, ID `exit_plan_mode`; read and embed plan content on approval |
| `src/tool/plan-exit.txt` | **Modify** — update description |
| `src/bundled/agents/plan.md` | **Modify** — `plan_exit: allow` → `exit_plan_mode: allow` |
| `src/bundled/agents/build.md` | **Modify** — `plan_enter: allow` → `enter_plan_mode: allow` |
| `src/tool/registry.ts` | **Modify** — update import name |
| `src/bundled/prompts/misc/build-switch.md` | **Modify** — add `{{PLAN_CONTENT}}` placeholder |

### Tool Result (matches liteai2 pattern)

```ts
`User has approved your plan. You can now edit files and run tools. Execute the plan.

## Approved Plan:
${planContent}

(Saved at ${planFilePath})`
```

### Build-Switch Message

```ts
const planContent = Plan.getPlan(session)
const buildSwitch = await Bundled.miscPrompt("build-switch")
const text = planContent
  ? buildSwitch
      .replace("{{PLAN_PATH}}", planFilePath)
      .replace("{{PLAN_CONTENT}}", planContent)
  : buildSwitch
      .replace("{{PLAN_PATH}}", planFilePath)
      .replace("{{PLAN_CONTENT}}", "(Plan file not found — use the read tool)")
```

Approval flow unchanged: `exit_plan_mode` calls `Question.ask`. No editable plan view in this phase.

---

## Phase 5 — `enter_plan_mode` Tool + Post-Compaction Reference

### Phase 5a — `enter_plan_mode` Tool

**Goal:** Allow the build agent to propose entering plan mode. Rename `plan_enter` → `enter_plan_mode` and uncomment the existing implementation.

| File | Action |
|---|---|
| `src/tool/plan.ts` | **Modify** — uncomment `PlanEnterTool`, rename → `EnterPlanModeTool`, ID `enter_plan_mode` |
| `src/tool/plan-enter.txt` | **Modify** — update description |
| `src/tool/registry.ts` | **Modify** — register `EnterPlanModeTool` |
| `src/bundled/agents/build.md` | **Verify** — `enter_plan_mode: allow` set (from Phase 4 change) |

**Guard (detailed plan to define):** Warn or block if file-writing tools were already called in the current exchange.

### Phase 5b — Post-Compaction Plan Reference

**Goal:** After compaction, re-inject the plan file content so it survives context clearing.

| File | Action |
|---|---|
| `src/session/tasks/compaction.ts` | **Modify** — if `Plan.getPlan(session)` non-null post-compaction, append plan reference as synthetic user part |
| `src/bundled/prompts/misc/plan-file-reference.md` | **New** — template with `{{PLAN_PATH}}` and `{{PLAN_CONTENT}}` |
| `src/session/engine/plan-reminder.ts` | **Modify** — detect compaction boundary → force full reminder regardless of turn count |

Reference content:
```
A plan file from the previous planning session exists at {{PLAN_PATH}}.

Plan contents:
{{PLAN_CONTENT}}

If this plan is relevant to the current work and not already complete, continue working on it.
```

---

## Phase Summary

| Phase | Core Change | Risk | Dependencies |
|---|---|---|---|
| **1** — `ask_user` rename | Tool ID in core only; zero web/vscode impact | Low | None |
| **2** — Plan file subsystem | New `src/plan/` module; `~/.liteai/plans/`; timestamp-slug kept | Low | None |
| **3** — Attachment injection | Ephemeral full/sparse cycle; unified reminder MD | Medium | Phase 1, 2 |
| **4** — `exit_plan_mode` tool | Rename + plan content in tool result + build-switch | Low | Phase 2, 3 |
| **5a** — `enter_plan_mode` | Uncomment + register `EnterPlanModeTool` | Low | Phase 4 |
| **5b** — Post-compaction | Plan survives context clearing | Medium | Phase 2 |

**Execution order:** 1 → 2 → 3 → 4 → 5a → 5b

---

## Files Inventory

### New
- `src/plan/index.ts` — Plan namespace
- `src/bundled/prompts/misc/plan-reminder.md` — unified full reminder
- `src/bundled/prompts/misc/plan-reminder-sparse.md` — sparse reminder
- `src/bundled/prompts/misc/plan-file-reference.md` — post-compaction reference

### Deleted
- `src/bundled/prompts/misc/plan-reminder-new.md`
- `src/bundled/prompts/misc/plan-reminder-exists.md`

### Modified (all in `packages/core/src/`)
- `tool/question.ts` — ID `ask_user`
- `tool/question.txt`
- `tool/plan.ts` — rename tools, embed content, use `Plan.*`
- `tool/plan-exit.txt`
- `tool/plan-enter.txt`
- `tool/registry.ts`
- `bundled/agents/plan.md`
- `bundled/agents/build.md`
- `bundled/prompts/misc/build-switch.md`
- `bundled/prompts/system/trinity.md`
- `session/index.ts` — remove `Session.plan()`
- `session/engine/plan-reminder.ts` — full rewrite
- `session/tasks/compaction.ts`
- `config/` — add `plansDirectory` to schema
