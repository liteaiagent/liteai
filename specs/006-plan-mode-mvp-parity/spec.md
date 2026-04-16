# Feature Specification: Plan Mode MVP Parity

**Feature Branch**: `006-plan-mode-mvp-parity`  
**Created**: 2026-04-17  
**Status**: Draft  
**Input**: RFC — Eliminate agent-swap architecture, align Plan Mode with permission-driven MVP reference implementation  
**Supersedes**: Behavioral aspects of `specs/004-plan-mode` that deviated from MVP reference  

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Agent Proactively Enters Plan Mode for Complex Tasks (Priority: P1)

A user sends a complex request to the AI assistant (e.g., "Add a billing feature with Stripe integration"). The agent recognizes the task involves multiple files, architectural decisions, and unclear requirements. Instead of immediately editing code, the agent autonomously decides to enter plan mode by requesting user approval. The user sees an approval prompt and can accept or decline. Upon approval, the agent enters a structured planning workflow, delegating exploration and design work to specialized subagents before producing a comprehensive plan for the user to review.

**Why this priority**: This is the core behavioral change. Without proactive, approval-gated plan mode entry and the structured workflow, all downstream features (interview mode, reminders, subagent delegation) are meaningless. This story eliminates the root-agent persona-swap amnesia that is the primary defect.

**Independent Test**: Can be fully tested by sending a complex multi-file task and verifying: (1) the agent requests permission before entering plan mode, (2) the user sees an approval prompt, (3) upon approval the agent's conversation context is preserved (no amnesia), and (4) the agent follows the 5-phase planning workflow.

**Acceptance Scenarios**:

1. **Given** the agent is in normal (build) mode, **When** the user sends a complex task involving multiple files or architectural decisions, **Then** the agent calls the plan mode entry tool with a deferred approval request.
2. **Given** the agent has requested plan mode entry, **When** the user approves, **Then** the agent receives structured 5-phase workflow instructions as part of the tool result and the system marks the session as "plan mode active."
3. **Given** the agent has requested plan mode entry, **When** the user declines, **Then** the agent continues in normal build mode without entering plan mode, and no planning workflow is activated.
4. **Given** the agent enters plan mode, **When** the conversation continues, **Then** the root agent identity does not change — the same agent continues with the same conversation history and context (zero amnesia).

---

### User Story 2 — Structured 5-Phase Planning Workflow (Priority: P1)

Once in plan mode, the agent follows a structured 5-phase workflow:

- **Phase 1 (Initial Understanding)**: The agent spawns one or more Explore subagents in parallel to search the codebase, read relevant files, and produce research reports.
- **Phase 2 (Design)**: The agent spawns one or more Plan subagents in parallel to design implementation strategies based on the exploration findings.
- **Phase 3 (Review)**: The root agent reviews the subagent outputs, reads critical files itself, and synthesizes the information.
- **Phase 4 (Write Plan)**: The root agent writes a final implementation plan to a plan file.
- **Phase 5 (Exit & Approval)**: The root agent calls the exit plan mode tool. The user is presented with the plan and an approval mechanism. Upon approval, the agent transitions to build mode with the plan in-context.

**Why this priority**: The 5-phase workflow is the defining behavior of plan mode. Without it, entering plan mode has no behavioral effect beyond restricting tools. This story ensures the agent actually produces a structured, high-quality plan.

**Independent Test**: Can be tested by entering plan mode and verifying the agent progresses through each phase — spawning Explore subagents, spawning Plan subagents, reviewing outputs, writing a plan file, and presenting it for approval.

**Acceptance Scenarios**:

1. **Given** the agent has entered plan mode with the 5-phase workflow, **When** the agent begins Phase 1, **Then** it spawns at least one Explore subagent to search the codebase and returns research findings.
2. **Given** Phase 1 is complete, **When** the agent begins Phase 2, **Then** it spawns at least one Plan subagent to design an implementation strategy.
3. **Given** Phases 1 and 2 are complete, **When** the agent begins Phase 4, **Then** it writes a plan file containing a structured implementation plan.
4. **Given** the plan file is written, **When** the agent calls the exit plan mode tool, **Then** the user sees the plan and an approval mechanism (accept, reject, or request changes).
5. **Given** the user approves the plan, **When** the agent transitions to build mode, **Then** the plan text is injected into the agent's context and the agent continues with full tool access.

---

### User Story 3 — Interview Mode Variant (Priority: P2)

