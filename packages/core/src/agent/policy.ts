import type { Agent } from "./agent"

/**
 * Checks if an agent is authorized to use admin-trusted resources.
 * Only built-in agents and admin-trusted plugins are allowed to declare
 * inline MCP servers or execution hooks.
 */
export function isRestrictedToPluginOnly(_resourceType: "hooks" | "mcp", agent: Agent.AgentDefinition): boolean {
  // If the agent is a user-defined/project-defined custom agent, it is restricted
  if (agent.source === "custom") {
    return true
  }
  // Plugin and builtin agents are trusted
  return false
}
