# Data Model: Phase UI-A (Minimal Plan Mode UI)

## SSE Events

The UI component must listen and react to the following Server-Sent Events from the backend:

- **`plan.state_changed`**
  - **Origin**: Emitted by `PlanModeState` engine.
  - **Behavior**: Indicates natural transition into or out of plan mode (e.g., via `PlanEnterTool`).
  - **UI Impact**: Controls the visibility of the Plan Mode Badge in the `session-title-bar.tsx`.

- **`plan.approval_requested`**
  - **Origin**: Emitted specifically by the `ExitPlanModeTool`.
  - **Behavior**: Requires user intervention before the backend engine can proceed to the execution phase.
  - **UI Impact**: Triggers the rendering of `plan-approval-dock.tsx` and locks standard text interactions in `chat-prompt-input.tsx`.

## View State

Local component states within the `packages/ui` boundaries:

- `isPlanModeActive: boolean` (derived from `plan.state_changed` true/false payload).
- `isApprovalPending: boolean` (derived from `plan.approval_requested` block state).
