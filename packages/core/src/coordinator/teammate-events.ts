/**
 * Bus events for in-process teammate lifecycle.
 *
 * Published from `teammate-spawn.ts` and `teammate-runner.ts`,
 * consumed by SSE handlers to push teammate status to connected clients.
 */
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"

export const TeammateEvent = {
  /** Fired when a new teammate is spawned and registered in AppState. */
  Spawned: BusEvent.define(
    "teammate.spawned",
    z.object({
      teamName: z.string(),
      agentId: z.string(),
      agentName: z.string(),
      color: z.string().optional(),
      taskId: z.string(),
      parentSessionId: Identifier.schema("session"),
    }),
  ),

  /** Fired when a teammate finishes work and enters the idle polling loop. */
  Idle: BusEvent.define(
    "teammate.idle",
    z.object({
      teamName: z.string(),
      agentId: z.string(),
      reason: z.enum(["available", "interrupted", "failed"]),
      summary: z.string().optional(),
    }),
  ),

  /** Fired when a teammate receives a new prompt and begins processing. */
  Active: BusEvent.define(
    "teammate.active",
    z.object({
      teamName: z.string(),
      agentId: z.string(),
      prompt: z.string(),
    }),
  ),

  /** Fired when a teammate is killed (force or graceful shutdown). */
  Killed: BusEvent.define(
    "teammate.killed",
    z.object({
      teamName: z.string(),
      agentId: z.string(),
      reason: z.string().optional(),
    }),
  ),
}
