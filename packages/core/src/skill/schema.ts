import { NamedError } from "@liteai/util/error"
import z from "zod"

export namespace SkillSchema {
  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    content: z.string(),
    argument_hint: z.string().optional(),
    disable_model_invocation: z.boolean().optional(),
    user_invocable: z.boolean().optional(),
    allowed_tools: z.string().optional(),
    model: z.string().optional(),
    context: z.enum(["fork"]).optional(),
    agent: z.string().optional(),
    hooks: z.record(z.string(), z.unknown()).optional(),
    native: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  export type Info = z.infer<typeof Info>

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )
}
