# Research: Plan Mode MVP Parity

**Feature**: Plan Mode MVP Parity (006)  
**Date**: 2026-04-17  

## R-001: Inject Pattern and Agent Swap Mechanism

**Decision**: The `inject` return field on tool results is the mechanism that causes agent persona swaps.

**Rationale**: When `PlanEnterTool.execute()` returns `inject: [{ info: { agent: "plan", ... }, parts: [] }]`, the session engine in `tools.ts:171-181` calls `Session.updateMessage(msg.info)` which persists this injected user message. Because the message has `agent: "plan"`, subsequent agent resolution loads `plan.md` (the primary agent persona), replacing the root agent's system prompt and permissions. The same mechanism fires on exit with `agent: "build"`. This is the root cause of amnesia — the model loses context when the system prompt changes.

**Fix**: Remove the `inject` return entirely from both `PlanEnterTool` and `PlanExitTool`. The `PlanModeStateRef.update()` call already emits `PlanStateChanged` via `Bus.publish`, which is the correct state transition mechanism. The root agent identity must never change.

**Alternatives considered**:
- Keep inject but remove the `agent` field — rejected because injection of fake user messages is still a code smell and unnecessary. State mutation + event emission is sufficient.

## R-002: User Approval for Plan Mode Entry

**Decision**: Use the existing `Question.ask()` pattern (same as `PlanExitTool`) for plan mode entry approval.

**Rationale**: `Question.ask()` is already proven, tested, and wired to the UI. It blocks tool execution until the user responds, achieving the same behavioral outcome as the MVP's `shouldDefer: true` pattern. Introducing a formal `shouldDefer` property on `Tool.Info` would require new infrastructure in the tool system for a single use case — over-engineering.

**Alternatives considered**:
- Formal `shouldDefer` mechanism on Tool.Info — rejected as over-engineering. Only one tool needs it. `Question.ask()` already achieves the same blocking-until-approved behavior.

## R-003: Workflow Instruction Injection

**Decision**: Return workflow text as the `output` field of the `PlanEnterTool` result.

**Rationale**: The MVP injects workflow instructions as tool result text. The model receives this as the tool's response and treats it as high-priority context. The text is loaded from `prompts/misc/plan-workflow.md` or `prompts/misc/plan-interview.md` at tool init time, based on the interview mode flag.

**Alternatives considered**:
- Inject as per-turn attachment — rejected. The MVP uses tool result output. Per-turn attachment would require the plan-reminder system to also handle workflow text, complicating the logic.

## R-004: Plan Reminder Inversion

**Decision**: Use the existing `planText` field as the signal for build-phase reminders.

**Rationale**: `planText` is set by `PlanExitTool` when the user approves the plan. The guard condition in `plan-reminder.ts` must change from `if (!planModeState.active) return` to `if (planModeState.active || !planModeState.planText) return`. This fires reminders during build phase (when plan mode is inactive but a plan has been approved), not during plan phase.

**Alternatives considered**:
- Add a new `hasPlan: boolean` field — rejected. `planText` already serves as the semantic signal. No new fields needed.

## R-005: shouldDefer Pattern Non-Existence

**Decision**: `shouldDefer` does not exist in LiteAI's tool system. No infrastructure change is needed.

**Rationale**: Searched `packages/core/src` for `shouldDefer` — zero results. The MVP's `shouldDefer: true` is an implementation detail of their tool framework. In LiteAI, the equivalent is accomplished by calling `Question.ask()` inside the tool's `execute()` function before performing the state mutation. Same user-facing behavior, different implementation mechanism.

## R-006: BUILTIN_AGENT_NAMES Cleanup

**Decision**: Remove `"plan-explore"` from the `BUILTIN_AGENT_NAMES` array in `agent.ts`.

**Rationale**: After deleting `plan-explore.md`, the `loadBuiltinAgents()` function will call `Bundled.agent("plan-explore")` which will throw a file-not-found error. The array must be updated atomically with the file deletion.

## R-007: Explore Agent Verification

**Decision**: Verify and align `explore.md` with the MVP's `EXPLORE_AGENT` definition.

**Rationale**: The current `explore.md` is functionally close to the MVP's `EXPLORE_AGENT`:
- Both are read-only subagents.
- Both disallow file editing/writing.
- The description matches the MVP's `whenToUse` pattern.

Key differences to verify:
1. The current `explore.md` uses `disallowedTools` implicitly (via permission deny rules) — the MVP uses an explicit `disallowedTools` array. Both achieve the same outcome because the tool registry filters by both mechanisms.
2. The current `explore.md` allows `bash` — the MVP also allows bash for read-only operations.
3. The name `explore` (lowercase) matches the MVP's internal name — the public-facing `agentType: 'Explore'` is just a display name.

**No changes needed** unless system prompt content diverges from MVP's `getExploreSystemPrompt()`. This must be verified during implementation by reading the MVP source.

## R-008: Interview Mode Flag

**Decision**: Add a per-session configuration option for interview mode.

**Rationale**: The MVP uses `isPlanModeInterviewPhaseEnabled()` which checks an internal feature flag. In LiteAI, this can be implemented as:
1. A parameter on `PlanEnterTool` — the agent decides whether to use interview mode based on the task context.
2. An environment variable or config field — admin-level setting.

The simplest approach: add an optional `interviewMode` boolean parameter to `PlanEnterTool`. Default is false (5-phase). The agent can be instructed via its tool description on when to choose interview mode vs. 5-phase.