As an alternative to the 5-phase subagent-heavy workflow, the system supports an "interview mode" variant. When interview mode is enabled (via configuration), the agent enters plan mode but does NOT spawn Explore or Plan subagents. Instead, the agent directly explores the codebase using read-only tools and iterates with the user by asking clarifying questions. The agent incrementally builds the plan file through dialogue, then exits via the same approval mechanism.

**Why this priority**: Interview mode is an alternative workflow that provides a simpler, more interactive planning experience. It's valuable for users who prefer direct collaboration but is not the primary workflow. It can be implemented and tested independently of the 5-phase variant.

**Independent Test**: Can be tested by enabling interview mode, entering plan mode, and verifying the agent uses read-only tools directly (no subagent spawning), asks the user questions, and incrementally writes a plan file.

**Acceptance Scenarios**:

1. **Given** interview mode is enabled in configuration, **When** the agent enters plan mode, **Then** the agent receives interview phase instructions instead of 5-phase workflow instructions.
2. **Given** the agent is in interview mode, **When** it explores the codebase, **Then** it uses read-only tools directly (file reading, search, code search) rather than spawning subagents.
3. **Given** the agent is in interview mode, **When** it needs information from the user, **Then** it asks clarifying questions and incorporates the answers into the plan.
4. **Given** the agent has completed the interview, **When** it finishes the plan, **Then** it calls the exit plan mode tool with the same approval mechanism as the 5-phase variant.

---

### User Story 4 — Plan Reminders During Build Phase (Priority: P2)

After plan mode is exited and the user has approved the plan, the agent enters build mode with the plan in-context. To prevent the agent from drifting away from the approved plan during implementation, the system injects periodic plan reminders into the conversation:

- **Every turn**: A sparse reminder referencing the plan file location and asking the agent to stay on track.
- **Every N turns** (configurable, default 5): A full plan text refresh injected as an attachment to refresh the model's memory of the complete plan.

**Why this priority**: Reminders are a critical quality-of-life feature that prevents plan drift during long build sessions. However, they only matter after the core plan mode workflow (Stories 1–3) is functional.

**Independent Test**: Can be tested by completing a plan mode cycle, approving a plan, then sending multiple build-phase messages and verifying that sparse reminders appear every turn and full plan text refreshes appear at the configured interval.

**Acceptance Scenarios**:

1. **Given** the agent has exited plan mode and the user approved the plan, **When** the agent processes the next user message in build mode, **Then** a sparse plan reminder is injected referencing the plan file location.
2. **Given** the agent is in build mode with an approved plan, **When** every 5th turn (default) is reached, **Then** the full plan text is injected as an attachment to refresh the model's memory.
3. **Given** no plan has been created or approved, **When** the agent processes messages in build mode, **Then** no plan reminders are injected.

---

### User Story 5 — Subagent Naming and Permission Parity (Priority: P1)

The system's built-in subagent definitions must match the reference implementation's agent type names and permission models:

- The **Explore** subagent is a read-only codebase search specialist. It cannot edit files, write files, spawn other agents, or exit plan mode.
- The **Plan** subagent is a read-only software architect. It has the same read-only permissions as Explore. It designs implementation strategies but cannot make changes.
- Both subagent types share the same fundamental read-only tool restriction pattern.

**Why this priority**: Agent name parity and correct permissions are foundational. The 5-phase workflow (Story 2) depends on correctly named and permission-scoped subagents. Misnamed agents or incorrect permissions would break the delegation model.

**Independent Test**: Can be tested by inspecting the agent definitions and verifying that (1) the Explore subagent is named "Explore" with read-only permissions, (2) the Plan subagent is named "Plan" with read-only permissions, and (3) neither can edit/write files or spawn subagents.

**Acceptance Scenarios**:

1. **Given** the system's agent registry, **When** the Explore subagent definition is inspected, **Then** it is named "Explore" and has read-only permissions (file edit, file write, agent spawning, and plan exit tools are disallowed).
2. **Given** the system's agent registry, **When** the Plan subagent definition is inspected, **Then** it is named "Plan" and has the same read-only permissions as Explore.
3. **Given** either subagent is spawned during plan mode, **When** it attempts to use a disallowed tool (e.g., file edit), **Then** the tool is not available to the subagent.

---

### Edge Cases

