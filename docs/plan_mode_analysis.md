# LiteAI: Plan Mode Implementation Analysis (`packages/core`)

This document provides a detailed analysis of the "Plan Mode" feature implementation in the `packages/core` directory, comparing it directly against the legacy MVP documentation provided (`mvp_plan_mode_architecture.md`, `plan_mode_workflows_guide.md`, `mvp_plan_mode_code_map.md`). 

The goal is to clarify what has been successfully ported to the new mono-repo architecture and what is missing or stubbed.

---

## 1. The Entry Points (How Plan Mode Starts)

### Path A: User-Initiated (`Shift+Tab` Cycle)
- **Status: Backend Implemented, UI Missing**
- **Details:** The specific keystroke logic (`Shift+Tab`) and UI components naturally do not exist in `core`. However, the fundamental permission backend required to support this—specifically the `permissionMode` property (`"plan"`, `"acceptEdits"`, `"bypassPermissions"`, `"dontAsk"`, `"default"`)—is **fully implemented** and robustly tested. 
- **Files Traced:** `src/permission/sandbox.ts`, `src/platform/profiles/claude.ts`, `test/platform/claude-platform.test.ts`.

### Path B: AI-Initiated (`EnterPlanMode` Tool)
- **Status: Fully Implemented**
- **Details:** The AI's ability to proactively pause and enter plan mode exists as the `PlanEnterTool` (`"plan_enter"`). It correctly enforces a `isRootAgent()` check to ensure sub-agents cannot inappropriately trigger it. It also properly leverages `Bus.publish` and `Question.ask` to request user approval before mutating the `PlanModeStateRef` state.
- **Files Traced:** `src/tool/plan.ts`.

---

## 2. The Planning Phase

### Read-Only Restriction
- **Status: Fully Implemented**
- **Details:** When the session's permission mode transitions to `"plan"`, the agent is successfully restricted to read-only tools. Tests explicitly verify that write/edit tools are denied while in this mode.
- **Files Traced:** `test/platform/claude-platform.test.ts` (e.g., `permissionMode plan allows read-only tools and denies others`).

### The 5-Phase Workflow
- **Status: Implemented**
- **Details:** The background process instructions are injected successfully. The `"plan_enter"` tool reads the bundled `plan-workflow` prompt and injects dynamic information about the target plan file location.

### The Interview Mode
- **Status: Implemented (Modernized)**
- **Details:** The MVP feature flag `isPlanModeInterviewPhaseEnabled` has been dropped in favor of a cleaner architecture. The `plan_enter` tool now takes an explicit `interviewMode: boolean` parameter. When `true`, it loads the `plan-interview` prompt instead of the 5-phase prompt. To support this pair-programming style, the `AskUserTool` (`"ask_user"`) is fully ported and functional.
- **Files Traced:** `src/tool/plan.ts`, `src/tool/ask_user.ts`.

### Background Agents & Swarms (Parallel Explore)
- **Status: ❌ NOT Implemented**
- **Details:** While there are mentions of "Swarm mode" in the `docs/agent-execution-modes.md` file, and type definitions scaffolding for teammates (`TeammateAgentContext`, `TeammateIdle` in `src/agent/context.ts` and `src/hook/hook.ts`), the actual execution logic is missing. The `exploreAgent` sub-agent definition and the `TeamCreate` / `TeamDelete` tools do not exist in the `core` package.
- **Files Traced:** Scanned `src/tool/*` and `src/agent/*`.

---

## 3. The Exit Point (How Plan Mode Ends)

### `ExitPlanModeV2` Tool
- **Status: Fully Implemented**
- **Details:** Ported as `PlanExitTool` (`"plan_exit"`). It successfully handles the disk write of the markdown plan (creating directories if necessary), and prompts the user for approval via `Question.ask`.
- **Files Traced:** `src/tool/plan.ts`.

### Approval / Rejection Paths
- **Status: Fully Implemented**
- **Details:** 
  - **Rejection:** If the user selects "No", the tool throws a `Question.RejectedError`. This effectively acts as a fail-fast mechanism, preventing state mutation and forcing the AI to refine its plan.
  - **Approval:** If "Yes", it updates the `PlanModeStateRef` to `active: false`, unblocking the session, and successfully restores the normal build workflow.
  - *Note:* The MVP's "Swarm Handoff" hint upon approval is not implemented, consistent with the missing Swarm tools.

---

## 4. Subagent/Teammate Planning (The Mailbox exception)

### Mailbox Protocol (`plan_approval_request`)
- **Status: ❌ NOT Implemented**
- **Details:** The MVP describes background agents sending silent `plan_approval_request` messages to a "Team Lead mailbox". There is zero implementation of this in `core`. Tools like `readMailbox` or `writeToMailbox` (mentioned in markdown docs) are completely absent from the source code.

---

## 5. Session Management (`/resume`, `/rename`)

### Parallel Sessions & Resumption
- **Status: Backend Implemented**
- **Details:** The core backend systems to support `liteai --resume [name]` exist. `Session.Info` models the session state, and restoration logic is intact. The CLI slash commands (`/resume`, `/tasks`, `/rename`) are not here, which is architecturally correct since `core` provides the headless foundation for the CLI package.
- **Files Traced:** `src/agent/resume.ts`, `src/server/routes/session.ts`.

---

## Summary Conclusion
The primary, single-agent **Plan Mode** loop (Enter -> Read-Only Restriction -> 5-Phase/Interview -> Exit -> Approval) is comprehensively implemented, type-safe, and modernized in `packages/core`. 

However, all **multi-agent/swarm features** connected to Plan Mode—specifically parallel explore sub-agents, the `TeamCreate` tool, and the file-based mailbox messaging system for silent approvals—are currently missing or exist only as type stubs and documentation.
