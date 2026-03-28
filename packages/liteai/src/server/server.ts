import { NamedError } from "@liteai/util/error"
import { Hono } from "hono"
import { basicAuth } from "hono/basic-auth"
import { type BunWebSocketData, websocket } from "hono/bun"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import { proxy } from "hono/proxy"
import { streamSSE } from "hono/streaming"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { describeRoute, generateSpecs, openAPIRouteHandler, resolver, validator } from "hono-openapi"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Filesystem } from "@/util/filesystem"
import { lazy } from "@/util/lazy"
import { Agent } from "../agent/agent"
import { Auth } from "../auth"
import { Command } from "../command"
import { WorkspaceID } from "../control-plane/schema"
import { WorkspaceContext } from "../control-plane/workspace-context"
import { WorkspaceRouterMiddleware } from "../control-plane/workspace-router-middleware"
import { Flag } from "../flag/flag"
import { Format } from "../format"
import { Global } from "../global"
import { Installation } from "../installation"
import { LSP } from "../lsp"
import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { Vcs } from "../project/vcs"
import { Provider } from "../provider/provider"
import { ProviderID } from "../provider/schema"
import { Skill } from "../skill/skill"
import { NotFoundError } from "../storage/db"
import { Log } from "../util/log"
import { errors } from "./error"
import { MDNS } from "./mdns"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { FileRoutes } from "./routes/file"
import { GlobalRoutes } from "./routes/global"
import { McpRoutes } from "./routes/mcp"
import { PermissionRoutes } from "./routes/permission"
import { PluginRoutes } from "./routes/plugin"
import { ProjectRoutes } from "./routes/project"
import { ProviderRoutes } from "./routes/provider"
import { PtyRoutes } from "./routes/pty"
import { QuestionRoutes } from "./routes/question"
import { SessionRoutes } from "./routes/session"
import { TraceRoutes } from "./routes/trace"
import { TuiRoutes } from "./routes/tui"

globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })

  export const Default = lazy(() => createApp({}))

  export const createApp = (opts: { cors?: string[] }): Hono => {
    const app = new Hono()
    return app
      .onError((err, c) => {
        if (err instanceof NamedError) {
          let status: ContentfulStatusCode
          if (err instanceof NotFoundError) status = 404
          else if (err instanceof Provider.ModelNotFoundError) status = 400
          else if (err.name.startsWith("Worktree")) status = 400
          else status = 500
          if (status >= 500) log.error("failed", { error: err })
          else log.warn("failed", { error: err })
          return c.json(err.toObject(), { status })
        }
        if (err instanceof HTTPException) {
          if (err.status >= 500) log.error("failed", { error: err })
          else log.warn("failed", { error: err })
          return err.getResponse()
        }
        log.error("failed", { error: err })
        const message = err instanceof Error && err.stack ? err.stack : err.toString()
        return c.json(new NamedError.Unknown({ message }).toObject(), {
          status: 500,
        })
      })
      .use((c, next) => {
        // Allow CORS preflight requests to succeed without auth.
        // Browser clients sending Authorization headers will preflight with OPTIONS.
        if (c.req.method === "OPTIONS") return next()
        const password = Flag.LITEAI_SERVER_PASSWORD
        if (!password) return next()
        const username = Flag.LITEAI_SERVER_USERNAME ?? "liteai"
        return basicAuth({ username, password })(c, next)
      })
      .use(async (c, next) => {
        const skipLogging = c.req.path === "/log" || c.req.path === "/global/health"
        if (!skipLogging) {
          log.info("request", {
            method: c.req.method,
            path: c.req.path,
          })
        }
        const timer = log.time("request", {
          method: c.req.method,
          path: c.req.path,
        })
        await next()
        // SSE responses return from next() immediately while the stream continues in the background.
        // Logging the timer here would produce misleading "completed in 4ms" entries.
        const streaming = c.res?.headers.get("content-type")?.includes("text/event-stream")
        if (!skipLogging && !streaming) {
          timer.stop()
        }
      })
      .use(
        cors({
          origin(input) {
            if (!input) return

            if (input.startsWith("http://localhost:")) return input
            if (input.startsWith("http://127.0.0.1:")) return input
            if (
              input === "tauri://localhost" ||
              input === "http://tauri.localhost" ||
              input === "https://tauri.localhost"
            )
              return input

            if (opts?.cors?.includes(input)) {
              return input
            }

            return
          },
        }),
      )
      .route("/global", GlobalRoutes())
      .put(
        "/auth/:providerID",
        describeRoute({
          summary: "Set auth credentials",
          description: "Set authentication credentials",
          operationId: "auth.set",
          responses: {
            200: {
              description: "Successfully set authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "param",
          z.object({
            providerID: ProviderID.zod,
          }),
        ),
        validator("json", Auth.Info),
        async (c) => {
          const providerID = c.req.valid("param").providerID
          const info = c.req.valid("json")
          await Auth.set(providerID, info)
          return c.json(true)
        },
      )
      .delete(
        "/auth/:providerID",
        describeRoute({
          summary: "Remove auth credentials",
          description: "Remove authentication credentials",
          operationId: "auth.remove",
          responses: {
            200: {
              description: "Successfully removed authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "param",
          z.object({
            providerID: ProviderID.zod,
          }),
        ),
        async (c) => {
          const providerID = c.req.valid("param").providerID
          await Auth.remove(providerID)
          return c.json(true)
        },
      )
      .route("/provider", ProviderRoutes())
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
          description: "Initialize or register a project for a given directory.",
          operationId: "project.create",
          responses: {
            200: {
              description: "Created project information",
              content: { "application/json": { schema: resolver(Project.Info) } },
            },
          },
        }),
        validator(
          "query",
          z.object({
            directory: z.string().optional(),
            workspace: z.string().optional(),
          }),
        ),
        async (c) => {
          const raw = c.req.valid("query").directory || c.req.header("x-liteai-directory")
          if (!raw) {
            throw new HTTPException(400, {
              message:
                "Missing required directory context: set the 'directory' query parameter or 'x-liteai-directory' header",
            })
          }
          const directory = Filesystem.resolve(
            (() => {
              try {
                return decodeURIComponent(raw)
              } catch (e) {
                log.debug("decodeURIComponent failed, using raw directory", { raw, error: e })
                return raw
              }
            })(),
          )
          const result = await Project.fromDirectory(directory, { autoCreate: true })
          return c.json(result.project)
        },
      )
      .get(
        "/path",
        describeRoute({
          summary: "Get paths",
          description: "Retrieve the current working directory and related path information for the LiteAI instance.",
          operationId: "path.get",
          responses: {
            200: {
              description: "Path",
              content: {
                "application/json": {
                  schema: resolver(
                    z
                      .object({
                        home: z.string(),
                        state: z.string(),
                        config: z.string(),
                        worktree: z.string(),
                        directory: z.string(),
                      })
                      .meta({
                        ref: "Path",
                      }),
                  ),
                },
              },
            },
          },
        }),
        async (c) => {
          let worktree = ""
          let directory = ""
          try {
            worktree = Instance.worktree
            directory = Instance.directory
          } catch {
            // expected when accessing globally outside an instance context
          }
          return c.json({
            home: Global.Path.home,
            state: Global.Path.state,
            config: Global.Path.config,
            worktree,
            directory,
          })
        },
      )
      .use(async (c, next) => {
        if (c.req.path === "/log") return next()
        const rawWorkspaceID = c.req.query("workspace") || c.req.header("x-liteai-workspace")
        const raw = c.req.query("directory") || c.req.header("x-liteai-directory")
        if (!raw) {
          throw new HTTPException(400, {
            message:
              "Missing required directory context: set the 'directory' query parameter or 'x-liteai-directory' header",
          })
        }
        const directory = Filesystem.resolve(
          (() => {
            try {
              return decodeURIComponent(raw)
            } catch (e) {
              log.debug("decodeURIComponent failed, using raw directory", { raw, error: e })
              return raw
            }
          })(),
        )

        return WorkspaceContext.provide({
          workspaceID: rawWorkspaceID ? WorkspaceID.make(rawWorkspaceID) : undefined,
          async fn() {
            return Instance.provide({
              directory,
              init: InstanceBootstrap,
              async fn() {
                return next()
              },
            })
          },
        })
      })
      .use(WorkspaceRouterMiddleware)
      .get(
        "/doc",
        openAPIRouteHandler(app, {
          documentation: {
            info: {
              title: "liteai",
              version: "0.0.3",
              description: "liteai api",
            },
            openapi: "3.1.1",
          },
        }),
      )
      .use(
        validator(
          "query",
          z.object({
            directory: z.string().optional(),
            workspace: z.string().optional(),
          }),
        ),
      )
      .route("/project", ProjectRoutes())
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
      .post(
        "/instance/dispose",
        describeRoute({
          summary: "Dispose instance",
          description: "Clean up and dispose the current LiteAI instance, releasing all resources.",
          operationId: "instance.dispose",
          responses: {
            200: {
              description: "Instance disposed",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        async (c) => {
          await Instance.dispose()
          return c.json(true)
        },
      )
      .get(
        "/vcs",
        describeRoute({
          summary: "Get VCS info",
          description: "Retrieve version control system (VCS) information for the current project, such as git branch.",
          operationId: "vcs.get",
          responses: {
            200: {
              description: "VCS info",
              content: {
                "application/json": {
                  schema: resolver(Vcs.Info),
                },
              },
            },
          },
        }),
        async (c) => {
          const branch = await Vcs.branch()
          return c.json({
            branch,
          })
        },
      )
      .get(
        "/command",
        describeRoute({
          summary: "List commands",
          description: "Get a list of all available commands in the LiteAI system.",
          operationId: "command.list",
          responses: {
            200: {
              description: "List of commands",
              content: {
                "application/json": {
                  schema: resolver(Command.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const commands = await Command.list()
          return c.json(commands)
        },
      )
      .post(
        "/log",
        describeRoute({
          summary: "Write log",
          description: "Write a log entry to the server logs with specified level and metadata.",
          operationId: "app.log",
          responses: {
            200: {
              description: "Log entry written successfully",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "json",
          z.object({
            service: z.string().meta({ description: "Service name for the log entry" }),
            level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
            message: z.string().meta({ description: "Log message" }),
            extra: z
              .record(z.string(), z.any())
              .optional()
              .meta({ description: "Additional metadata for the log entry" }),
          }),
        ),
        async (c) => {
          const { service, level, message, extra } = c.req.valid("json")
          const logger = Log.create({ service })

          switch (level) {
            case "debug":
              logger.debug(message, extra)
              break
            case "info":
              logger.info(message, extra)
              break
            case "error":
              logger.error(message, extra)
              break
            case "warn":
              logger.warn(message, extra)
              break
          }

          return c.json(true)
        },
      )
      .get(
        "/agent",
        describeRoute({
          summary: "List agents",
          description: "Get a list of all available AI agents in the LiteAI system.",
          operationId: "app.agents",
          responses: {
            200: {
              description: "List of agents",
              content: {
                "application/json": {
                  schema: resolver(Agent.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const modes = await Agent.list()
          return c.json(modes)
        },
      )
      .get(
        "/skill",
        describeRoute({
          summary: "List skills",
          description: "Get a list of all available skills in the LiteAI system.",
          operationId: "app.skills",
          responses: {
            200: {
              description: "List of skills",
              content: {
                "application/json": {
                  schema: resolver(Skill.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const skills = await Skill.all()
          return c.json(skills)
        },
      )
      .get(
        "/lsp",
        describeRoute({
          summary: "Get LSP status",
          description: "Get LSP server status",
          operationId: "lsp.status",
          responses: {
            200: {
              description: "LSP server status",
              content: {
                "application/json": {
                  schema: resolver(LSP.Status.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json(await LSP.status())
        },
      )
      .get(
        "/formatter",
        describeRoute({
          summary: "Get formatter status",
          description: "Get formatter status",
          operationId: "formatter.status",
          responses: {
            200: {
              description: "Formatter status",
              content: {
                "application/json": {
                  schema: resolver(Format.Status.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json(await Format.status())
        },
      )
      .get(
        "/event",
        describeRoute({
          summary: "Subscribe to events",
          description: "Get events",
          operationId: "event.subscribe",
          responses: {
            200: {
              description: "Event stream",
              content: {
                "text/event-stream": {
                  schema: resolver(BusEvent.payloads()),
                },
              },
            },
          },
        }),
        async (c) => {
          log.info("event connected")
          c.header("X-Accel-Buffering", "no")
          c.header("X-Content-Type-Options", "nosniff")
          return streamSSE(c, async (stream) => {
            stream.writeSSE({
              data: JSON.stringify({
                type: "server.connected",
                properties: {},
              }),
            })
            const unsub = Bus.subscribeAll(async (event) => {
              await stream.writeSSE({
                data: JSON.stringify(event),
              })
              if (event.type === Bus.InstanceDisposed.type) {
                stream.close()
              }
            })

            // Send heartbeat every 10s to prevent stalled proxy streams.
            const heartbeat = setInterval(() => {
              stream.writeSSE({
                data: JSON.stringify({
                  type: "server.heartbeat",
                  properties: {},
                }),
              })
            }, 10_000)

            await new Promise<void>((resolve) => {
              stream.onAbort(() => {
                clearInterval(heartbeat)
                unsub()
                resolve()
                log.info("event disconnected")
              })
            })
          })
        },
      )
      .all("/*", async (c) => {
        const p = c.req.path === "/" ? "/index.html" : c.req.path

        // Dev mode: proxy to local Vite dev server
        if (Installation.isLocal()) {
          return proxy(`http://localhost:3000${p}`, {
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
  }

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(Default(), {
      documentation: {
        info: {
          title: "liteai",
          version: "1.0.0",
          description: "liteai api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  /** Returns the URL of the currently active server, if any. */
  export function url(): URL | undefined {
    return active?.url
  }

  // Track the active server for global shutdown
  let active: Bun.Server<BunWebSocketData> | undefined

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
    const server = opts.port === 0 ? (tryServe(9000) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (close?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      active = undefined
      return originalStop(close)
    }

    active = server
    return server
  }

  /** Force-stop the active server, closing all connections immediately. */
  export function shutdown() {
    if (!active) return
    const ref = active
    active = undefined
    try {
      ref.stop(true)
    } catch (e) {
      log.debug("server shutdown error", { error: e })
    }
  }
}
