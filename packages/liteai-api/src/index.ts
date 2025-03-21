/**
 * LiteAI Server — Hono + Bun
 *
 * Port of liteai/_client.py + liteai/main.py
 *
 * Creates a Hono server with CORS, bearer auth middleware,
 * and mounts all routes.
 */

import { Hono } from "hono"
import { cors } from "hono/cors"
import { ApiKeyError, verifyApiKey } from "./api-keys.js"
import { getAuthMode, getCodeAssistClient, getGenaiClient } from "./auth/index.js"
import { CodeAssistContentGenerator, type ContentGenerator, SdkContentGenerator } from "./content-generator.js"
import { settings } from "./core/config.js"
import { createLogger, type LogLevel, setLogLevel } from "./core/logger.js"
import { LoggingContentGenerator } from "./core/logging-content-generator.js"
import { about } from "./routes/about.js"
import { authRoutes } from "./routes/auth.js"
import { chatCompletions, setContentGeneratorFactory } from "./routes/chat-completions.js"
// Routes
import { health } from "./routes/health.js"
import { models } from "./routes/models.js"
import { settingsRoute } from "./routes/settings.js"
import { userInfoRoute } from "./routes/user-info.js"

const logger = createLogger("server")

// ── Content Generator Factory ──────────────────────────────────────────────

let _cachedGenerator: ContentGenerator | null = null
let _pendingGenerator: Promise<ContentGenerator> | null = null

async function createContentGenerator(): Promise<ContentGenerator> {
  if (_cachedGenerator) return _cachedGenerator
  if (_pendingGenerator) return _pendingGenerator

  _pendingGenerator = (async () => {
    try {
      const mode = getAuthMode()
      logger.info(`Creating content generator for auth mode: ${mode}`)

      let inner: ContentGenerator
      if (mode === "oauth" || mode === "compute-adc") {
        const client = await getCodeAssistClient()
        inner = new CodeAssistContentGenerator(client)
      } else {
        // api-key or vertex-ai — use @google/genai SDK
        const genai = getGenaiClient()
        inner = new SdkContentGenerator(genai)
      }

      // Wrap with logging decorator
      _cachedGenerator = new LoggingContentGenerator(inner)
      return _cachedGenerator
    } catch (err) {
      // Clear pending so subsequent calls can retry
      _pendingGenerator = null
      throw err
    }
  })()

  return _pendingGenerator
}

// ── App Assembly ───────────────────────────────────────────────────────────

function createApp(): Hono {
  const app = new Hono()

  // Global CORS
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["*"],
      exposeHeaders: ["*"],
    }),
  )

  // ── Public Routes (no auth) ──────────────────────────────────────────

  app.route("/", health)
  app.route("/auth", authRoutes)

  // ── Auth Middleware for /v1/* ─────────────────────────────────────────

  app.use("/v1/*", async (c, next) => {
    const authHeader = c.req.header("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        {
          error: {
            message: "Missing or invalid Authorization header",
            type: "authentication_error",
            code: "missing_api_key",
          },
        },
        401,
      )
    }

    const token = authHeader.slice(7)
    try {
      await verifyApiKey(settings.jwt_public_key, token)
    } catch (err) {
      if (err instanceof ApiKeyError) {
        return c.json(
          {
            error: {
              message: err.message,
              type: "authentication_error",
              code: err.code,
            },
          },
          401,
        )
      }
      return c.json(
        {
          error: {
            message: "Authentication failed",
            type: "authentication_error",
            code: "invalid_api_key",
          },
        },
        401,
      )
    }

    return next()
  })

  // Also protect /user_info
  app.use("/user_info*", async (c, next) => {
    const authHeader = c.req.header("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        {
          error: {
            message: "Missing or invalid Authorization header",
            type: "authentication_error",
            code: "missing_api_key",
          },
        },
        401,
      )
    }

    const token = authHeader.slice(7)
    try {
      await verifyApiKey(settings.jwt_public_key, token)
    } catch {
      return c.json(
        {
          error: {
            message: "Invalid API key",
            type: "authentication_error",
            code: "invalid_api_key",
          },
        },
        401,
      )
    }

    return next()
  })

  // ── Protected Routes ─────────────────────────────────────────────────

  app.route("/v1", chatCompletions)
  app.route("/v1", models)
  app.route("/v1", about)
  app.route("/v1", settingsRoute)
  app.route("/", userInfoRoute)

  // ── 404 Fallback ─────────────────────────────────────────────────────

  app.notFound((c) =>
    c.json(
      {
        error: {
          message: `Not found: ${c.req.method} ${c.req.path}`,
          type: "not_found",
        },
      },
      404,
    ),
  )

  // ── Error Handler ────────────────────────────────────────────────────

  app.onError((err, c) => {
    logger.error(`Unhandled error: ${err.message}`)
    return c.json(
      {
        error: {
          message: err.message || "Internal server error",
          type: "server_error",
        },
      },
      500,
    )
  })

  return app
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Set log level
  setLogLevel((settings.log_level || "INFO").toUpperCase() as LogLevel)

  // Wire up content generator
  setContentGeneratorFactory(createContentGenerator)

  const app = createApp()

  const host = settings.host
  const port = settings.port

  if (!settings.jwt_public_key) {
    logger.error("JWT public key is not configured. Set JWT_PUBLIC_KEY_API env var or provide keys/api_public.pem")
    process.exit(1)
  }

  logger.info(`Starting LiteAI Node.js server on ${host}:${port}`)
  logger.info(`Auth mode: ${getAuthMode()}`)

  Bun.serve({
    fetch: app.fetch,
    hostname: host,
    port,
    // Disable idle timeout for SSE streaming — Bun's default (10s) kills
    // long-running SSE connections when the upstream API is thinking.
    idleTimeout: 0,
  })

  logger.info(`LiteAI listening on http://${host}:${port}`)
}

main().catch((err) => {
  console.error("Failed to start server:", err)
  process.exit(1)
})

export { createApp }
