/**
 * User settings loaded from ~/.liteai/liteai.json.
 *
 * Port of liteai/core/user_settings.py
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

// ── Constants ──────────────────────────────────────────────────────────────

const LITEAI_DIR_NAME = ".liteai"
const SETTINGS_FILE_NAME = "liteai.json"

// ── Path helpers ───────────────────────────────────────────────────────────

export function getLiteaiDir(): string {
  return join(homedir(), LITEAI_DIR_NAME)
}

export function getSettingsFilePath(): string {
  return join(getLiteaiDir(), SETTINGS_FILE_NAME)
}

// ── Settings Schema ────────────────────────────────────────────────────────

export const ModelSettingsSchema = z.object({
  default: z.string().default(""),
  aliases: z.record(z.string()).default({}),
  thinking_budget: z.number().nullable().default(null),
  temperature: z.number().nullable().default(null),
})

export const ServerSettingsSchema = z.object({
  host: z.string().default(""),
  port: z.number().nullable().default(null),
})

export const UserSettingsFileSchema = z.object({
  model: ModelSettingsSchema.default({}),
  server: ServerSettingsSchema.default({}),
})

export type ModelSettings = z.infer<typeof ModelSettingsSchema>
export type ServerSettings = z.infer<typeof ServerSettingsSchema>
export type UserSettingsFile = z.infer<typeof UserSettingsFileSchema>

// ── Default file template ──────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  $schema: "https://lite-agent.dev/schemas/liteai.json",
  model: {
    default: "gemini-2.5-flash",
    aliases: {},
    thinking_budget: null,
    temperature: null,
  },
  server: {
    host: "0.0.0.0",
    port: 9000,
  },
}

// ── Loader ─────────────────────────────────────────────────────────────────

export function loadUserSettings(): UserSettingsFile {
  const path = getSettingsFilePath()

  if (!existsSync(path)) {
    console.info(`User settings file not found at ${path} — using defaults`)
    return UserSettingsFileSchema.parse({})
  }

  console.info(`Loading user settings from ${path}`)
  try {
    const raw = readFileSync(path, "utf-8")
    const data = JSON.parse(raw)
    if (typeof data !== "object" || data === null) {
      console.warn(`User settings at ${path} is not a JSON object — using defaults`)
      return UserSettingsFileSchema.parse({})
    }
    const settings = UserSettingsFileSchema.parse(data)
    console.info(
      `User settings loaded: model=${settings.model.default || "(default)"}, host=${settings.server.host || "(default)"}, port=${settings.server.port || "(default)"}`,
    )
    return settings
  } catch (exc) {
    console.warn(`Error reading user settings at ${path}: ${exc} — using defaults`)
    return UserSettingsFileSchema.parse({})
  }
}

export function ensureDefaultSettings(): string {
  const settingsDir = getLiteaiDir()
  const settingsFile = join(settingsDir, SETTINGS_FILE_NAME)

  if (existsSync(settingsFile)) {
    return settingsFile
  }

  console.info(`User settings file not found at ${settingsFile} — creating with defaults`)
  try {
    mkdirSync(settingsDir, { recursive: true })
    writeFileSync(settingsFile, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`, "utf-8")
    console.info(`Created default settings at ${settingsFile}`)
  } catch (exc) {
    console.warn(`Could not create default settings at ${settingsFile}: ${exc}`)
  }

  return settingsFile
}

// ── Singleton ──────────────────────────────────────────────────────────────

ensureDefaultSettings()
export let userSettings = loadUserSettings()

export function reloadUserSettings(): UserSettingsFile {
  userSettings = loadUserSettings()
  return userSettings
}
