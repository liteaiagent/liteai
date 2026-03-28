import { NamedError } from "@liteai/util/error"
import { basicAuth } from "hono/basic-auth"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { ErrorHandler, MiddlewareHandler } from "hono"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "../flag/flag"
import { Provider } from "../provider/provider"
import { NotFoundError } from "../storage/db"
import type { Log } from "../util/log"

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
// Request logger — logs incoming requests with SSE-aware timer
// ---------------------------------------------------------------------------

export function requestLogger(log: Log.Logger): MiddlewareHandler {
  return async (c, next) => {
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
  })
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
