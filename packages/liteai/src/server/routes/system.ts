import fs from "node:fs/promises"
import path from "node:path"
import fuzzysort from "fuzzysort"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { File } from "../../file"
import { lazy } from "../../util/lazy"

export const SystemRoutes = lazy(() =>
  new Hono()
    .get(
      "/file",
      describeRoute({
        summary: "List system files",
        description: "List files and directories in a specified path on the host system.",
        operationId: "system.file.list",
        responses: {
          200: {
            description: "Files and directories",
            content: {
              "application/json": {
                schema: resolver(File.Node.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        let target = c.req.valid("query").path
        if (!target) {
          target = process.platform === "win32" ? "C:\\" : "/"
        }

        const nodes: File.Node[] = []
        try {
          const stat = await fs.stat(target)
          if (stat.isDirectory()) {
            const entries = await fs.readdir(target, { withFileTypes: true })
            for (const entry of entries) {
              const absolute = path.join(target, entry.name)
              const type = entry.isDirectory() ? "directory" : "file"
              // Only return directories to avoid clutter since this is just used for folder picking
              if (type !== "directory") continue

              nodes.push({
                name: entry.name,
                path: absolute,
                absolute,
                type,
                ignored: false,
              })
            }
          }
        } catch {
          // ignore
        }

        return c.json(
          nodes.sort((a, b) => {
            if (a.type !== b.type) return a.type === "directory" ? -1 : 1
            return a.name.localeCompare(b.name)
          }),
        )
      },
    )
    .get(
      "/find/file",
      describeRoute({
        summary: "Find system files",
        description: "Search for files or directories by name pattern on the host system.",
        operationId: "system.find.files",
        responses: {
          200: {
            description: "File paths",
            content: {
              "application/json": {
                schema: resolver(z.string().array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
          type: z.enum(["file", "directory"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          dir: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query").query
        const limitParam = c.req.valid("query").limit ?? 50
        const typeParam = c.req.valid("query").type
        let target = c.req.valid("query").dir
        if (!target) {
          target = process.platform === "win32" ? "C:\\" : "/"
        }

        const nodes: string[] = []
        try {
          const stat = await fs.stat(target)
          if (stat.isDirectory()) {
            const entries = await fs.readdir(target, { withFileTypes: true })
            for (const entry of entries) {
              // Usually we only care about directories in system.find.files
              if (typeParam === "directory" && !entry.isDirectory()) continue
              if (typeParam === "file" && entry.isDirectory()) continue
              nodes.push(entry.name) // fuzzy sort on name
            }
          }
        } catch {
          // ignore
        }

        let sorted = nodes
        if (query) {
          sorted = fuzzysort.go(query, nodes, { limit: limitParam }).map((r) => r.target)
        } else {
          sorted = sorted.slice(0, limitParam)
        }

        // Return relative to the requested dir as strings
        return c.json(sorted)
      },
    ),
)
