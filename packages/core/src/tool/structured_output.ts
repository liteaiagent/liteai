import z from "zod"
import { Tool } from "./tool"

export const STRUCTURED_OUTPUT_TOOL_NAME = "StructuredOutput"

/**
 * Base StructuredOutput tool definition.
 *
 * This is the registered Tool.Info that appears in the tool pool.
 * When `json_schema` format is active, the query loop replaces this
 * with a schema-validated variant via `createSchemaValidatedOutputTool()`.
 *
 * Without a schema override, the base tool accepts any input via
 * `.passthrough()` — matching Claude Code's SyntheticOutputTool base
 * definition which uses `z.object({}).passthrough()`.
 *
 * @see createSchemaValidatedOutputTool for schema-specific factory
 */
export const StructuredOutputTool = Tool.define<z.ZodObject<z.ZodRawShape>, { valid: boolean }>(
  STRUCTURED_OUTPUT_TOOL_NAME,
  {
    description: `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`,
    parameters: z.object({}).passthrough(),
    // args intentionally unused — base passthrough accepts anything.
    // Query loop overrides this with createStructuredOutputTool() for schema validation.
    async execute(_args, _ctx) {
      // Base implementation: no schema validation, just pass-through.
      // The query loop replaces this with createSchemaValidatedOutputTool()
      // when a json_schema format is active. If this base execute fires,
      // it means no schema was provided — accept anything.
      return {
        title: "Structured Output",
        metadata: { valid: true },
        output: "Structured output captured successfully.",
      }
    },
  },
)
