export type { BuiltInAgentProfile } from "./built-in-agents"
export { findBuiltInAgent, getBuiltInAgents, isBuiltInAgentType, VERIFICATION_AGENT } from "./built-in-agents"
export {
  applyCoordinatorToolFilter,
  getCoordinatorUserContext,
  isCoordinatorMode,
  matchSessionMode,
} from "./coordinator-mode"
export { getCoordinatorSystemPrompt } from "./coordinator-prompt"
export type { PermissionBridgeHandler } from "./permission-bridge"
export { PermissionBridge, TeammatePermissionEvent } from "./permission-bridge"
export type { PermissionDecisionCallback } from "./permission-bridge-handler"
export { resolveFileBasedPermission, setupPermissionBridgeHandler } from "./permission-bridge-handler"
// ── Phase 4: Permission Synchronization & Verification ──
export type { PermissionResolution, PermissionSuggestion, SwarmPermissionRequest } from "./permission-sync"
export { createPermissionRequest, generateRequestId } from "./permission-sync"
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
export { VERIFICATION_AGENT_TYPE, VERIFICATION_DISALLOWED_TOOLS } from "./verification-agent"
