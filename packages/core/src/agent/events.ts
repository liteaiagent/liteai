import { z } from "zod"
import { BusEvent } from "@/bus/bus-event"

export const AgentEvent = {
  Spawned: BusEvent.define(
    "agent.spawned",
    z.object({
      agentId: z.string(),
      agentType: z.string(),
      parentId: z.string(),
      isAsync: z.boolean(),
    }),
  ),

  Completed: BusEvent.define(
    "agent.completed",
    z.object({
      agentId: z.string(),
      agentType: z.string(),
      status: z.enum(["completed", "failed", "killed"]),
      duration: z.number(),
      usage: z.object({
        totalTokens: z.number(),
        toolCalls: z.number(),
        duration: z.number(),
      }),
    }),
  ),

  Progress: BusEvent.define(
    "agent.progress",
    z.object({
      agentId: z.string(),
      activity: z.string(),
    }),
  ),

  /**
   * Published when a background agent reaches a terminal state (completed, failed, killed).
   * Consumed by SSE/terminal notification transports to notify the parent conversation.
   * See SC-008: notifications must be delivered within 1s of terminal state.
   */
  TerminalNotification: BusEvent.define(
    "agent.terminal_notification",
    z.object({
      agentId: z.string(),
      status: z.enum(["completed", "failed", "killed"]),
      description: z.string(),
      usage: z.object({
        totalTokens: z.number(),
        toolCalls: z.number(),
        duration: z.number(),
      }),
      error: z.string().optional(),
      partialResult: z.string().optional(),
    }),
  ),

  CacheEvictionHint: BusEvent.define(
    "liteai_cache_eviction_hint",
    z.object({
      agentId: z.string(),
    }),
  ),
}
