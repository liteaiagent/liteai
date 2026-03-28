/**
 * Health check route — GET /health
 *
 * Port of liteai/api/routes/health.py
 */

import { Hono } from "hono"
import { getAuthStatus } from "../auth/credentials.js"
import { getAuthMode } from "../auth/index.js"

const health = new Hono()

health.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "liteai",
    auth: {
      mode: getAuthMode(),
      authenticated: getAuthStatus().authenticated,
    },
  }),
)

export { health }
