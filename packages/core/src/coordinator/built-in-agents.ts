/**
 * Built-in Agent Registry
 *
 * Provides a centralized registry of built-in agent profiles that the
 * coordinator can instantiate as specialized teammates.
 *
 * Each profile defines:
 * - Tool restrictions (disallowed tools)
 * - System prompt overrides
 * - Visual identity (color)
 * - Model selection policy
 *
 * Reference: Claude Code `tools/AgentTool/builtInAgents.ts`
 */
import {
  VERIFICATION_AGENT_TYPE,
  VERIFICATION_CRITICAL_REMINDER,
  VERIFICATION_DISALLOWED_TOOLS,
  VERIFICATION_SYSTEM_PROMPT,
  VERIFICATION_WHEN_TO_USE,
} from "./verification-agent"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BuiltInAgentProfile {
  /** Discriminator for agent type selection. */
  readonly agentType: string
  /** Human-readable description of when to use this agent. */
  readonly whenToUse: string
  /** Color for UI differentiation. */
  readonly color: string
  /** Whether this agent runs in the background. */
  readonly background: boolean
  /** Tools this agent is forbidden from using. */
  readonly disallowedTools: readonly string[]
  /** Model selection: 'inherit' uses the coordinator's model. */
  readonly model: "inherit" | string
  /** System prompt injected at the start of every conversation. */
  readonly systemPrompt: string
  /** Critical reminder appended to every prompt iteration (prevents drift). */
  readonly criticalReminder?: string
}

// ─── Built-in Profiles ──────────────────────────────────────────────────────

export const VERIFICATION_AGENT: BuiltInAgentProfile = {
  agentType: VERIFICATION_AGENT_TYPE,
  whenToUse: VERIFICATION_WHEN_TO_USE,
  color: "red",
  background: true,
  disallowedTools: VERIFICATION_DISALLOWED_TOOLS,
  model: "inherit",
  systemPrompt: VERIFICATION_SYSTEM_PROMPT,
  criticalReminder: VERIFICATION_CRITICAL_REMINDER,
}

// ─── Registry ────────────────────────────────────────────────────────────────

/** All available built-in agent profiles. */
const BUILT_IN_AGENTS: readonly BuiltInAgentProfile[] = [VERIFICATION_AGENT]

/**
 * Get all available built-in agent profiles.
 *
 * Unconditionally available in coordinator mode (no feature flags).
 */
export function getBuiltInAgents(): readonly BuiltInAgentProfile[] {
  return BUILT_IN_AGENTS
}

/**
 * Find a built-in agent profile by type.
 *
 * @returns The profile, or `undefined` if no built-in matches.
 */
export function findBuiltInAgent(agentType: string): BuiltInAgentProfile | undefined {
  return BUILT_IN_AGENTS.find((a) => a.agentType === agentType)
}

/**
 * Check if a given agent type corresponds to a built-in profile.
 */
export function isBuiltInAgentType(agentType: string): boolean {
  return BUILT_IN_AGENTS.some((a) => a.agentType === agentType)
}
