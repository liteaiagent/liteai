import { Log } from "@liteai/util/log"
import z from "zod"
import { AgentExecutionContext, type AppState } from "../agent/context"
import { cleanupTeamDirectories } from "../coordinator/team-helpers"
import { Tool } from "./tool"

const log = Log.create({ service: "tool.team_delete" })

const parameters = z.object({})

export const TeamDeleteTool = Tool.define("team_delete", {
  description: `Clean up team and task directories when the swarm work is complete.

This operation:
- Removes the team directory (~/.liteai/teams/{team-name}/)
- Clears team context from the current session

IMPORTANT: TeamDelete will fail if the team still has active members.
Gracefully terminate teammates first, then call TeamDelete.`,
  parameters,
  // _params and _ctx are required by the Tool.execute signature but unused here
  async execute(_params, _ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    if (!agentCtx) throw new Error("No agent context found")
    if (agentCtx.type === "teammate") throw new Error("Teammates cannot delete teams")
    const getAppState = agentCtx.getAppState
    const setAppState = agentCtx.setAppStateForTasks ?? agentCtx.setAppState

    const appState = getAppState()
    const teamName = appState.teamContext?.teamName

    if (!teamName) {
      return {
        title: "No team active",
        metadata: { success: false } as Record<string, unknown>,
        output: "No team name found in current session context. Nothing to clean up.",
      }
    }

    // Check for active members — M-5: throw for invariant violation
    const teammates = appState.teamContext?.teammates ?? {}
    const activeMembers = Object.entries(teammates).filter(([_id, t]) => t.name !== "team-lead")

    // In Phase 1, we don't have in-process teammates yet, so we
    // check AppState.tasks for any running tasks belonging to team members
    const tasks = appState.tasks ?? {}
    const runningTeamTasks = activeMembers.filter(([id]) => tasks[id]?.status === "running")

    if (runningTeamTasks.length > 0) {
      const memberNames = runningTeamTasks.map(([_, t]) => t.name).join(", ")
      throw new Error(
        `Cannot cleanup team "${teamName}" with ${runningTeamTasks.length} active member(s): ${memberNames}. Send shutdown requests to teammates first.`,
      )
    }

    // Clean up team directory using the shared helper (also used by loop.ts cleanup)
    await cleanupTeamDirectories(teamName)
    log.info("cleaned up team directory", { teamName })

    // Clear team context from AppState
    setAppState((state: AppState) => {
      const { teamContext: _, ...rest } = state
      return rest
    })

    return {
      title: `Deleted team ${teamName}`,
      metadata: { success: true, team_name: teamName } as Record<string, unknown>,
      output: `Cleaned up directories for team "${teamName}"`,
    }
  },
})
