import { Log } from "@liteai/util/log"
import z from "zod"
import { AgentExecutionContext, type AppState, type ParentContext } from "../agent/context"
import { readTeamFile, sanitizeTeamName, type TeamFile, writeTeamFile } from "../coordinator/team-helpers"
import { startInProcessTeammate } from "../coordinator/teammate-runner"
import { spawnInProcessTeammate } from "../coordinator/teammate-spawn"
import { Tool } from "./tool"

const log = Log.create({ service: "tool.team_create" })

const parameters = z.object({
  team_name: z.string().describe("Name for the new team to create"),
  description: z.string().optional().describe("Team description/purpose"),
  agent_type: z.string().optional().describe("Type/role of the team lead (e.g., 'researcher', 'coordinator')"),
  teammates: z
    .array(
      z.object({
        name: z.string().describe("Teammate name"),
        prompt: z.string().describe("Initial instructions for this teammate"),
        model: z.string().optional().describe("Model override for this teammate"),
        plan_mode_required: z.boolean().optional().describe("Whether this teammate must operate in plan mode"),
      }),
    )
    .optional()
    .describe("Teammates to spawn immediately after team creation"),
})

export const TeamCreateTool = Tool.define("team_create", {
  description: `Create a new team for coordinating multiple agents.
- Takes a team_name parameter identifying the team
- Sets up team directories and context
- Optionally spawns teammates immediately with the teammates parameter
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

    // ── Phase 3: Spawn inline teammates if specified ──
    const spawnResults: Array<{ name: string; agentId: string; success: boolean; error?: string }> = []

    if (params.teammates?.length) {
      // Build parent context from current agent context for spawn
      const parentContext: ParentContext = {
        sessionId: leadSessionId,
        abortController: agentCtx.abortController,
        readFileState: agentCtx.readFileState,
        contentReplacementState: agentCtx.contentReplacementState,
        getAppState: agentCtx.getAppState,
        setAppState: agentCtx.setAppState,
        setAppStateForTasks: agentCtx.setAppStateForTasks,
        cwd: agentCtx.cwd,
      }

      for (const mate of params.teammates) {
        const spawnResult = await spawnInProcessTeammate(
          {
            name: mate.name,
            teamName,
            prompt: mate.prompt,
            planModeRequired: mate.plan_mode_required ?? false,
            model: mate.model,
          },
          parentContext,
        )

        spawnResults.push({
          name: mate.name,
          agentId: spawnResult.agentId,
          success: spawnResult.success,
          error: spawnResult.error,
        })

        if (spawnResult.success && spawnResult.teammateContext && spawnResult.abortController && spawnResult.taskId) {
          // Start the runner loop (fire-and-forget)
          startInProcessTeammate({
            identity: {
              agentId: spawnResult.agentId,
              agentName: mate.name,
              teamName,
              planModeRequired: mate.plan_mode_required ?? false,
              parentSessionId: leadSessionId,
            },
            taskId: spawnResult.taskId,
            prompt: mate.prompt,
            teammateContext: spawnResult.teammateContext,
            abortController: spawnResult.abortController,
          })

          log.info("started teammate runner", { agentId: spawnResult.agentId, teamName })
        } else if (!spawnResult.success) {
          log.warn("teammate spawn failed", {
            name: mate.name,
            teamName,
            error: spawnResult.error,
          })
        }
      }
    }

    const teammatesSummary =
      spawnResults.length > 0
        ? `\nSpawned ${spawnResults.filter((r) => r.success).length}/${spawnResults.length} teammates: ${spawnResults.map((r) => `${r.name} (${r.success ? r.agentId : `FAILED: ${r.error}`})`).join(", ")}`
        : ""

    return {
      title: `Created team ${teamName}`,
      metadata: {
        success: true,
        team_name: teamName,
        teammates_spawned: spawnResults.filter((r) => r.success).length,
        teammates_failed: spawnResults.filter((r) => !r.success).length,
      } as Record<string, unknown>,
      output: `Successfully created team: ${teamName} at ${teamFilePath}${teammatesSummary}`,
    }
  },
})