- **What happens when the agent enters plan mode but the user never approves?** The plan mode entry remains pending. The agent must not proceed with planning behavior until approval is granted. If the user sends a new message without approving, the system should remind the user that plan mode entry is pending.
- **What happens when the agent calls plan exit but the plan file is empty or missing?** The system should still present the approval mechanism but warn the user that no plan file was found or that the plan is empty.
- **What happens when a subagent fails or times out during Phase 1 or 2?** The root agent should proceed with whatever information was gathered. Subagent failures should not block the planning workflow.
- **What happens when the user rejects the plan at exit?** The agent should remain in plan mode and revise the plan based on user feedback, then re-submit for approval.
- **What happens when the agent tries to enter plan mode while already in plan mode?** The entry tool should return an error or no-op indicating that plan mode is already active.
- **What happens when interview mode and 5-phase mode are somehow both requested?** The configuration flag determines the variant. 5-phase is the default; interview mode is opt-in. They are mutually exclusive for a given plan mode session.
- **What happens when the system restarts mid-plan-mode?** The plan mode state should be recoverable from the persisted session state, allowing the agent to resume in whatever phase it was in.
- **What happens if legacy agent persona files are not fully purged?** The system may silently load a stale persona and reintroduce the amnesia bug. A post-implementation verification MUST confirm that no code path references the deleted personas, no `inject: [{ agent: "plan" }]` or `inject: [{ agent: "build" }]` patterns exist, and no stale prompt files remain on disk.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST maintain a single continuous root agent throughout plan mode transitions — no agent identity swap, no system prompt change, no conversational context loss.
- **FR-002**: System MUST require explicit user approval before the agent enters plan mode (deferred approval pattern).
- **FR-003**: System MUST inject structured workflow instructions (5-phase or interview variant) into the tool result when plan mode is activated, providing the agent with behavioral constraints.
- **FR-004**: System MUST support a 5-phase planning workflow: (1) Initial Understanding via Explore subagents, (2) Design via Plan subagents, (3) Root agent review, (4) Plan file writing, (5) Exit with user approval.
- **FR-005**: System MUST support an interview mode variant where the agent uses read-only tools directly and iterates with the user instead of spawning subagents.
- **FR-006**: System MUST allow interview mode to be selected via a configuration option (environment variable or configuration field), with the 5-phase variant as the default.
- **FR-007**: System MUST register an Explore subagent type (named "Explore") with read-only permissions: file editing, file writing, agent spawning, and plan exit tools MUST be disallowed. The Explore subagent's system prompt MUST be ported from the MVP reference implementation's `getExploreSystemPrompt()`.
- **FR-008**: System MUST register a Plan subagent type (named "Plan") with read-only permissions matching the Explore subagent's restrictions. The Plan subagent's system prompt MUST be ported from the MVP reference implementation's `getPlanV2SystemPrompt()`.
- **FR-009**: System MUST provide the plan mode entry tool description with proactive guidance on when to use and when NOT to use plan mode, ported from the MVP reference implementation's tool prompt ("When to Use This Tool" — 7 conditions, "When NOT to Use" — 4 exclusions, examples), enabling the agent to autonomously decide to enter plan mode for appropriate tasks.
- **FR-010**: System MUST provide the plan mode exit tool description ported from the MVP reference implementation, including plan file content requirements and the prohibition on using plain text or questions for plan approval.
- **FR-011**: System MUST inject periodic plan reminders during the build phase after plan exit: sparse reminders every turn, full plan text refresh every N turns (configurable, default 5).
- **FR-012**: System MUST present the user with an approval mechanism when the agent exits plan mode, showing the plan and allowing the user to accept, reject, or request changes.
- **FR-013**: System MUST inject the approved plan text into the agent's context upon transitioning from plan mode to build mode, ensuring the agent has the plan in-context during implementation.
- **FR-014**: System MUST prevent the agent from entering plan mode while already in plan mode (no-op or error).
- **FR-015**: System MUST remove all legacy root-agent persona-swap artifacts. This is a file-by-file purge with no exceptions:
  - **FR-015a**: DELETE the current `plan.md` root-agent persona file. A NEW `plan.md` will be created as a subagent definition (not a root agent) with content ported from the MVP.
  - **FR-015b**: DELETE `plan-explore.md` entirely — it is dead code that duplicates the existing `explore.md` subagent and was never spawned by any code path.
  - **FR-015c**: REMOVE all `inject: [{ info: { agent: "plan", ... }, parts: [] }]` message patterns from the plan mode entry tool — these trigger the persona swap that causes amnesia.
  - **FR-015d**: REMOVE all `inject: [{ info: { agent: "build", ... }, parts: [] }]` message patterns from the plan mode exit tool — same persona swap mechanism.
  - **FR-015e**: REWRITE the plan mode exit tool description (`plan-exit.txt`) — the current 1-line description is insufficient. Port the expanded description from the MVP.
  - **FR-015f**: UPDATE the root agent's system prompt (`system.md` Section 5) — the current "you are strictly in Planning Mode" directives conflict with the autonomous execution model and must be replaced.
  - **FR-015g**: VERIFY that the existing `explore.md` subagent matches the MVP's `EXPLORE_AGENT` definition. If discrepancies exist, align `explore.md` with the MVP — do NOT create a second explore agent file.
