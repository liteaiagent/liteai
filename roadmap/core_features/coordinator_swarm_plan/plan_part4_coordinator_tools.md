# Part 4: Coordinator Tools — task_stop, team_create, team_delete

> **Parent:** [Implementation Plan](file:///C:/Users/ahmed/.gemini/antigravity/brain/47fd34a1-ae4d-4a83-b0d9-2f86648113e9/implementation_plan.md)  
> **Reference:**  
> - [TaskStopTool.ts](file:///D:/claude-code/src/tools/TaskStopTool/TaskStopTool.ts) (132 lines)  
> - [TeamCreateTool.ts](file:///D:/claude-code/src/tools/TeamCreateTool/TeamCreateTool.ts) (241 lines)  
> - [TeamDeleteTool.ts](file:///D:/claude-code/src/tools/TeamDeleteTool/TeamDeleteTool.ts) (140 lines)

---

## 1. TaskStopTool

#### [NEW] [task_stop.ts](file:///d:/liteai/packages/core/src/tool/task_stop.ts)

**Purpose:** Stop a running background task (subagent) by its task/session ID.

**Schema:**
```typescript
const parameters = z.object({
  task_id: z.string().describe("The ID of the background task to stop"),
})
```

**Execute logic:**
1. Read `AppState.tasks[task_id]` to validate the task exists
2. Validate the task status is `"running"` — reject if already stopped/completed
3. Call `SessionPrompt.cancel(task_id)` to abort the task's execution
4. Update `AppState.tasks[task_id].status` to `"stopped"`
5. Return success message with task ID

**Key adaptation from reference:**
- Reference uses `stopTask()` helper that accesses global `AppState`. We access `AppState` via `AgentExecutionContext.getStore()` → `getAppState()`/`setAppState()`.
- `SessionPrompt.cancel()` already exists (used in `tool/task.ts:106` and `server/routes/session.ts:506`).
- We need to access the parent session's `AppState` for task lookup, not the subagent's isolated state. This means using `setAppStateForTasks` (the root store passthrough).

```typescript
import z from "zod"
import { AgentExecutionContext, type AppState } from "../agent/context"
import { SessionPrompt } from "../session/engine"
import { Tool } from "./tool"

const parameters = z.object({
  task_id: z.string().describe("The ID of the background task to stop"),
})

export const TaskStopTool = Tool.define("task_stop", {
  description: `Stop a running background task by its ID.
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task`,
  parameters,
  async execute(params, ctx) {
    const agentCtx = AgentExecutionContext.getStore()

    // Get the root AppState (tasks are always in the root store)
    const getAppState = agentCtx?.type === "subagent"
      ? agentCtx.getAppState
      : () => ({} as AppState)
    const setAppState = agentCtx?.type === "subagent"
      ? agentCtx.setAppStateForTasks
      : (_updater: (s: AppState) => AppState) => {}

    const appState = getAppState()
    const task = appState.tasks?.[params.task_id]

    if (!task) {
      return {
        title: "Task not found",
        metadata: { success: false },
        output: `No task found with ID: ${params.task_id}`,
      }
    }

    if (task.status !== "running") {
      return {
        title: "Task not running",
        metadata: { success: false },
        output: `Task ${params.task_id} is not running (status: ${task.status})`,
      }
    }

    // Cancel the task's session execution
    SessionPrompt.cancel(params.task_id)

    // Update task status in root AppState
    setAppState((state) => ({
      ...state,
      tasks: {
        ...state.tasks,
        [params.task_id]: {
          ...state.tasks?.[params.task_id],
          status: "stopped",
        },
      },
    }))

    return {
      title: `Stopped task ${params.task_id}`,
      metadata: { success: true, task_id: params.task_id },
      output: `Successfully stopped task: ${params.task_id}`,
    }
  },
})
```

---

## 2. TeamCreateTool

#### [NEW] [team_create.ts](file:///d:/liteai/packages/core/src/tool/team_create.ts)

**Purpose:** Create a new team for coordinating multiple agents.

**Schema:**
```typescript
const parameters = z.object({
  team_name: z.string().describe("Name for the new team to create"),
  description: z.string().optional().describe("Team description/purpose"),
  agent_type: z.string().optional()
    .describe("Type/role of the team lead (e.g., 'researcher', 'coordinator')"),
})
```

**Execute logic:**
1. Check `AppState.teamContext` — reject if already in a team
2. Sanitize team name (alphanumeric + hyphens)
3. Create team directory structure:
   - `~/.liteai/teams/{team_name}/config.json`
   - `~/.liteai/teams/{team_name}/inboxes/` (for Phase 2 mailbox)
4. Write `TeamFile` config with leader info
5. Set `AppState.teamContext` with team metadata
6. Return team name, config path, lead agent ID

**Team filesystem structure:**
```
~/.liteai/
  teams/
    {team_name}/
      config.json        ← TeamFile: name, description, leadAgentId, members[]
      inboxes/           ← Created empty, used by Phase 2 mailbox
```

**TeamFile schema:**
```typescript
export interface TeamFile {
  name: string
  description?: string
  createdAt: number
  leadAgentId: string
  leadSessionId: string
  members: TeamMember[]
}

export interface TeamMember {
  agentId: string
  name: string
  agentType: string
  joinedAt: number
  cwd: string
  isActive?: boolean
}
```

**AppState.teamContext addition:**

#### [MODIFY] [context.ts](file:///d:/liteai/packages/core/src/agent/context.ts)

```diff
 export interface AppState {
   shouldAvoidPermissionPrompts?: boolean
   permissionMode?: Agent.Info["permissionMode"]
   /** Per-agent activity descriptions from the periodic summarization loop. */
   agentSummaries?: Record<string, string>
   /** Name-to-agentId registry for background agents. */
   agentNameRegistry?: Record<string, string>
   /** Tasks/state tracking for background agents. */
   tasks?: Record<string, BackgroundTaskState>
+  /** Team context for coordinator/swarm mode. */
+  teamContext?: {
+    teamName: string
+    teamFilePath: string
+    leadAgentId: string
+    teammates: Record<string, {
+      name: string
+      agentType: string
+      color: string
+      spawnedAt: number
+      cwd: string
+    }>
+  }
 }
```

**Key adaptation from reference:**
- Reference uses `getCwd()`, `getSessionId()`, `parseUserSpecifiedModel()` globals. We use session-scoped context from `AgentExecutionContext`.
- Reference calls `registerTeamForSessionCleanup()` — we defer cleanup registration to the session lifecycle (existing cleanup hooks in `agent/cleanup.ts`).
- Reference has `tmuxPaneId`, `tmuxSessionName` for tmux-based teammate spawning. LiteAI uses in-process teammates — we omit these fields.
- Team file I/O uses `node:fs/promises` with the `~/.liteai/teams/` directory. Path resolved via `Brand.home` or equivalent.

---

## 3. TeamDeleteTool

#### [NEW] [team_delete.ts](file:///d:/liteai/packages/core/src/tool/team_delete.ts)

**Purpose:** Disband a team and clean up team/task directories.

**Schema:**
```typescript
const parameters = z.object({}) // No input — uses current team from AppState
```

**Execute logic:**
1. Read `AppState.teamContext?.teamName` — reject if no team active
2. Read team config to check for active members
3. If active non-lead members exist → reject with error listing active members
4. Clean up filesystem:
   - Remove `~/.liteai/teams/{team_name}/` directory
5. Clear `AppState.teamContext`
6. Return success message

```typescript
import z from "zod"
import fs from "node:fs/promises"
import { AgentExecutionContext, type AppState } from "../agent/context"
import { Log } from "@liteai/util/log"
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
  async execute(_params, ctx) {
    const agentCtx = AgentExecutionContext.getStore()
    const getAppState = agentCtx?.type === "subagent"
      ? agentCtx.getAppState
      : () => ({} as AppState)
    const setAppState = agentCtx?.type === "subagent"
      ? agentCtx.setAppStateForTasks
      : (_updater: (s: AppState) => AppState) => {}

    const appState = getAppState()
    const teamName = appState.teamContext?.teamName

    if (!teamName) {
      return {
        title: "No team active",
        metadata: { success: false },
        output: "No team name found in current session context. Nothing to clean up.",
      }
    }

    // Check for active members
    const teammates = appState.teamContext?.teammates ?? {}
    const activeMembers = Object.entries(teammates)
      .filter(([_id, t]) => t.name !== "team-lead")
    
    // In Phase 1, we don't have in-process teammates yet, so we
    // check AppState.tasks for any running tasks belonging to team members
    const tasks = appState.tasks ?? {}
    const runningTeamTasks = activeMembers.filter(([id]) => 
      tasks[id]?.status === "running"
    )

    if (runningTeamTasks.length > 0) {
      const memberNames = runningTeamTasks.map(([_, t]) => t.name).join(", ")
      return {
        title: "Team has active members",
        metadata: { success: false, team_name: teamName },
        output: `Cannot cleanup team with ${runningTeamTasks.length} active member(s): ${memberNames}. Send shutdown requests to teammates first.`,
      }
    }

    // Clean up team directory
    const teamFilePath = appState.teamContext?.teamFilePath
    if (teamFilePath) {
      try {
        const teamDir = path.dirname(teamFilePath)
        await fs.rm(teamDir, { recursive: true, force: true })
        log.info("cleaned up team directory", { teamName, teamDir })
      } catch (e) {
        log.warn("failed to clean up team directory", { teamName, error: e })
      }
    }

    // Clear team context from AppState
    setAppState((state) => {
      const { teamContext: _, ...rest } = state
      return rest
    })

    return {
      title: `Deleted team ${teamName}`,
      metadata: { success: true, team_name: teamName },
      output: `Cleaned up directories for team "${teamName}"`,
    }
  },
})
```

---

## 4. Tool Registry Registration

#### [MODIFY] [registry.ts](file:///d:/liteai/packages/core/src/tool/registry.ts)

```diff
 import { SendMessageTool } from "./send_message"
 import { SkillTool } from "./skill"
 import { TaskTool } from "./task"
+import { TaskStopTool } from "./task_stop"
+import { TeamCreateTool } from "./team_create"
+import { TeamDeleteTool } from "./team_delete"
 import { TodoWriteTool } from "./todo"
 
 // ...
 
 const result: Tool.Info[] = [
   InvalidTool,
   ...(question ? [AskUserTool] : []),
   YieldTurnTool,
   RunCommandTool,
   // ...
   SendMessageTool,
   TaskTool,
+  TaskStopTool,
+  TeamCreateTool,
+  TeamDeleteTool,
   WebFetchTool,
   // ...
 ]
```

> [!NOTE]
> `team_create` and `team_delete` are available to all sessions but only useful in coordinator/swarm mode. They don't need a mode gate in the registry — the coordinator tool filter in `query.ts` ensures only the coordinator can use them. Workers and normal agents will have these tools in their pool but won't have prompts directing them to use them.

---

## 5. Coordinator Prompt Updates

#### In [coordinator-prompt.ts](file:///d:/liteai/packages/core/src/coordinator/coordinator-prompt.ts)

The coordinator system prompt (Part 2) needs to reference all three new tools:

```
## 2. Your Tools

- **task** - Spawn a new worker
- **send_message** - Continue an existing worker (send a follow-up to its `to` agent ID)
- **task_stop** - Stop a running worker by task_id
- **team_create** - Create a new team for multi-agent coordination
- **team_delete** - Disband a team and clean up resources (must stop all teammates first)
```

The `task_stop` section in the prompt:

```
### Stopping Workers

Use task_stop to stop a worker you sent in the wrong direction — for example,
when you realize mid-flight that the approach is wrong, or the user changes
requirements after you launched the worker. Pass the `task_id` from the task
tool's launch result. Stopped workers can be continued with send_message.
```

---

## 6. Team Filesystem Helper

A shared helper module for team filesystem operations, used by both `team_create` and `team_delete`:

#### [NEW] [src/coordinator/team-helpers.ts](file:///d:/liteai/packages/core/src/coordinator/team-helpers.ts)

```typescript
import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"
import { Installation } from "../installation"
import { Brand } from "../brand"

const log = Log.create({ service: "coordinator.team" })

export interface TeamFile {
  name: string
  description?: string
  createdAt: number
  leadAgentId: string
  leadSessionId: string
  members: TeamMember[]
}

export interface TeamMember {
  agentId: string
  name: string
  agentType: string
  joinedAt: number
  cwd: string
  isActive?: boolean
}

/** Base directory for all team data. */
export function teamsBaseDir(): string {
  return path.join(Installation.home(), "teams")
}

/** Directory for a specific team. */
export function teamDir(teamName: string): string {
  return path.join(teamsBaseDir(), sanitizeTeamName(teamName))
}

/** Path to a team's config file. */
export function teamConfigPath(teamName: string): string {
  return path.join(teamDir(teamName), "config.json")
}

/** Sanitize a team name for filesystem use. */
export function sanitizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
}

/** Write a team config file, creating directories as needed. */
export async function writeTeamFile(teamName: string, config: TeamFile): Promise<string> {
  const configPath = teamConfigPath(teamName)
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  // Create inboxes directory for Phase 2 mailbox
  await fs.mkdir(path.join(teamDir(teamName), "inboxes"), { recursive: true })
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8")
  log.info("wrote team config", { teamName, configPath })
  return configPath
}

/** Read a team config file. Returns null if not found. */
export async function readTeamFile(teamName: string): Promise<TeamFile | null> {
  try {
    const raw = await fs.readFile(teamConfigPath(teamName), "utf-8")
    return JSON.parse(raw) as TeamFile
  } catch {
    return null
  }
}

/** Remove a team's directory tree. */
export async function cleanupTeamDirectories(teamName: string): Promise<void> {
  const dir = teamDir(teamName)
  try {
    await fs.rm(dir, { recursive: true, force: true })
    log.info("cleaned up team directory", { teamName, dir })
  } catch (e) {
    log.warn("failed to clean up team directory", { teamName, dir, error: e })
  }
}
```

> [!IMPORTANT]
> `Installation.home()` needs to resolve `~/.liteai/`. If this function doesn't exist, we use `path.join(os.homedir(), Brand.dir)` directly. Need to verify during implementation.
