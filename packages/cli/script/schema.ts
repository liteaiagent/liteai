#!/usr/bin/env bun

import { z } from "zod"
import { TuiConfig } from "../src/cli/config/tui"

function generate(schema: z.ZodType) {
  const result = z.toJSONSchema(schema, {
    io: "input",
    override(ctx) {
      const schema = ctx.jsonSchema

      // Preserve strictness: set additionalProperties: false for objects
      if (
        schema &&
        typeof schema === "object" &&
        schema.type === "object" &&
        schema.additionalProperties === undefined
      ) {
        schema.additionalProperties = false
      }

      // Add examples and default descriptions for string fields with defaults
      if (schema && typeof schema === "object" && "type" in schema && schema.type === "string" && schema?.default) {
        if (!schema.examples) {
          schema.examples = [schema.default]
        }

        schema.description = [schema.description || "", `default: \`${schema.default}\``]
          .filter(Boolean)
          .join("\n\n")
          .trim()
      }
    },
  }) as Record<string, unknown> & {
    allowComments?: boolean
    allowTrailingCommas?: boolean
  }

  // used for json lsps since config supports jsonc
  result.allowComments = true
  result.allowTrailingCommas = true

  return result
}

const tuiFile = process.argv[2]

if (!tuiFile) {
  console.error("Usage: bun run script/schema.ts <tui-out-file>")
  process.exit(1)
}

console.log(tuiFile)
await Bun.write(tuiFile, JSON.stringify(generate(TuiConfig.Info), null, 2))
