import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

export const SessionID = Schema.String.pipe(
  Schema.brand("SessionID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    descending: (id?: string) => s.makeUnsafe(Identifier.descending("session", id)),
    zod: Identifier.schema("session").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type SessionID = Schema.Schema.Type<typeof SessionID>

export const MessageID = Schema.String.pipe(
  Schema.brand("MessageID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("message", id)),
    zod: Identifier.schema("message").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type MessageID = Schema.Schema.Type<typeof MessageID>

export const PartID = Schema.String.pipe(
  Schema.brand("PartID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("part", id)),
    zod: Identifier.schema("part").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)

export type PartID = Schema.Schema.Type<typeof PartID>

export const PermissionModeAll = z.enum(["default", "plan", "acceptEdits", "bypassPermissions", "dontAsk", "bubble"])
export type PermissionModeAll = z.infer<typeof PermissionModeAll>

export const PermissionModeCyclable = z.enum(["default", "plan", "acceptEdits", "bypassPermissions"])
export type PermissionModeCyclable = z.infer<typeof PermissionModeCyclable>

// Enforce subset relationship at runtime
for (const val of PermissionModeCyclable.options) {
  if (!(PermissionModeAll.options as readonly string[]).includes(val)) {
    throw new Error(`PermissionModeCyclable value '${val}' is missing from PermissionModeAll`)
  }
}
