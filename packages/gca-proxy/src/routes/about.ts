/**
 * About route — GET /v1/about
 *
 * Port of liteai/api/routes/about.py
 */

import { platform, release, userInfo } from "node:os"
import { Hono } from "hono"
import { getAuthMode, getUserEmail, getUserTier } from "../auth/index.js"
import { settings } from "../core/config.js"

const about = new Hono()

const APP_VERSION = "0.1.0"

function safeGetUser(): string {
  try {
    return userInfo().username
  } catch {
    return process.env.USERNAME || process.env.USER || "unknown"
  }
}

about.get("/about", (c) => {
  let authMode: string
  try {
    authMode = getAuthMode()
  } catch {
    authMode = "unknown"
  }

  return c.json({
    username: safeGetUser(),
    user_email: getUserEmail(),
    tier: getUserTier(),
    version: APP_VERSION,
    node_version: process.version,
    os_platform: platform(),
    os_version: release(),
    default_model: settings.default_model || "auto",
    auth_mode: authMode,
    tools_enabled: false,
    tracing_enabled: false,
    mcp_servers: [],
  })
})

about.get("/about/", (c) => {
  // redirect to canonical
  return about.fetch(new Request(new URL("/v1/about", c.req.url).toString()), c.env)
})

export { about }
