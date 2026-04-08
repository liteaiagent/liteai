import z from "zod"
import type { BackgroundTaskRegistry } from "@/command/background"
import { interpretCommandResult } from "@/command/semantics"
import { Log } from "@/util/log"
import { Tool } from "./tool"

const log = Log.create({ service: "command-status-tool" })

const MAX_WAIT_DURATION_SECONDS = 300
const DEFAULT_OUTPUT_CHARS = 16_000

export const CommandStatusTool = Tool.define("command_status", {
  description: `Check the status and output of a background command started with run_command.

## Parameters
- \`CommandId\` (required): The command ID returned by run_command (e.g., "cmd_a1b2c3d4").
- \`WaitDurationSeconds\` (required): How long to wait for completion (max ${MAX_WAIT_DURATION_SECONDS}s). If the command finishes before this timeout, the call returns immediately. Set to 0 for an instant status check.
- \`OutputCharacterCount\` (optional): Number of characters of output to return. Defaults to ${DEFAULT_OUTPUT_CHARS}. Keep this as small as possible to avoid excessive context usage.

## Usage Pattern
After starting a long-running command with run_command, poll its status:
1. Call command_status with the CommandId
2. If status is "running", wait and check again
3. If status is "done" or "error", read the output

## Output
Returns the task status, exit code (when done), and the requested output window.`,

  parameters: z.object({
    CommandId: z.string().describe("The command ID from a previous run_command call"),
    WaitDurationSeconds: z
      .number()
      .min(0)
      .max(MAX_WAIT_DURATION_SECONDS)
      .describe(
        `Seconds to wait for completion before returning status (0 = instant check, max ${MAX_WAIT_DURATION_SECONDS})`,
      ),
    OutputCharacterCount: z
      .number()
      .min(0)
      .optional()
      .describe(`Number of output characters to retrieve (default ${DEFAULT_OUTPUT_CHARS})`),
  }),

  async execute(params, ctx) {
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

    // Efficient wait: sleep until done or timeout — not a polling loop
    if (task.status === "running" && params.WaitDurationSeconds > 0) {
      log.info("Waiting for task completion", {
        id: task.id,
        timeoutMs: params.WaitDurationSeconds * 1000,
      })
      await task.waitForCompletion(params.WaitDurationSeconds * 1000)
    }

    const charCount = params.OutputCharacterCount ?? DEFAULT_OUTPUT_CHARS
    const outputWindow = task.output.getChars(charCount)

    // Interpret exit code semantically (grep exit 1 = "no match", not error)
    let interpretation: string | undefined
    if (task.exitCode !== null && task.exitCode !== 0) {
      const result = interpretCommandResult(task.command, task.exitCode, outputWindow, "")
      if (!result.isError && result.message) {
        interpretation = result.message
      }
    }

    const elapsed = task.completedAt
      ? ((task.completedAt - task.startedAt) / 1000).toFixed(1)
      : ((Date.now() - task.startedAt) / 1000).toFixed(1)

    const statusParts: string[] = [`Status: ${task.status}`, `Command: ${task.command}`, `Elapsed: ${elapsed}s`]

    if (task.exitCode !== null) {
      statusParts.push(`Exit code: ${task.exitCode}`)
    }

    if (interpretation) {
      statusParts.push(`Note: ${interpretation}`)
    }

    statusParts.push(`Output (${task.output.totalBytes} bytes total):`)
    statusParts.push(outputWindow || "(no output)")

    const output = statusParts.join("\n")

    return {
      title: `Status of ${task.id}: ${task.status}`,
      metadata: {
        commandId: task.id,
        status: task.status,
        exitCode: task.exitCode,
        description: task.description,
      },
      output,
    }
  },
})
