import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { SessionID } from "@/session/schema"
import { TraceID } from "../../trace/schema"
import { Trace } from "../../trace/trace"
import { lazy } from "../../util/lazy"

export const TraceRoutes = lazy(() =>
  new Hono()
    .get(
      "/:sessionID/trace",
      describeRoute({
        summary: "List traces",
        description: "Get a list of all traces for a session.",
        operationId: "project.session.trace.list",
        responses: {
          200: {
            description: "List of traces",
            content: {
              "application/json": {
                schema: resolver(Trace.Info.array()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "query",
        z.object({
          deep: z.coerce.boolean().optional(),
        }),
      ),
      (c) => {
        const { sessionID } = c.req.valid("param")
        const { deep } = c.req.valid("query")
        return c.json(deep ? Trace.listDeep(sessionID) : Trace.list(sessionID))
      },
    )
    .get(
      "/:sessionID/trace/search",
      describeRoute({
        summary: "Search traces",
        description: "Search traces by system prompt and tool content.",
        operationId: "project.session.trace.search",
        responses: {
          200: {
            description: "Matching trace IDs",
            content: {
              "application/json": {
                schema: resolver(z.object({ ids: z.array(z.string()) })),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "query",
        z.object({
          q: z.string().min(1),
        }),
      ),
      (c) => {
        const { sessionID } = c.req.valid("param")
        const { q } = c.req.valid("query")
        return c.json({ ids: Trace.search(sessionID, q) })
      },
    )
    .get(
      "/:sessionID/trace/export",
      describeRoute({
        summary: "Export traces",
        description: "Export all traces for a session in JSON or Markdown format.",
        operationId: "project.session.trace.export",
        responses: {
          200: {
            description: "Exported trace data",
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "query",
        z.object({
          format: z.enum(["json", "md"]).default("json"),
        }),
      ),
      (c) => {
        const { sessionID } = c.req.valid("param")
        const { format } = c.req.valid("query")
        if (format === "md") {
          return c.text(Trace.toMarkdown(sessionID))
        }
        return c.json(Trace.toJSON(sessionID))
      },
    )
    .get(
      "/:sessionID/trace/:traceID",
      describeRoute({
        summary: "Get trace detail",
        description: "Get full trace detail with resolved system prompt and tools.",
        operationId: "project.session.trace.get",
        responses: {
          200: {
            description: "Trace detail",
            content: {
              "application/json": {
                schema: resolver(Trace.Detail),
              },
            },
          },
          404: {
            description: "Trace not found",
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          traceID: TraceID.zod,
        }),
      ),
      (c) => {
        const { sessionID, traceID } = c.req.valid("param")
        const detail = Trace.get(sessionID, traceID)
        if (!detail) return c.json({ error: "Trace not found" }, 404)
        return c.json(detail)
      },
    ),
)
