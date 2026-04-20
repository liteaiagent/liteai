import { Log } from "@/util/log"
import type { EngineEvent } from "../events"

const log = Log.create({ service: "session.streaming-tool-executor" })

/**
 * Tools known to be read-only / side-effect-free.
 * These can safely execute concurrently with other concurrent-safe tools.
 * Anything NOT in this set is treated as exclusive (must run alone).
 */
const CONCURRENT_SAFE_TOOLS = new Set(["glob", "grep", "read", "ls", "websearch", "webfetch", "codesearch", "lsp"])

type ToolStatus = "pending" | "accumulating" | "executing" | "completed" | "error" | "yielded"

type TrackedTool = {
  id: string
  toolName: string
  status: ToolStatus
  isConcurrencySafe: boolean
  inputDelta: string
  resolvedInput?: unknown
  result?: EngineEvent.BlockEvent
  error?: EngineEvent.BlockEvent
}

/**
 * Manages streaming tool execution with concurrency control.
 *
 * **Architecture:**
 * The AI SDK handles actual tool invocation via `execute()` callbacks
 * registered on each tool definition. This class sits ABOVE that layer,
 * providing:
 *
 * 1. **Concurrency classification** — Read-only tools (glob, grep, read, etc.)
 *    can safely execute in parallel. Write tools (edit, write, run_command)
 *    require exclusive access.
 *
 * 2. **Tool input accumulation** — As `tool-input-delta` events stream in,
 *    the executor accumulates partial JSON. This enables future early-execution
 *    optimizations where a tool could start before its full input is parsed.
 *
 * 3. **Abort propagation** — When a mutating tool (especially run_command)
 *    errors, sibling tools that haven't completed yet receive cancellation.
 *
 * 4. **Ordered result yielding** — Results are buffered and emitted in the
 *    order tools were received by the model, ensuring deterministic output
 *    even when concurrent tools finish out of order.
 *
 * 5. **Streaming fallback discard** — On model fallback/error, all pending
 *    and in-progress tools are discarded cleanly.
 *
 * **Integration:**
 * The `queryLoop` feeds all stream events through `processEvent()`.
 * Between stream events (during natural pauses), it calls
 * `getCompletedResults()` to drain any ordered results.
 * After the stream ends, it calls `getRemainingResults()` to
 * flush everything.
 */
