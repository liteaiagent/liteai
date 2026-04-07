import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import { ModelID, ProviderID } from "../../provider/schema"
import { ToolRegistry } from "../../tool/registry"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

// biome-ignore lint/suspicious/noExplicitAny: explicit `any` required to prevent TS7056 serialization error
export const ToolRoutes: () => Hono<any, any, any> = lazy(
  // biome-ignore lint/suspicious/noExplicitAny: explicit `any` required to prevent TS7056 serialization error
  (): Hono<any, any, any> =>
    new Hono()
      .get(
        "/ids",
        describeRoute({
          summary: "List tool IDs",
          description: "Get a list of all available build-in tools IDs.",
          operationId: "project.tool.ids",
          responses: {
            200: {
              description: "Tool IDs",
              content: {
                "application/json": {
                  schema: resolver(
                    z
                      .array(
                        z.object({
                          id: z.string(),
                          native: z.boolean().optional(),
                          enabled: z.boolean().optional(),
                        }),
                      )
                      .meta({ ref: "ToolIDs" }),
                  ),
                },
              },
            },
            ...errors(400),
          },
        }),
        async (c) => {
          return c.json(await ToolRegistry.ids())
        },
      )
      .get(
        "/",
        describeRoute({
          summary: "List tools",
          description:
            "Get a list of available built-in tools with their JSON schema parameters for a specific provider and model combination.",
          operationId: "project.tool.list",
          responses: {
            200: {
              description: "Tools",
              content: {
                "application/json": {
                  schema: resolver(
                    z
                      .array(
                        z
                          .object({
                            id: z.string(),
                            description: z.string(),
                            parameters: z.any(),
                          })
                          .meta({ ref: "ToolListItem" }),
                      )
                      .meta({ ref: "ToolList" }),
                  ),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "query",
          z.object({
            provider: z.string(),
            model: z.string(),
          }),
        ),
        async (c) => {
          const { provider, model } = c.req.valid("query")
          const tools = await ToolRegistry.tools({
            providerID: ProviderID.make(provider),
            modelID: ModelID.make(model),
          })
          return c.json(
            tools.map((t) => ({
              id: t.id,
              description: t.description,
              // Handle both Zod schemas and plain JSON schemas
              parameters: (t.parameters as z.ZodType)?.def ? zodToJsonSchema(t.parameters as z.ZodType) : t.parameters,
            })),
          )
        },
      ),
)
