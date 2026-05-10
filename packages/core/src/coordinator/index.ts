export {
  applyCoordinatorToolFilter,
  getCoordinatorUserContext,
  isCoordinatorMode,
  matchSessionMode,
} from "./coordinator-mode"

export { getCoordinatorSystemPrompt } from "./coordinator-prompt"

export * from "./swarm-messages"
// ── Phase 3: In-Process Teammate Runner ──
export {
  createTeammateContext,
  getTeammateContext,
  isInProcessTeammate,
  runWithTeammateContext,
} from "./teammate-context"
export { TeammateEvent } from "./teammate-events"
export * from "./teammate-mailbox"
export { TEAMMATE_SYSTEM_PROMPT_ADDENDUM } from "./teammate-prompt-addendum"
export type { TeammateRunnerConfig, TeammateRunnerResult } from "./teammate-runner"
export { runInProcessTeammate, startInProcessTeammate } from "./teammate-runner"
export type { InProcessSpawnConfig, InProcessSpawnOutput } from "./teammate-spawn"
export { killInProcessTeammate, spawnInProcessTeammate } from "./teammate-spawn"
export type { TeammateIdentity, TeammateTaskState, TeammateUIMessage } from "./teammate-types"
export {
  appendCappedMessage,
  formatAgentId,
  isTeammateTask,
  parseAgentId,
  TEAMMATE_MESSAGES_UI_CAP,
  TEAMMATE_POLL_INTERVAL_MS,
} from "./teammate-types"
