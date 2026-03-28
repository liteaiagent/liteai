import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import { MCP } from "../../mcp"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { ModelID, ProviderID } from "../../provider/schema"
import { ToolRegistry } from "../../tool/registry"
import { lazy } from "../../util/lazy"
import { Worktree } from "../../worktree"
import { errors } from "../error"
import { WorkspaceRoutes } from "./workspace"

// biome-ignore lint/suspicious/noExplicitAny: explicit `any` required to prevent TS7056 serialization error
export const ExperimentalRoutes: () => Hono<any, any, any> = lazy(
  // biome-ignore lint/suspicious/noExplicitAny: explicit `any` required to prevent TS7056 serialization error
  (): Hono<any, any, any> =>
    new Hono()
      .get(
        "/tool/ids",
        describeRoute({
          summary: "List tool IDs",
          description:
            "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
          operationId: "project.tool.ids",
          responses: {
            200: {
              description: "Tool IDs",
              content: {
                "application/json": {
                  schema: resolver(z.array(z.string()).meta({ ref: "ToolIDs" })),
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
        "/tool",
        describeRoute({
          summary: "List tools",
          description:
            "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
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
              parameters: (t.parameters as z.ZodType)?._def ? zodToJsonSchema(t.parameters as z.ZodType) : t.parameters,
            })),
          )
        },
      )
      .route("/workspace", WorkspaceRoutes())
      .post(
        "/worktree",
        describeRoute({
          summary: "Create worktree",
          description: "Create a new git worktree for the current project and run any configured startup scripts.",
          operationId: "project.worktree.create",
          responses: {
            200: {
              description: "Worktree created",
              content: {
                "application/json": {
                  schema: resolver(Worktree.Info),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator("json", Worktree.create.schema),
        async (c) => {
          const body = c.req.valid("json")
          const worktree = await Worktree.create(body)
          return c.json(worktree)
        },
      )
      .get(
        "/worktree",
        describeRoute({
          summary: "List worktrees",
          description: "List all sandbox worktrees for the current project.",
          operationId: "project.worktree.list",
          responses: {
            200: {
              description: "List of worktree directories",
              content: {
                "application/json": {
                  schema: resolver(z.array(z.string())),
                },
              },
            },
          },
        }),
        async (c) => {
          const sandboxes = await Project.sandboxes(Instance.project.id)
          return c.json(sandboxes)
        },
      )
      .delete(
        "/worktree",
        describeRoute({
          summary: "Remove worktree",
          description: "Remove a git worktree and delete its branch.",
          operationId: "project.worktree.remove",
          responses: {
            200: {
              description: "Worktree removed",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator("json", Worktree.remove.schema),
        async (c) => {
          const body = c.req.valid("json")
          await Worktree.remove(body)
          await Project.removeSandbox(Instance.project.id, body.directory)
          return c.json(true)
        },
      )
      .post(
        "/worktree/reset",
        describeRoute({
          summary: "Reset worktree",
          description: "Reset a worktree branch to the primary default branch.",
          operationId: "project.worktree.reset",
          responses: {
            200: {
              description: "Worktree reset",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator("json", Worktree.reset.schema),
        async (c) => {
          const body = c.req.valid("json")
          await Worktree.reset(body)
          return c.json(true)
        },
      )
      .get(
        "/resource",
        describeRoute({
          summary: "Get MCP resources",
          description: "Get all available MCP resources from connected servers. Optionally filter by name.",
          operationId: "project.experimental.resource.list",
          responses: {
            200: {
              description: "MCP resources",
              content: {
                "application/json": {
                  schema: resolver(z.record(z.string(), MCP.Resource)),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json(await MCP.resources())
        },
      ),
)
