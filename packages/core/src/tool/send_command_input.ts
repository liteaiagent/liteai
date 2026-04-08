import z from "zod"
import type { BackgroundTaskRegistry } from "@/command/background"
import { Log } from "@/util/log"
import { Tool } from "./tool"

const log = Log.create({ service: "send-command-input-tool" })

const MAX_WAIT_MS = 10_000
const DEFAULT_WAIT_MS = 2_000

export const SendCommandInputTool = Tool.define("send_command_input", {
  description: `Send input to a running background command's stdin, or terminate it.

## Parameters
- \`CommandId\` (required): The command ID from a previous run_command call.
- \`Input\` (optional): Text to write to the process's stdin. Include newline characters if needed to submit. Exactly one of Input and Terminate must be specified.
- \`Terminate\` (optional): Set to true to kill the process. Exactly one of Input and Terminate must be specified.
- \`WaitMs\` (optional): Milliseconds to wait after sending input for output (default ${DEFAULT_WAIT_MS}, max ${MAX_WAIT_MS}).

## Usage
Use this tool to interact with interactive processes (REPLs, prompts) or to terminate hung/long-running commands.`,

  parameters: z.object({
    CommandId: z.string().describe("The command ID from a previous run_command call"),
    Input: z.string().optional().describe("Text to send to stdin. Include newlines as needed."),
    Terminate: z.boolean().optional().describe("Set to true to terminate the process"),
    WaitMs: z
      .number()
      .min(500)
      .max(MAX_WAIT_MS)
      .optional()
      .describe(`Milliseconds to wait for output after action (default ${DEFAULT_WAIT_MS}, max ${MAX_WAIT_MS})`),
  }),

  formatValidationError(error: z.ZodError) {
    const issues = error.issues.map((i) => i.message).join("; ")
    return `Invalid send_command_input parameters: ${issues}. Exactly one of Input or Terminate must be specified.`
  },

  async execute(
    params: {
      CommandId: string
      Input?: string
      Terminate?: boolean
      WaitMs?: number
    },
    ctx,
  ) {
    // Validate mutual exclusivity
    const hasInput = params.Input !== undefined
    const hasTerminate = params.Terminate === true
    if (hasInput === hasTerminate) {
      throw new Error("Exactly one of Input or Terminate must be specified, not both or neither")
    }

    const registry = ctx.extra?.backgroundTaskRegistry as BackgroundTaskRegistry | undefined
    if (!registry) {
      throw new Error("Background task registry is not available in this session context")
    }

    const task = registry.get(params.CommandId)
    if (!task) {
      const available = registry.list().map((t) => t.id)
      throw new Error(
        `No background task found with ID "${params.CommandId}". ${
          available.length > 0 ? `Active tasks: ${available.join(", ")}` : "No background tasks are currently tracked."
        }`,
      )
    }

    const waitMs = params.WaitMs ?? DEFAULT_WAIT_MS

    if (hasTerminate) {
      log.info("Terminating background task via send_command_input", { id: task.id })
      await task.terminate()
      // Brief wait for exit handling
      await task.waitForCompletion(Math.min(waitMs, 2000))

      const output = task.output.getChars(4_000)
      return {
        title: `Terminated ${task.id}`,
        metadata: {
          commandId: task.id,
          status: task.status,
          exitCode: task.exitCode,
          action: "terminate",
        } as Record<string, unknown>,
        output: `Process terminated.\nStatus: ${task.status}\nExit code: ${task.exitCode}\n\nFinal output:\n${output || "(no output)"}`,
      }
    }

    if (params.Input === undefined) {
      throw new Error("Invariant failed: Input must be defined when not terminating")
    }

    // Send stdin input
    log.info("Sending stdin to background task", {
      id: task.id,
      inputLength: params.Input.length,
    })
    task.writeStdin(params.Input)

    // Wait for output to accumulate after input
    await task.waitForCompletion(waitMs)

    const output = task.output.getChars(4_000)
    return {
      title: `Sent input to ${task.id}`,
      metadata: {
        commandId: task.id,
        status: task.status,
        exitCode: task.exitCode,
        action: "input",
      } as Record<string, unknown>,
      output: `Input sent. Status: ${task.status}\n\nOutput:\n${output || "(no output)"}`,
    }
  },
})
