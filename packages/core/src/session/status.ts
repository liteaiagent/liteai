import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { CheckpointMetadataSchema } from "./engine/loop/checkpoint-store"
import { SessionID } from "./schema"

export namespace SessionStatus {
  export const Info = z
    .union([
      z.object({
        type: z.literal("idle"),
      }),
      z.object({
        type: z.literal("retry"),
        attempt: z.number(),
        message: z.string(),
        next: z.number(),
      }),
      z.object({
        type: z.literal("busy"),
      }),
      z.object({
        type: z.literal("paused"),
        step: z.number(),
      }),
    ])
    .meta({
      ref: "SessionStatus",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Status: BusEvent.define(
      "session.status",
      z.object({
        sessionID: SessionID.zod,
        status: Info,
      }),
    ),
    // deprecated
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
    /** Emitted when a new checkpoint is captured (step mode) */
    Checkpoint: BusEvent.define(
      "session.checkpoint",
      z.object({
        sessionID: SessionID.zod,
        checkpoint: z.object({
          id: z.string(),
          step: z.number(),
          timestamp: z.number(),
          metadata: CheckpointMetadataSchema,
        }),
      }),
    ),
  }

  const state = Instance.state(() => {
    const data: Record<string, Info> = {}
    return data
  })

  export function get(sessionID: SessionID) {
    return (
      state()[sessionID] ?? {
        type: "idle",
      }
    )
  }

  export function list() {
    return state()
  }

  export function set(sessionID: SessionID, status: Info) {
    Bus.publish(Event.Status, {
      sessionID,
      status,
    })
    if (status.type === "idle") {
      // deprecated
      Bus.publish(Event.Idle, {
        sessionID,
      })
      delete state()[sessionID]
      return
    }
    state()[sessionID] = status
  }
}
