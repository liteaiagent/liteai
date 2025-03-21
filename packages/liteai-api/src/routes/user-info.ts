/**
 * User info route — GET /user_info
 *
 * Port of liteai/api/routes/user_info.py
 */

import { platform, release, userInfo } from "node:os"
import { Hono } from "hono"
import { getAuthMode, getUserEmail, getUserTier } from "../auth/index.js"
import { VALID_GEMINI_MODELS } from "../core/model-config.js"

const userInfoRoute = new Hono()

const APP_VERSION = "0.1.0"

function safeGetUser(): string {
  try {
    return userInfo().username
  } catch {
    return process.env.USERNAME || process.env.USER || "unknown"
  }
}

userInfoRoute.get("/user_info", (c) => {
  let mode: string
  try {
    mode = getAuthMode()
  } catch {
    mode = "unknown"
  }

  return c.json({
    service: "liteai",
    username: safeGetUser(),
    auth_mode: mode,
    user_email: getUserEmail(),
    tier: getUserTier(),
    version: APP_VERSION,
    node_version: process.version,
    os_platform: platform(),
    os_version: release(),
    models: [...VALID_GEMINI_MODELS].sort(),
  })
})

userInfoRoute.get("/user_info/", (c) => {
  return userInfoRoute.fetch(new Request(new URL("/user_info", c.req.url).toString()), c.env)
})

export { userInfoRoute }
