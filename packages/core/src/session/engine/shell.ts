import { spawn } from "node:child_process"
import path from "node:path"
import { ulid } from "ulid"
import z from "zod"
import { Shell } from "@/shell/shell"
import { Agent } from "../../agent/agent"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { ModelID, ProviderID } from "../../provider/schema"
import { defer } from "../../util/defer"
import { Log } from "../../util/log"
import { Session } from ".."
import type { Message } from "../message"
import { SessionRevert } from "../revert"
import { MessageID, PartID, SessionID } from "../schema"
import { cancel, lastModel, loop, start, state } from "./loop"

const log = Log.create({ service: "session.prompt.shell" })

export const ShellInput = z.object({
  sessionID: SessionID.zod,
  agent: z.string(),
  model: z
    .object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
    })
    .optional(),
  command: z.string(),
})
export type ShellInput = z.infer<typeof ShellInput>

export async function shell(input: ShellInput) {
  const abort = start(input.sessionID)
  if (!abort) {
    throw new Session.BusyError(input.sessionID)
  }

  using _ = defer(() => {
    // If no queued callbacks, cancel (the default)
    const callbacks = state()[input.sessionID]?.callbacks ?? []
    if (callbacks.length === 0) {
      cancel(input.sessionID)
    } else {
      // Otherwise, trigger the session loop to process queued items
      loop({ sessionID: input.sessionID, resume_existing: true }).catch((error) => {
        log.error("session loop failed to resume after shell command", { sessionID: input.sessionID, error })
      })
    }
  })

  const session = await Session.get(input.sessionID)
  if (session.revert) {
    await SessionRevert.cleanup(session)
  }
  const agent = await Agent.get(input.agent)
  const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
  const userMsg: Message.User = {
    id: MessageID.ascending(),
    sessionID: input.sessionID,
    time: {
      created: Date.now(),
    },
    role: "user",
    agent: input.agent,
    model: {
      providerID: model.providerID,
      modelID: model.modelID,
    },
  }
  await Session.updateMessage(userMsg)
  const userPart: Message.Part = {
    type: "text",
    id: PartID.ascending(),
    messageID: userMsg.id,
    sessionID: input.sessionID,
    text: "The following tool was executed by the user",
    synthetic: true,
  }
  await Session.updatePart(userPart)

  const msg: Message.Assistant = {
    id: MessageID.ascending(),
    sessionID: input.sessionID,
    parentID: userMsg.id,
    mode: input.agent,
    agent: input.agent,
    cost: 0,
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    time: {
      created: Date.now(),
    },
    role: "assistant",
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: model.modelID,
    providerID: model.providerID,
  }
  await Session.updateMessage(msg)
  const part: Message.Part = {
    type: "tool",
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID: input.sessionID,
    tool: "bash",
    callID: ulid(),
    state: {
      status: "running",
      time: {
        start: Date.now(),
      },
      input: {
        command: input.command,
      },
    },
  }
  await Session.updatePart(part)
  const preferred = Shell.preferred()
  const shellName = (
    process.platform === "win32" ? path.win32.basename(preferred, ".exe") : path.basename(preferred)
  ).toLowerCase()

  const invocations: Record<string, { args: string[] }> = {
    nu: {
      args: ["-c", input.command],
    },
    fish: {
      args: ["-c", input.command],
    },
    zsh: {
      args: [
        "-c",
        "-l",
        `
            [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
            [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
      ],
    },
    bash: {
      args: [
        "-c",
        "-l",
        `
            shopt -s expand_aliases
            [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
      ],
    },
    // Windows cmd
    cmd: {
      args: ["/c", input.command],
    },
    // Windows PowerShell
    powershell: {
      args: ["-NoProfile", "-Command", input.command],
    },
    pwsh: {
      args: ["-NoProfile", "-Command", input.command],
    },
    // Fallback: any shell that doesn't match those above
    //  - No -l, for max compatibility
    "": {
      args: ["-c", `${input.command}`],
    },
  }

  const matchingInvocation = invocations[shellName] ?? invocations[""]
  const args = matchingInvocation?.args

  const cwd = Instance.directory
  const shellEnv = await Plugin.trigger(
    "shell.env",
    { cwd, sessionID: input.sessionID, callID: part.callID },
    { env: {} },
  )
  const proc = spawn(preferred, args, {
    cwd,
    detached: process.platform !== "win32",
    windowsHide: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...shellEnv.env,
      TERM: "dumb",
    },
  })

  let output = ""

  proc.stdout?.on("data", (chunk) => {
    output += chunk.toString()
    if (part.state.status === "running") {
      part.state.metadata = {
        output: output,
        description: "",
      }
      Session.updatePart(part)
    }
  })

  proc.stderr?.on("data", (chunk) => {
    output += chunk.toString()
    if (part.state.status === "running") {
      part.state.metadata = {
        output: output,
        description: "",
      }
      Session.updatePart(part)
    }
  })

  let aborted = false
  let exited = false

  const kill = () => Shell.killTree(proc, { exited: () => exited })

  if (abort.aborted) {
    aborted = true
    await kill()
  }

  const abortHandler = () => {
    aborted = true
    void kill()
  }

  abort.addEventListener("abort", abortHandler, { once: true })

  await new Promise<void>((resolve) => {
    proc.on("close", () => {
      exited = true
      abort.removeEventListener("abort", abortHandler)
      resolve()
    })
  })

  if (aborted) {
    output += `\n\n${["<metadata>", "User aborted the command", "</metadata>"].join("\n")}`
  }
  msg.time.completed = Date.now()
  await Session.updateMessage(msg)
  if (part.state.status === "running") {
    part.state = {
      status: "completed",
      time: {
        ...part.state.time,
        end: Date.now(),
      },
      input: part.state.input,
      title: "",
      metadata: {
        output,
        description: "",
      },
      output,
    }
    await Session.updatePart(part)
  }
  return { info: msg, parts: [part] }
}
