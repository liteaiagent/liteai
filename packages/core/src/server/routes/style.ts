import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { OutputStyle } from "../../style/style"
import { lazy } from "../../util/lazy"

export const StyleRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List output styles",
        description: "Get all available output styles from the project's .liteai/styles/ directory.",
        operationId: "project.style.list",
        responses: {
          200: {
            description: "List of available output styles",
            content: {
              "application/json": {
                schema: resolver(z.array(OutputStyle.Info)),
              },
            },
          },
        },
      }),
      async (c) => {
        const styles = await OutputStyle.list()
        return c.json(styles)
      },
    )
    .get(
      "/active",
      describeRoute({
        summary: "Get active output style",
        description: "Get the currently active output style, or null if none is configured.",
        operationId: "project.style.active",
        responses: {
          200: {
            description: "Active output style or null",
            content: {
              "application/json": {
                schema: resolver(OutputStyle.Info.nullable()),
              },
            },
          },
        },
      }),
      async (c) => {
        const style = await OutputStyle.active()
        return c.json(style)
      },
    ),
)
