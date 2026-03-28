import { Schema } from "effect"
import z from "zod"
import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

export const TraceID = Schema.String.pipe(
  Schema.brand("TraceID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("trace", id)),
    zod: Identifier.schema("trace").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type TraceID = Schema.Schema.Type<typeof TraceID>
