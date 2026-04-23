# MVP Plan Mode Architecture & User Flow

> [!WARNING]
> **MVP Reference Only:** This architecture document reflects the legacy **LiteAI CLI MVP** (`liteai_cli_mvp`), **not** the current `liteai` mono-repo core (`packages/core`). 

This document details how the "Plan Mode" feature operates in the MVP architecture (`src/`), written from the perspective of how a user interacts with the system from start to finish.

> [!NOTE]
> This is the architectural overview. For a mapping of these concepts to the actual codebase files, refer to [MVP Plan Mode: Code Reference Map](mvp_plan_mode_code_map.md).

## 1. The Entry Points (How Plan Mode Starts)

There are two distinct ways a user can enter Plan Mode. The MVP allows both proactive user intent and proactive AI suggestion.

### Path A: User-Initiated (The `Shift+Tab` Cycle)
Before typing a complex request, the user can press `Shift+Tab`. This cycles the UI through the available permission modes:
* **Default Mode:** AI asks for permission before running commands or editing files.
* **Auto-Accept Edits (Allow) Mode:** AI automatically edits files, but asks for dangerous terminal commands.
* **Plan Mode:** AI is restricted to a strictly read-only state.

If the user selects **Plan Mode** and hits enter on their prompt, the session immediately begins in a read-only state.

### Path B: AI-Initiated (`EnterPlanMode` Tool)
The user stays in **Default** or **Auto** mode and types a massive, complex request (e.g., *"Refactor the entire authentication system"*). 

The AI receives the prompt and realizes this is too complex to just start hacking away. Because the `EnterPlanMode` tool is available to the AI in *all* standard modes, the AI proactively calls it.

**The User Experience:** 
The AI stops and pops up a dialog on the user's screen:
> *"Approve entering plan mode? The agent will explore the codebase and design an implementation plan before writing any code."*
> * [Yes] Enter plan mode
> * [No] Continue in build mode

If the user clicks **Yes**, the MVP immediately saves the user's previous mode (e.g., "Auto") into memory, and switches the active mode to "Plan".

---

## 2. The Planning Phase (What happens in Plan Mode)

Once Plan Mode is activated, the AI is completely blocked from modifying the file system or executing state-changing terminal commands. 

The AI receives one of two strict workflows based on feature flags (specifically `isPlanModeInterviewPhaseEnabled`):

### The 5-Phase Workflow (Default)
The AI is instructed to follow a rigorous background process:
1. **Explore:** It uses tools like `glob`, `read`, and `grep` to map out the codebase. 
2. **Identify:** It finds similar architectural patterns in the repository.
3. **Analyze:** It weighs different approaches.
4. **Clarify:** If it gets stuck, it uses the `AskUserQuestion` tool to prompt the user for clarification.
5. **Design:** It drafts a concrete markdown plan.

*Advanced MVP Feature (Swarms):* If the codebase is massive, the MVP allows the AI to spawn multiple "Explore Subagents" (`getPlanModeV2ExploreAgentCount`) to read directories in parallel and report back.

### The Interview Mode (Alternative)
If enabled, instead of silently exploring in the background, the AI is told: *"DO NOT write or edit any files except the plan file."* It then acts as a pair-programmer, interviewing the user step-by-step using the `AskUserQuestion` tool to co-create the architecture.

---

## 3. The Exit Point (How Plan Mode Ends)

Once the AI is confident in the plan, it writes the final markdown document to the disk (e.g., `.claude/plan.md`) and calls the `ExitPlanModeV2` tool. 

**The User Experience:**
The user sees a new prompt appear:
> *"Plan at [path] is complete. Exit plan mode and start implementing?"*
> * [Yes] Approve plan and start implementing
> * [No] Continue refining the plan

*Note: Before clicking Yes, the user can actually open `.claude/plan.md` in their IDE and manually edit the AI's plan.*

### Path A: User Rejects
If the user clicks **No**, the tool throws a simulated error back to the AI: *"User rejected the plan. Continue refining..."* The session stays securely in Plan Mode, and the AI must iterate on the document based on user feedback.

### Path B: User Approves
If the user clicks **Yes**, the MVP handles the transition automatically:
1. **State Restoration:** The MVP looks at the mode the user was in *before* Plan Mode (e.g., Auto Mode) and restores it, re-granting the AI its ability to write files and execute commands.
2. **Context Injection:** The tool returns a success message to the AI: *"User has approved your plan. You can now start coding."*
3. **Swarm Handoff:** If the plan is massive, the tool dynamically hints to the AI: *"If this plan can be broken down into multiple independent tasks, consider using the TeamCreate tool to create a team and parallelize the work."*

---

## 4. Subagent/Teammate Planning (The Mailbox exception)

There is one exception to the flow above. If the entity creating the plan is not the main AI, but rather a background subagent (a "Teammate" tasked with planning a sub-module):
* The subagent does **not** interrupt the user's CLI with a Yes/No dialog.
* Instead, `ExitPlanModeV2` sends a silent `plan_approval_request` to the "Team Lead mailbox".
* The subagent goes to sleep.
* The main agent (Team Lead) eventually reads its mailbox, reviews the subagent's plan, and replies with an approval or rejection.
