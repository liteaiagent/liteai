import { Log } from "@liteai/util/log"
import z from "zod"
import { AgentExecutionContext, type AppState } from "../agent/context"
import { cleanupTeamDirectories } from "../coordinator/team-helpers"
import { killInProcessTeammate } from "../coordinator/teammate-spawn"
import { isTeammateTask } from "../coordinator/teammate-types"
import { Tool } from "./tool"

const log = Log.create({ service: "tool.team_delete" })

const parameters = z.object({})

export const TeamDeleteTool = Tool.define("team_delete", {
  description: `Clean up team and task directories when the swarm work is complete.

This operation:
- Kills all active in-process teammates
- Removes the team directory (~/.liteai/teams/{team-name}/)
- Clears team context from the current session

IMPORTANT: TeamDelete will forcefully terminate any active teammates.
Prefer sending shutdown requests to teammates first for graceful shutdown.`,
  parameters,
  // _params is required by the Tool.execute signature but unused here
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

    // ── Phase 3: Kill all active in-process teammates ──
    const tasks = appState.tasks ?? {}
    let killedCount = 0
    for (const [taskId, task] of Object.entries(tasks)) {
      if (isTeammateTask(task) && task.identity.teamName === teamName && task.status !== "killed") {
        const killed = killInProcessTeammate(taskId, setAppState)
        if (killed) {
          killedCount++
          log.info("killed teammate during team delete", {
            taskId,
            agentId: task.identity.agentId,
            teamName,
          })
        }
      }
    }

    if (killedCount > 0) {
      log.info("killed teammates before team cleanup", { teamName, killedCount })
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
      metadata: {
        success: true,
        team_name: teamName,
        teammates_killed: killedCount,
      } as Record<string, unknown>,
      output: `Cleaned up directories for team "${teamName}"${killedCount > 0 ? ` (killed ${killedCount} active teammate${killedCount !== 1 ? "s" : ""})` : ""}`,
    }
  },
})
