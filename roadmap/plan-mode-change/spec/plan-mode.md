# Plan Mode

Plan mode is a read-only research phase that runs before implementation. The model explores the codebase, asks the user clarifying questions, and writes a structured plan file. No edits to the project are permitted until the plan is approved and the session switches to the build agent.

---

## Agent Definition

**Source:** [`src/bundled/agents/plan.md`](../src/bundled/agents/plan.md)

The `plan` agent is declared as a bundled agent with YAML frontmatter and a system prompt body. It is loaded at startup by `Agent.loadBuiltinAgents()` in [`src/agent/agent.ts`](../src/agent/agent.ts#L37).

```yaml
name: plan
mode: primary
description: "Plan mode. Read and research only — produces a plan document before any implementation."
permission:
  question: allow      # can ask user questions
  plan_exit: allow     # can call the exit tool
  edit:
    "*": deny                    # all file edits denied
    ".liteai/plans/*.md": allow  # except the plan file
```

The body of `plan.md` becomes `agent.prompt`, which is prepended to the system prompt on **every turn** (in [`src/session/llm.ts`](../src/session/llm.ts#L76)):

```ts
...(input.agent.prompt ? [input.agent.prompt] : ... await SystemPrompt.provider(input.model))
```

---

## Plan File Path

**Source:** [`src/session/index.ts`](../src/session/index.ts#L366)

```ts
export function plan(input: { slug: string; time: { created: number } }) {
  const rootDir = Instance.project.vcs ? Instance.worktree : Instance.directory
  const base = path.join(rootDir, Brand.dir, "plans")
  return path.join(base, `${[input.time.created, input.slug].join("-")}.md`)
}
```

- VCS projects: path is relative to the **worktree root** (`.liteai/plans/<timestamp>-<slug>.md`)
- Non-VCS projects: path is relative to the **working directory**
- The filename encodes the session creation timestamp and slug for uniqueness

The agent is told to save plans to `.liteai/plans/YYYY-MM-DD-<feature-name>.md` in its system prompt, but the _actual_ path resolved for `{{PLAN_PATH}}` injection uses the timestamp+slug form above.

---

## Prompt Injection on Mode Entry

**Source:** [`src/session/engine/plan-reminder.ts`](../src/session/engine/plan-reminder.ts)

`insertPlanReminder()` is called once per loop iteration in [`src/session/engine/loop.ts`](../src/session/engine/loop.ts#L363) before the LLM call:

```ts
msgs = await insertPlanReminder({ messages: msgs, agent, session })
```

### Entering Plan Mode

Triggered when: `agent.name === "plan"` and the **previous** assistant message was not from the plan agent (i.e. the first turn in plan mode).

1. Ensures the plan directory exists (`fs.mkdir` with `recursive: true`)
2. Picks the appropriate prompt template:
   - **New session** → `prompts/misc/plan-reminder-new.md`
   - **Existing plan file** → `prompts/misc/plan-reminder-exists.md`
3. Replaces `{{PLAN_PATH}}` with the resolved absolute path
4. Persists the reminder as a **synthetic** `text` part on the current user message (via `Session.updatePart`)

The reminder is **persisted to the database** and appears in the conversation history. It is visible in the web UI as "SYSTEM INJECTED" and flows through `toModelMessages()` (since `synthetic` parts are not filtered — only `ignored` parts are).

**Reminder content** (both variants, [`plan-reminder-new.md`](../src/bundled/prompts/misc/plan-reminder-new.md) / [`plan-reminder-exists.md`](../src/bundled/prompts/misc/plan-reminder-exists.md)):
- Confirms plan mode is active and all edits are forbidden
- States the plan file path and whether it exists or is new
- Describes the 5-phase workflow: Explore → Design → Review → Final Plan → `plan_exit`

> **Note:** The 5-phase workflow is only injected **once** (on mode entry). Subsequent turns in plan mode re-use the `plan.md` system prompt (which contains a shorter constraint summary) but do not re-inject the full workflow. A full/sparse cycle (inject full once, inject a one-liner on subsequent turns) is a known improvement — see liteai_cli_mvp reference.

### Switching to Build Mode

Triggered when: `agent.name !== "plan"` and the last assistant message **was** from the plan agent.

1. Checks if a plan file exists at the session plan path
2. If it does, loads [`prompts/misc/build-switch.md`](../src/bundled/prompts/misc/build-switch.md) and appends a hardcoded path reference:

```ts
text: `${buildSwitch}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`
```

3. Persists this as a synthetic part on the current user message

The **full plan history is kept** — there is no compaction or replacement on switch. The model enters build mode with the entire planning conversation in context, plus this synthetic transition message.

> **Known gap:** The plan file content is not injected on switch — only the path. The model must explicitly read the file. Injecting the content directly (like liteai_cli_mvp's `plan_file_reference` attachment) would remove this implicit read-on-entry.

---

## Tools

### `plan_exit`

**Source:** [`src/tool/plan.ts`](../src/tool/plan.ts#L21)  
**Description:** [`src/tool/plan-exit.txt`](../src/tool/plan-exit.txt)  
**Permission:** `plan_exit: allow` in `plan.md`

The primary signal that planning is complete. When called:

1. Presents the user with a `Question.ask` prompt:
   > *"Plan at `<path>` is complete. Would you like to switch to the build agent and start implementing?"*
   - **Yes** → creates a new user message with `agent: "build"` and a synthetic text part:  
     `"The plan at <path> has been approved, you can now edit files. Execute the plan"`
   - **No** → throws `Question.RejectedError`, staying in plan mode

2. The new user message triggers `loop()` to re-enter with the build agent, which causes `insertPlanReminder` to fire the build-switch branch.

The model is instructed to call this tool **only** after:
- A complete plan has been written to the plan file
- All user questions have been resolved
- The model is confident the plan is ready

### `question`

**Permission:** `question: allow` in `plan.md`

Used throughout planning to ask the user clarifying questions or to present tradeoffs. The model is instructed to use this instead of stopping mid-turn with text questions.

### `plan_enter` (disabled)

**Source:** [`src/tool/plan.ts`](../src/tool/plan.ts#L76) — currently commented out

A symmetric tool that would allow the build agent to propose entering plan mode. The permission `plan_enter: allow` is present in `build.md` but the tool registration is commented out. This means plan mode can only be initiated from the UI (by selecting the plan agent), not by the model itself.

---

## System Prompt Assembly

For each loop iteration, the final system prompt seen by the model is assembled in layers:

| Layer | Source | Every Turn? |
|---|---|---|
| Agent identity & constraints | `plan.md` body → `agent.prompt` → prepended in `llm.ts` | ✅ Yes |
| Environment (model, cwd, platform, date) | `SystemPrompt.environment()` in `loop.ts` | ✅ Yes |
| Skills listing | `SystemPrompt.skills()` in `loop.ts` | ✅ Yes |
| CLAUDE.md / instruction files | `InstructionPrompt.system()` in `loop.ts` | ✅ Yes |
| Plan-mode entry reminder + workflow | `plan-reminder-{new,exists}.md` → synthetic user message | ❌ First turn only |
| Build-switch transition | `build-switch.md` → synthetic user message | ❌ On agent switch |

The trace records:
- `system`: the assembled `system[]` array (layers 1–4, resolved by `resolvedSystem` in `processor.ts`)
- `contextIDs`: all message IDs including those with synthetic parts (layers 5–6 are visible here, not in `system`)

---

## Data Flow Diagram

```
User selects "plan" agent
        │
        ▼
loop.ts: insertPlanReminder()
        │
        ├── First plan turn?
        │     └── load plan-reminder-{new,exists}.md
        │         replace {{PLAN_PATH}}
        │         Session.updatePart() → persisted as synthetic user part
        │
        └── Agent switched from plan → build?
              └── load build-switch.md + append path
                  Session.updatePart() → persisted as synthetic user part
        │
        ▼
loop.ts: build system[]
  [agent.prompt (plan.md)]  ← every turn via llm.ts
  [environment]
  [skills]
  [instructions]
        │
        ▼
LLM.stream() → model responds
        │
        ▼
Model calls plan_exit
        │
        ▼
Question.ask() → UI presents choice
        │
        ├── "No" → stay in plan agent
        └── "Yes" → create new user message with agent: "build"
                    synthetic part: "plan approved, execute the plan"
                    → loop() re-enters with build agent
                    → insertPlanReminder fires build-switch branch
```

---

## Known Issues / Improvement Areas

1. **No sparse reminder cycle**: The full workflow (5 phases, ~70 lines) is injected once on entry and then never again. `plan.md` covers constraints every turn but not the workflow. A short sparse reminder on subsequent turns would reinforce the workflow phases without token waste.

2. **Build-switch injects path, not content**: The model is told where the plan file is but must read it explicitly. Injecting the file content directly on switch would improve build-start reliability.

3. **`plan.md` and `plan-reminder-new.md` partially overlap**: Both state the read-only constraint. `plan.md` should own constraints (every turn, system); the reminder MDs should own dynamic context (plan path, first-turn workflow).

4. **`plan_enter` is commented out**: The build agent has the `plan_enter` permission but the tool is not registered. Plan mode can only be entered via UI agent selection.

5. **Full history on switch**: All plan-mode conversation (explore agent results, question/answer rounds, draft plans) remains in context when build begins. For long planning sessions this inflates the build context significantly.
