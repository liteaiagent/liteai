import { Hono } from "hono"
import { type BunWebSocketData, websocket } from "hono/bun"
import { proxy } from "hono/proxy"
import { describeRoute, generateSpecs, openAPIRouteHandler, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { WorkspaceRouterMiddleware } from "../control-plane/workspace-router-middleware"
import { Installation } from "../installation"
import { Project } from "../project/project"
import { Log } from "../util/log"
import { API_INFO, DEFAULT_PORT, DEV_SERVER_URL } from "./constants"
import { MDNS } from "./mdns"
import {
  authMiddleware,
  corsMiddleware,
  errorHandler,
  projectContextMiddleware,
  requestLogger,
  safeDecodeDirectory,
} from "./middleware"
import { AuthRoutes } from "./routes/auth"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { FileRoutes } from "./routes/file"
import { GlobalRoutes } from "./routes/global"
import { InstanceRoutes } from "./routes/instance"
import { McpRoutes } from "./routes/mcp"
import { PermissionRoutes } from "./routes/permission"
import { PluginRoutes } from "./routes/plugin"
import { ProjectRoutes } from "./routes/project"
import { ProviderRoutes } from "./routes/provider"
import { PtyRoutes } from "./routes/pty"
import { QuestionRoutes } from "./routes/question"
import { SessionRoutes } from "./routes/session"
import { SystemRoutes } from "./routes/system"
import { TraceRoutes } from "./routes/trace"
import { TuiRoutes } from "./routes/tui"

// ---------------------------------------------------------------------------
// Suppress verbose AI SDK warnings at import time.
// Ideally this would live closer to SDK initialization, but the SDK reads
// this flag synchronously on first import, so it must be set early.
// ---------------------------------------------------------------------------
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })

  export const Default = lazy(() => createApp({}))

  /**
   * Build the project-scoped sub-app.
   * All routes here are mounted under `/project/:projectID/...` and require
   * Instance context (LSP, plugins, MCP, file watchers, etc.).
   */
  function createProjectScopedApp(): Hono {
    return new Hono()
      .use(projectContextMiddleware())
      .use(WorkspaceRouterMiddleware)
      .use(
        validator(
          "query",
          z.object({
            workspace: z.string().optional(),
          }),
        ),
      )
      .route("/pty", PtyRoutes())
      .route("/config", ConfigRoutes())
      .route("/experimental", ExperimentalRoutes())
      .route("/session", SessionRoutes())
      .route("/session", TraceRoutes())
      .route("/permission", PermissionRoutes())
      .route("/question", QuestionRoutes())
      .route("/", FileRoutes())
      .route("/mcp", McpRoutes())
      .route("/plugin", PluginRoutes())
      .route("/tui", TuiRoutes())
      .route("/", InstanceRoutes())
  }

  export const createApp = (opts: { cors?: string[] }): Hono => {
    const app = new Hono()
    return (
      app
        // ─── Global middleware ───────────────────────────────────────────
        .onError(errorHandler(log))
        .use(authMiddleware())
        .use(requestLogger(log))
        .use(corsMiddleware(opts))

        // ─── Tier 1: Server-level routes (no project context) ────────────
        .route("/", GlobalRoutes())
        .route("/system", SystemRoutes())
        .route("/auth", AuthRoutes())
        .route("/provider", ProviderRoutes())

        // ─── Tier 2: Project CRUD (no instance boot required) ────────────
        .get(
          "/project",
          describeRoute({
            summary: "List all projects",
            description: "Get a list of projects that have been opened with LiteAI.",
            operationId: "project.list",
            responses: {
              200: {
                description: "List of projects",
                content: {
                  "application/json": {
                    schema: resolver(Project.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(Project.list())
          },
        )
        .post(
          "/project",
          describeRoute({
            summary: "Create project",
            description:
              "Register a project for a given directory. Idempotent — returns the existing project if already registered.",
            operationId: "project.create",
            responses: {
              200: {
                description: "Existing project information",
                content: { "application/json": { schema: resolver(Project.Info) } },
              },
              201: {
                description: "Newly created project information",
                content: { "application/json": { schema: resolver(Project.Info) } },
              },
            },
          }),
          validator(
            "query",
            z.object({
              directory: z.string(),
            }),
          ),
          async (c) => {
            const raw = c.req.valid("query").directory
            const directory = safeDecodeDirectory(raw, log)

            // Check if the project already exists before registering
            const resolved = await Project.resolve(directory)
            const existing = Project.get(resolved.id)
            if (existing) {
              return c.json(existing, 200)
            }

            const result = await Project.register(resolved)
            return c.json(result.project, 201)
          },
        )
        .route("/project", ProjectRoutes())

        // ─── OpenAPI documentation ──────────────────────────────────────
        .get(
          "/doc",
          openAPIRouteHandler(app, {
            documentation: {
              info: API_INFO,
              openapi: "3.1.1",
            },
          }),
        )

        // ─── Tier 3: Project-scoped routes (requires projectID in path) ──
        .route("/project/:projectID", createProjectScopedApp())

        // ─── Static assets / dev proxy (must be last) ───────────────────
        .all("/*", async (c) => {
          const p = c.req.path === "/" ? "/index.html" : c.req.path

          // Dev mode: proxy to local Vite dev server
          if (Installation.isLocal()) {
            return proxy(`${DEV_SERVER_URL}${p}`, {
              ...c.req,
              headers: {
                ...c.req.raw.headers,
                host: "localhost:3000",
              },
            })
          }

          // Production: serve from embedded assets
          const { assets } = await import("./app-assets")
          const entry = assets.get(p)
          if (!entry) {
            // SPA fallback: serve index.html for unmatched routes
            const fallback = assets.get("/index.html")
            if (!fallback) return c.notFound()
            return c.body(Buffer.from(fallback.content, "base64"), {
              headers: { "content-type": fallback.type },
            })
          }
          return c.body(Buffer.from(entry.content, "base64"), {
            headers: { "content-type": entry.type },
          })
        })
    )
  }

  export async function openapi(): Promise<unknown> {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(Default(), {
      documentation: {
        info: API_INFO,
        openapi: "3.1.1",
      },
    })
    return result
  }

  /** Returns the URL of the currently active server, if any. */
  export function url(): URL | undefined {
    return active?.url
  }

  // ---------------------------------------------------------------------------
  // Server lifecycle
  // ---------------------------------------------------------------------------

  /** The currently active server instance, if any. */
  let active: Bun.Server<BunWebSocketData> | undefined

  /** Whether mDNS was published for the active server (used during cleanup). */
  let publishedMDNS = false

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
  }) {
    const app = createApp(opts)
    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: app.fetch,
      websocket: websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch (e) {
        log.warn("server bind failed", { port, error: e })
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(DEFAULT_PORT) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    publishedMDNS =
      !!opts.mdns &&
      !!server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (publishedMDNS && server.port) {
      MDNS.publish(server.port, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    active = server
    return server
  }

  /**
   * Gracefully stop the active server, releasing all resources.
   * Handles mDNS cleanup automatically.
   *
   * @param force — when `true`, closes all connections immediately
   *                (equivalent to the old `shutdown()`).
   */
  export function shutdown(force = true) {
    if (!active) return
    const ref = active
    active = undefined
    if (publishedMDNS) {
      MDNS.unpublish()
      publishedMDNS = false
    }
    try {
      ref.stop(force)
    } catch (e) {
      log.debug("server shutdown error", { error: e })
    }
  }
}