- **FR-016**: System MUST port all plan mode workflow instructions (5-phase variant) from the MVP reference implementation's message templates, preserving the phase descriptions, constraints, and subagent delegation guidance verbatim.
- **FR-017**: System MUST port all interview mode instructions from the MVP reference implementation's message templates, preserving the read-only tool list and iterative dialogue guidance verbatim.
- **FR-018**: System MUST update the root agent's system prompt to remove stale planning directives that conflict with the autonomous execution model, replacing them with a reference to the plan mode entry tool as the mechanism for structured planning.
- **FR-019**: System MUST port the 5-phase workflow instructions and interview mode instructions as standalone prompt assets (not inlined in code) so they can be injected as tool result content or attachments.
- **FR-020**: All ported prompts, system instructions, and tool descriptions MUST be sourced from the MVP reference implementation files listed in the RFC Section 3.1 — custom authoring of prompt content that deviates from the MVP source is not permitted unless the MVP text references features or concepts that do not exist in this system.

### Key Entities

- **Plan Mode State**: A per-session state object tracking whether plan mode is active or inactive, including the path to the plan file and the current workflow phase.
- **Permission Context**: A session-scoped context that controls which tools are available to the agent. The `mode` field determines whether the agent is in plan or build mode.
- **Plan File**: A markdown document written by the agent during Phase 4, containing the structured implementation plan. Stored at a session-specific path.
- **Workflow Instructions**: Static text documents (5-phase and interview variants) injected as tool result content when plan mode is activated.
- **Explore Subagent**: A read-only codebase search specialist spawned during Phase 1 of the 5-phase workflow.
- **Plan Subagent**: A read-only software architect spawned during Phase 2 of the 5-phase workflow.
- **Plan Reminder**: Periodic injections into the conversation during build mode — sparse (every turn) and full (every N turns) variants.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The agent's conversation context is fully preserved across plan-to-build transitions — zero messages lost, zero amnesia incidents in end-to-end testing.
- **SC-002**: 100% of plan mode entries require and receive user approval before the agent proceeds with planning behavior.
- **SC-003**: The agent follows all 5 phases of the planning workflow in sequence during end-to-end testing — Phase 1 (exploration), Phase 2 (design), Phase 3 (review), Phase 4 (plan writing), Phase 5 (exit & approval).
- **SC-004**: Explore and Plan subagents are unable to use any disallowed tools (file edit, file write, agent spawn, plan exit) during end-to-end testing — 100% enforcement.
- **SC-005**: Plan reminders are injected at the correct intervals during build mode — sparse reminders on every turn, full plan refresh every N turns (default 5) — with zero missed or extra injections.
- **SC-006**: Users can complete a full plan-approve-build cycle within a single continuous conversation without any agent identity changes or context resets.
- **SC-007**: Interview mode produces a completed, user-approved plan through iterative dialogue without spawning any subagents.
- **SC-008**: All legacy persona-swap artifacts (agent injection messages, stale agent persona files) are removed — zero references to the old dual-agent swap pattern remain in the active codebase.
- **SC-009**: A post-implementation codebase search for the following patterns returns zero results: (1) `agent: "plan"` in inject messages, (2) `agent: "build"` in inject messages, (3) references to `plan-explore.md`, (4) any code path that swaps the root agent identity during plan/build transitions. This verification MUST be performed as a final implementation step.

## Assumptions