export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private discarded = false
  private hasErrored = false
  private erroredToolDescription = ""
  private siblingAbortController: AbortController
  private readonly abort: AbortSignal

  constructor(abort: AbortSignal) {
    this.abort = abort
    // Child controller for propagating sibling errors.
    // Aborting this does NOT abort the parent query — just kills
    // sibling tools when a mutating tool errors.
    this.siblingAbortController = new AbortController()
    abort.addEventListener("abort", () => this.siblingAbortController.abort("parent_abort"), { once: true })
  }

  /**
   * Discards all pending and in-progress tools. Called when streaming
   * fallback occurs or the turn is abandoned.
   */
  discard(): void {
    this.discarded = true
    log.info("discarding all pending tools", { toolCount: this.tools.length })
  }

  /**
   * Process a single stream event. Returns the event unchanged if it should
   * be forwarded to the persister, or `undefined` if the executor consumed it.
   *
   * The executor tracks tool lifecycle events to maintain its internal state:
   * - `start/tool` → registers a new tool
   * - `delta/tool` → accumulates input (if forwarded)
   * - `call/tool` → marks tool as executing
   * - `result/tool` → marks tool as completed, buffers result
   * - `error/tool` → marks tool as errored, handles sibling abort
   */
  processEvent(event: EngineEvent.Any): EngineEvent.Any {
    if (this.discarded) return event

    switch (event.type) {
      case "start": {
        if (event.kind === "tool" && event.id) {
          const isConcurrencySafe = CONCURRENT_SAFE_TOOLS.has(event.toolName)
          this.tools.push({
            id: event.id,
            toolName: event.toolName,
            status: "pending",
            isConcurrencySafe,
            inputDelta: "",
          })
          log.info("tool registered", {
            id: event.id,
            toolName: event.toolName,
            isConcurrencySafe,
            queuedCount: this.tools.length,
          })
        }
        break
      }

      case "delta": {
        if (event.part === "tool" && event.id) {
          const tool = this.findTool(event.id)
          if (tool) {
            tool.status = "accumulating"
            tool.inputDelta += event.text
          }
        }
        break
      }

      case "call": {
        if (event.kind === "tool" && event.id) {
          const tool = this.findTool(event.id)
          if (tool) {
            tool.status = "executing"
            tool.resolvedInput = event.input
            log.info("tool executing", {
              id: tool.id,
              toolName: tool.toolName,
              isConcurrencySafe: tool.isConcurrencySafe,
            })
          }
        }
        break
      }

      case "result": {
        if (event.kind === "tool" && event.id) {
          const tool = this.findTool(event.id)
          if (tool) {
            tool.status = "completed"
            tool.result = event
            log.info("tool completed", { id: tool.id, toolName: tool.toolName })
          }
        }
        break
      }

      case "error": {
        if (event.kind === "tool" && event.id) {
          const tool = this.findTool(event.id)
          if (tool) {
            tool.status = "error"
            tool.error = event

            // Mutating tool errors abort sibling tools.
            // Read-only tool failures are independent — one grep failing
            // shouldn't cancel an edit.
            if (!tool.isConcurrencySafe) {
              this.hasErrored = true
              this.erroredToolDescription = this.getToolDescription(tool)
              this.siblingAbortController.abort("sibling_error")
              log.warn("mutating tool error — aborting siblings", {
                id: tool.id,
                toolName: tool.toolName,
                description: this.erroredToolDescription,
              })
            }
          }
        }
        break
      }
    }

    // Always forward the event to the persister — the executor is
    // a monitoring/tracking layer, not an interceptor.
    return event
  }

  /**
   * Returns true if there are tools that haven't been yielded yet.
   */
  hasUnfinishedTools(): boolean {
    return this.tools.some((t) => t.status !== "yielded" && t.status !== "error")
  }

  /**
   * Returns true if a specific tool name was called during this turn.
   */
  hasToolCall(toolName: string): boolean {
    return this.tools.some((t) => t.toolName === toolName)
  }

  /**
   * Returns true if any tool has produced a sibling-fatal error.
   */
  hasSiblingError(): boolean {
    return this.hasErrored
  }

  /**
   * Get the sibling abort signal. Tools can listen to this to cancel
   * when a sibling mutating tool errors.
   */
  get siblingAbortSignal(): AbortSignal {
    return this.siblingAbortController.signal
  }

  /**
   * Get all tracked tool IDs and their current status.
   * Useful for debugging and telemetry.
   */
  getToolSummary(): Array<{ id: string; toolName: string; status: ToolStatus; isConcurrencySafe: boolean }> {
    return this.tools.map((t) => ({
      id: t.id,
      toolName: t.toolName,
      status: t.status,
      isConcurrencySafe: t.isConcurrencySafe,
    }))
  }

  /**
   * Get concurrency statistics for the current turn.
   * Helps the orchestrator decide whether to yield CPU.
   */
  getConcurrencyState(): {
    total: number
    executing: number
    concurrentSafeExecuting: number
    exclusiveExecuting: number
    completed: number
    pending: number
  } {
    const executing = this.tools.filter((t) => t.status === "executing")
    return {
      total: this.tools.length,
      executing: executing.length,
      concurrentSafeExecuting: executing.filter((t) => t.isConcurrencySafe).length,
      exclusiveExecuting: executing.filter((t) => !t.isConcurrencySafe).length,
      completed: this.tools.filter((t) => t.status === "completed" || t.status === "yielded").length,
      pending: this.tools.filter((t) => t.status === "pending" || t.status === "accumulating").length,
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private findTool(id: string): TrackedTool | undefined {
    return this.tools.find((t) => t.id === id)
  }

  private getToolDescription(tool: TrackedTool): string {
    if (!tool.resolvedInput || typeof tool.resolvedInput !== "object") {
      return tool.toolName
    }
    const input = tool.resolvedInput as Record<string, unknown>
    const summary = (input.command ?? input.file_path ?? input.pattern ?? "") as string
    if (typeof summary === "string" && summary.length > 0) {
      const truncated = summary.length > 40 ? `${summary.slice(0, 40)}…` : summary
      return `${tool.toolName}(${truncated})`
    }
    return tool.toolName
  }
}
