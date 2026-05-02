import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Agent } from "../../agent/agent"
import { AgentWriter } from "../../agent/writer"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

export const AgentRoutes = lazy(() =>
  new Hono()
    .get(
      "/:name",
      describeRoute({
        summary: "Get agent detail",
        operationId: "project.agent.get",
        responses: {
          200: {
            description: "Agent detail",
            content: { "application/json": { schema: resolver(Agent.Info) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const agent = await Agent.get(c.req.valid("param").name)
        if (!agent) return c.json({ error: "Agent not found" }, 404)
        return c.json(agent)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create agent",
        operationId: "project.agent.create",
        responses: {
          200: { description: "Created", content: { "application/json": { schema: resolver(Agent.Info) } } },
          ...errors(400, 409),
        },
      }),
      validator("json", AgentWriter.CreateSchema),
      async (c) => {
        const body = c.req.valid("json")
        const info = await AgentWriter.create(body)
        return c.json(info)
      },
    )
    .put(
      "/:name",
      describeRoute({
        summary: "Update agent",
        operationId: "project.agent.update",
        responses: {
          200: { description: "Updated", content: { "application/json": { schema: resolver(Agent.Info) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ name: z.string() })),
      validator("json", AgentWriter.UpdateSchema),
      async (c) => {
        const name = c.req.valid("param").name
        const body = c.req.valid("json")
        const info = await AgentWriter.update(name, body)
        return c.json(info)
      },
    )
    .delete(
      "/:name",
      describeRoute({
        summary: "Delete agent",
        operationId: "project.agent.delete",
        responses: {
          200: { description: "Deleted", content: { "application/json": { schema: resolver(z.boolean()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const name = c.req.valid("param").name
        await AgentWriter.remove(name)
        return c.json(true)
      },
    ),
)