- The existing `PlanModeStateRef` per-session in-memory state management infrastructure is correct and reusable for this feature.
- The existing `explore.md` subagent definition is functionally equivalent to the MVP's `EXPLORE_AGENT` and can be reused with name verification.
- The existing `disallowedTools` filtering in the tool registry is correct and sufficient for enforcing subagent permission restrictions.
- The plan reminder system (`plan-reminder.ts`) logic is architecturally correct but needs context adjustments (fire during build phase with plan-in-context, not during plan phase).
- The MVP reference implementation (`liteai_cli_mvp/src`) is the authoritative source for all behavioral decisions where the RFC and existing specs conflict.
- This is a clean-break release (v-next per Core Mandate §0) — no backward compatibility with the legacy persona-swap behavior is required.
- The UI components for plan approval (approval dock, badges) already exist from `specs/005-plan-mode-ui-minimal` and do not need to be rebuilt.
- The `Question.ask()` pattern (deferred tool approval) is already implemented and used by `PlanExitTool`. The same pattern can be leveraged by the plan mode entry tool for user approval gating. The MVP's `shouldDefer` property is not present in LiteAI; `Question.ask()` achieves the same behavioral outcome (see plan ADR-001).

## Dependencies

- **specs/005-plan-mode-ui-minimal**: UI components (Plan Approval Dock, session title bar badges) must be in place for the approval flow to be visible to the user.
- **specs/002-subagent-architecture**: The Agent tool and subagent spawning infrastructure must support named subagent types with `disallowedTools`.
- **specs/003-fork-subagent-durability**: Subagent state durability must be functional for the 5-phase workflow to reliably collect subagent outputs.
- **Reference Implementation**: `liteai_cli_mvp/src` — all behavioral decisions are grounded on the MVP source files listed in the RFC Section 3.1.

## Constraints

- **C-001 (MVP Behavioral Parity)**: All plan mode behavior MUST match the `liteai_cli_mvp` reference implementation. No behavioral degradation from MVP.
- **C-002 (Agent Name Parity)**: Subagent types MUST use exact MVP names: "Explore" and "Plan."
- **C-003 (Zero Amnesia)**: The root agent MUST maintain continuous conversation context. No agent swaps, no system prompt changes during plan/build transitions.
- **C-004 (Instruction Parity)**: ALL prompt assets — including the 5-phase workflow text, interview mode instructions, Explore subagent system prompt, Plan subagent system prompt, plan mode entry tool description, plan mode exit tool description, and root agent system prompt updates — MUST be ported from the corresponding MVP source files. No custom authoring of prompt content that deviates from the MVP source is permitted.
- **C-005 (Clean Break)**: This is a v-next release. All legacy dual-agent persona-swap artifacts MUST be removed, not wrapped or shimmed.
- **C-006 (Mandatory Pre-Implementation MVP Source Audit)**: Before writing ANY implementation code, the implementer MUST read and cross-reference every MVP source file listed in the RFC Section 3.1. This is non-negotiable. The Phase 3 failure was directly caused by implementing plan mode from assumptions and roadmap phrasing instead of tracing the actual MVP code paths. Each MVP source file MUST be read, its behavioral contract understood, and its equivalent in this system identified or created.
- **C-007 (Legacy Purge Verification)**: After implementation is complete, a full-codebase search MUST be performed to verify that no residual legacy artifacts remain. The search patterns are defined in SC-009. Any residual legacy reference is a blocking defect that must be resolved before the feature is marked complete.

## Lessons Learned — Why These Constraints Exist

> **Root Cause of Phase 3 Failure**: The original Plan Mode implementation (specs/004-plan-mode) deviated from the MVP because:
>
> 1. **No MVP source audit was performed.** The implementer worked from the roadmap description ("dedicated Plan/Explore sub-agents") and inferred behavior instead of reading the actual MVP source code. This led to misinterpreting "Plan subagent" as "swap root agent to plan.md persona."
>
> 2. **Legacy artifacts were not cleaned up.** Instead of verifying and reusing the existing `explore.md`, a new `plan-explore.md` was created alongside it — introducing dead code and conceptual confusion.
>
> 3. **Prompts were custom-authored instead of ported.** The `plan.md` and `build.md` system prompts were written from scratch instead of porting the MVP's proven `getExploreSystemPrompt()`, `getPlanV2SystemPrompt()`, and workflow text from `messages.ts`. This caused the agent to behave differently from the MVP.
>
> 4. **The persona-swap pattern was chosen over the permission-driven pattern.** The MVP mutates `toolPermissionContext.mode = 'plan'` — the root agent stays the same. Phase 3 injected `agent: "plan"` messages to swap the root agent to a different persona, causing conversational context fragmentation (amnesia).
>
> **These constraints (C-006, C-007, FR-015a–g, SC-009) exist specifically to prevent this failure mode from recurring.**
