import { NamedError } from "@liteai/util/error"
import type { ErrorHandler, MiddlewareHandler } from "hono"
import { basicAuth } from "hono/basic-auth"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api"
import { Filesystem } from "@/util/filesystem"
import { WorkspaceID } from "../control-plane/schema"
import { WorkspaceContext } from "../control-plane/workspace-context"
import { Flag } from "../flag/flag"
import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { ProjectID } from "../project/schema"
import { Provider } from "../provider/provider"
import { NotFoundError } from "../storage/db"
import { Log } from "../util/log"

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

export function errorHandler(log: Log.Logger): ErrorHandler {
  return (err, c) => {
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
  }
}

// ---------------------------------------------------------------------------
// Auth middleware — basic auth with OPTIONS bypass for CORS preflight
// ---------------------------------------------------------------------------

export function authMiddleware(): MiddlewareHandler {
  return (c, next) => {
    // Allow CORS preflight requests to succeed without auth.
    // Browser clients sending Authorization headers will preflight with OPTIONS.
    if (c.req.method === "OPTIONS") return next()
    const password = Flag.LITEAI_SERVER_PASSWORD
    if (!password) return next()
    const username = Flag.LITEAI_SERVER_USERNAME ?? "liteai"
    return basicAuth({ username, password })(c, next)
  }
}

// ---------------------------------------------------------------------------
// CSRF middleware — verifies Authorization Bearer token matches SERVER_CSRF_TOKEN
// ---------------------------------------------------------------------------

export function csrfMiddleware(): MiddlewareHandler {
  return (c, next) => {
    const expectedToken = Flag.LITEAI_SERVER_CSRF_TOKEN
    // If no CSRF token is configured, skip CSRF check
    if (!expectedToken) return next()

    // Allow CORS preflight requests to succeed without auth.
    if (c.req.method === "OPTIONS") return next()

    const authHeader = c.req.header("Authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new HTTPException(403, { message: "Missing or invalid Authorization header (CSRF token required)" })
    }

    const providedToken = authHeader.slice("Bearer ".length).trim()
    if (providedToken !== expectedToken) {
      throw new HTTPException(403, { message: "Invalid CSRF token" })
    }

    return next()
  }
}

// ---------------------------------------------------------------------------
// Request logger — logs incoming requests with SSE-aware timer
// ---------------------------------------------------------------------------

export function requestTracer(): MiddlewareHandler {
  return async (c, next) => {
    const tracer = trace.getTracer("liteai-server")
    const method = c.req.method
    const target = new URL(c.req.url).pathname

    const client = c.req.header("x-liteai-client") || c.req.header("user-agent")?.split(" ")[0] || "unknown"
    const workspace = c.req.query("workspace") || c.req.header("x-liteai-workspace") || "none"

    return tracer.startActiveSpan(
      `${method} ${target}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "http.method": method,
          "http.url": c.req.url,
          "http.target": target,
          "liteai.client": client,
          "liteai.workspace": workspace,
        },
      },
      async (span) => {
        try {
          await next()
          span.setAttribute("http.status_code", c.res.status)
          if (c.res.status >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: "Server Error" })
          } else {
            span.setStatus({ code: SpanStatusCode.OK })
          }
        } catch (err) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) })
          span.recordException(err instanceof Error ? err : new Error(String(err)))
          throw err
        } finally {
          span.end()
        }
      }
    )
  }
}

export function requestLogger(log: Log.Logger): MiddlewareHandler {
  return async (c, next) => {
    const client = c.req.header("x-liteai-client") || c.req.header("user-agent")?.split(" ")[0] || "unknown"
    return Log.context.run({ client }, async () => {
      const skipLogging = c.req.path === "/log" || c.req.path === "/health"
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
  }
}

// ---------------------------------------------------------------------------
// CORS middleware — localhost, tauri, and custom origins
// ---------------------------------------------------------------------------

export function corsMiddleware(opts?: { cors?: string[] }): MiddlewareHandler {
  return cors({
    origin(input) {
      if (!input) return

      if (input.startsWith("http://localhost:")) return input
      if (input.startsWith("http://127.0.0.1:")) return input
      if (input === "tauri://localhost" || input === "http://tauri.localhost" || input === "https://tauri.localhost")
        return input

      if (opts?.cors?.includes(input)) {
        return input
      }

      return
    },
  })
}

// ---------------------------------------------------------------------------
// Project-scoped middleware — resolves :projectID → project → Instance
// ---------------------------------------------------------------------------

/**
 * Middleware for project-scoped routes under `/project/:projectID/*`.
 * Resolves the projectID from the path parameter, looks up the project in the
 * database, and boots the Instance context using the project's registered
 * directory. Returns 404 if the project is not registered.
 */
export function projectContextMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const rawProjectID = c.req.param("projectID")
    if (!rawProjectID) {
      throw new HTTPException(400, { message: "Missing projectID path parameter" })
    }

    const projectID = ProjectID.make(rawProjectID)
    const project = Project.get(projectID)

    if (!project) {
      throw new NotFoundError({ message: `Project not found: ${rawProjectID}` })
    }

    const rawWorkspaceID = c.req.query("workspace") || c.req.header("x-liteai-workspace")

    return WorkspaceContext.provide({
      workspaceID: rawWorkspaceID ? WorkspaceID.make(rawWorkspaceID) : undefined,
      async fn() {
        return Instance.provide({
          directory: project.worktree,
          init: InstanceBootstrap,
          async fn() {
            return next()
          },
        })
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely decode a URI-encoded directory string, falling back to the raw value
 * if decoding fails. Returns the resolved absolute path.
 */
export function safeDecodeDirectory(raw: string, log?: Log.Logger): string {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch (e) {
    log?.debug("decodeURIComponent failed, using raw directory", { raw, error: e })
    decoded = raw
  }
  return Filesystem.resolve(decoded)
}
