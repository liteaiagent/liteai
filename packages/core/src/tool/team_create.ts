import z from "zod"
import { AgentExecutionContext, type AppState } from "../agent/context"
import { readTeamFile, sanitizeTeamName, type TeamFile, writeTeamFile } from "../coordinator/team-helpers"
import { Tool } from "./tool"

const parameters = z.object({
  team_name: z.string().describe("Name for the new team to create"),
  description: z.string().optional().describe("Team description/purpose"),
  agent_type: z.string().optional().describe("Type/role of the team lead (e.g., 'researcher', 'coordinator')"),
})

export const TeamCreateTool = Tool.define("team_create", {
  description: `Create a new team for coordinating multiple agents.
- Takes a team_name parameter identifying the team
- Sets up team directories and context
- Use this when starting a multi-agent swarm task`,
  parameters,
  async execute(params, ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) throw new Error("No agent context found")
    if (agentCtx.type === "teammate") throw new Error("Teammates cannot create teams")

    // H-1: Input validation — reject empty or whitespace-only team names
    const rawName = params.team_name.trim()
    if (rawName.length === 0) {
      throw new Error("team_name is required and must not be empty")
    }
    const sanitized = sanitizeTeamName(rawName)
    if (sanitized.length === 0) {
      throw new Error(`team_name "${params.team_name}" sanitizes to an empty string — use alphanumeric characters`)
    }

    const getAppState = agentCtx.getAppState
    const setAppState = agentCtx.setAppStateForTasks ?? agentCtx.setAppState

    const appState = getAppState()

    // M-5: Throw for invariant violation — coordinator can only lead one team
    if (appState.teamContext) {
      throw new Error(
        `Already leading team "${appState.teamContext.teamName}". A leader can only manage one team at a time. Use team_delete to end the current team before creating a new one.`,
      )
    }

    // H-2: Team name collision detection — check if team already exists on disk
    let teamName = rawName
    const existingTeam = await readTeamFile(teamName)
    if (existingTeam) {
      // Generate a unique name by appending a timestamp suffix
      teamName = `${rawName}-${Date.now().toString(36)}`
    }

    const leadAgentId = "team-lead"
    // H-4: Use the actual session ID from the tool execution context or root agent context
    const leadSessionId =
      agentCtx.type === "subagent"
        ? agentCtx.parentSessionId
        : agentCtx.type === "root"
          ? agentCtx.sessionId
          : ctx.sessionID

    const teamFile: TeamFile = {
      name: teamName,
      description: params.description,
      createdAt: Date.now(),
      leadAgentId,
      leadSessionId,
      members: [
        {
          agentId: leadAgentId,
          name: leadAgentId,
          agentType: params.agent_type ?? "coordinator",
          joinedAt: Date.now(),
          cwd: agentCtx.cwd,
          isActive: true,
        },
      ],
    }

    const teamFilePath = await writeTeamFile(teamName, teamFile)

    setAppState((state: AppState) => ({
      ...state,
      teamContext: {
        teamName,
        teamFilePath,
        leadAgentId,
        teammates: {
          [leadAgentId]: {
            name: leadAgentId,
            agentType: params.agent_type ?? "coordinator",
            color: "blue",
            spawnedAt: Date.now(),
            cwd: teamFile.members[0].cwd,
          },
        },
      },
    }))

    return {
      title: `Created team ${teamName}`,
      metadata: { success: true, team_name: teamName } as Record<string, unknown>,
      output: `Successfully created team: ${teamName} at ${teamFilePath}`,
    }
  },
})
