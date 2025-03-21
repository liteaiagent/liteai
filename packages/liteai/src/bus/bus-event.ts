import type { ZodType } from "zod"
import z from "zod"
import { Log } from "../util/log"

export namespace BusEvent {
  const _log = Log.create({ service: "event" })

  export type Definition = ReturnType<typeof define>

  const registry = new Map<string, Definition>()

  export function define<Type extends string, Properties extends ZodType>(type: Type, properties: Properties) {
    const result = {
      type,
      properties,
    }
    registry.set(type, result)
    return result
  }

  export function payloads() {
    return z
      .discriminatedUnion(
        "type",
        registry
          .entries()
          .map(([type, def]) => {
            return z
              .object({
                type: z.literal(type),
                properties: def.properties,
              })
              .meta({
                ref: `Event.${def.type}`,
              })
          })
          // biome-ignore lint/suspicious/noExplicitAny: zod discriminatedUnion requires a specific tuple type
          .toArray() as any,
      )
      .meta({
        ref: "Event",
      })
  }
}
