/**
 * Settings route — GET/PATCH/POST /v1/settings
 *
 * Port of liteai/api/routes/settings.py
 */

import { readFileSync, writeFileSync } from "node:fs"
import { Hono } from "hono"
import { settings } from "../core/config.js"
import { createLogger } from "../core/logger.js"
import { getSettingsFilePath, reloadUserSettings, userSettings } from "../core/user-settings.js"

const logger = createLogger("routes.settings")
const settingsRoute = new Hono()

// ── In-memory runtime overrides ────────────────────────────────────────────

const runtimeOverrides: Record<string, unknown> = {}

function effective(key: string, fallback: unknown): unknown {
  if (key in runtimeOverrides) return runtimeOverrides[key]
  return fallback
}

function buildSettingsResponse(): Record<string, unknown> {
  return {
    default_model: effective("default_model", userSettings.model.default) || settings.default_model || "",
    temperature: effective("temperature", userSettings.model.temperature),
    thinking_budget: effective("thinking_budget", userSettings.model.thinking_budget),
    top_p: effective("top_p", null),
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

settingsRoute.get("/settings", (c) => c.json(buildSettingsResponse()))
settingsRoute.get("/settings/", (c) => c.json(buildSettingsResponse()))

settingsRoute.patch("/settings", async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>
  const updates: Record<string, unknown> = {}
  const resets: string[] = []

  const settingsAttrMap: Record<string, string> = {
    temperature: "temperature",
    thinking_budget: "thinking_budget",
    default_model: "default_model",
  }

  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined) {
      delete runtimeOverrides[key]
      resets.push(key)
      // Reset static setting to file default
      const attr = settingsAttrMap[key]
      if (attr && attr in settings) {
        const fileDefault =
          key === "default_model"
            ? userSettings.model.default
            : ((userSettings.model as Record<string, unknown>)[key] ?? null)
        ;(settings as unknown as Record<string, unknown>)[attr] = fileDefault
      }
    } else {
      runtimeOverrides[key] = value
      updates[key] = value
      // Also update the static settings singleton
      const attr = settingsAttrMap[key]
      if (attr && attr in settings) {
        ;(settings as unknown as Record<string, unknown>)[attr] = value
      }
    }
  }

  return c.json({ updated: updates, reset: resets, status: "ok" })
})

settingsRoute.patch("/settings/", async (c) => {
  // Forward to canonical
  return settingsRoute.fetch(
    new Request(new URL("/v1/settings", c.req.url).toString(), {
      method: "PATCH",
      headers: c.req.raw.headers,
      body: c.req.raw.body,
    }),
    c.env,
  )
})

settingsRoute.post("/settings/save", async (c) => {
  const path = getSettingsFilePath()
  let data: Record<string, unknown>

  try {
    data = JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    data = {}
  }

  const modelSection = (data.model as Record<string, unknown>) || {}
  for (const key of ["default_model", "temperature", "thinking_budget"]) {
    if (key in runtimeOverrides) {
      const fileKey = key === "default_model" ? "default" : key
      modelSection[fileKey] = runtimeOverrides[key]
    }
  }
  data.model = modelSection

  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8")
  logger.info(`Settings saved to ${path}`)
  return c.json({ status: "ok", message: `Settings saved to ${path}` })
})

settingsRoute.post("/settings/reload", (c) => {
  reloadUserSettings()
  // Clear runtime overrides
  for (const key of Object.keys(runtimeOverrides)) {
    delete runtimeOverrides[key]
  }
  return c.json(buildSettingsResponse())
})

export { settingsRoute }
