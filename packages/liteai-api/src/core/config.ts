/**
 * Application settings backed by env vars and user settings file.
 *
 * Port of liteai/core/config.py
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { API_PUBLIC_KEY } from "../keys/index.js"
import { userSettings } from "./user-settings.js"

// ── Helper ─────────────────────────────────────────────────────────────────

function envOr(envKey: string, fallback: string): string {
  return process.env[envKey] || fallback
}

function envOrNull(envKey: string): string | null {
  return process.env[envKey] || null
}

function envInt(envKey: string, fallback: number): number {
  const val = process.env[envKey]
  if (val) {
    const parsed = parseInt(val, 10)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

function envFloat(envKey: string): number | null {
  const val = process.env[envKey]
  if (val) {
    const parsed = parseFloat(val)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

// ── JWT Public Key Loader ──────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadPublicKey(service: string): string {
  // 1. Env var
  const envVar = `JWT_PUBLIC_KEY_${service.toUpperCase()}`
  const envVal = process.env[envVar] || ""
  if (envVal) return envVal

  // 2. Embedded constant (works inside standalone executables)
  if (API_PUBLIC_KEY) return API_PUBLIC_KEY

  // 3. PEM file on disk (dev fallback) — look relative to this module
  const keyPath = join(__dirname, "..", "keys", `${service}_public.pem`)
  if (existsSync(keyPath)) {
    return readFileSync(keyPath, "utf-8").trim()
  }

  return ""
}

// ── Settings Interface ─────────────────────────────────────────────────────

export interface Settings {
  // Server
  host: string
  port: number

  // Logging
  log_level: string

  // Auth / GenAI
  gemini_api_key: string
  google_api_key: string
  google_genai_use_gca: string
  google_genai_use_vertexai: string
  google_cloud_project: string | null
  google_cloud_project_id: string | null
  google_cloud_location: string
  /** API version override (e.g. "v1", "v1alpha") */
  google_genai_api_version: string
  /** Auth mechanism: 'x-goog-api-key' (default) or 'bearer' */
  api_key_auth_mechanism: "x-goog-api-key" | "bearer"
  /** JSON map of custom headers (e.g. '{"x-custom": "val"}') */
  custom_headers: string
  /** HTTP/HTTPS proxy URL */
  http_proxy: string | null

  // Code Assist
  code_assist_endpoint: string
  code_assist_api_version: string
  gemini_cli_config_dir: string

  // Client Auth (RS256 JWT)
  jwt_public_key: string

  // Model
  default_model: string
  thinking_budget: number | null
  temperature: number | null

  // Billing
  overage_strategy: "ask" | "always" | "never"
}

// ── Build Settings ─────────────────────────────────────────────────────────

function buildSettings(overrides?: Partial<Settings>): Settings {
  const base: Settings = {
    // Server
    host: envOr("HOST", userSettings.server.host || "0.0.0.0"),
    port: envInt("PORT", userSettings.server.port || 9000),

    // Logging
    log_level: envOr("LOG_LEVEL", "INFO"),

    // Auth / GenAI
    gemini_api_key: envOr("GEMINI_API_KEY", ""),
    google_api_key: envOr("GOOGLE_API_KEY", ""),
    google_genai_use_gca: envOr("GOOGLE_GENAI_USE_GCA", ""),
    google_genai_use_vertexai: envOr("GOOGLE_GENAI_USE_VERTEXAI", ""),
    google_cloud_project: envOrNull("GOOGLE_CLOUD_PROJECT"),
    google_cloud_project_id: envOrNull("GOOGLE_CLOUD_PROJECT_ID"),
    google_cloud_location: envOr("GOOGLE_CLOUD_LOCATION", "us-central1"),
    google_genai_api_version: envOr("GOOGLE_GENAI_API_VERSION", ""),
    api_key_auth_mechanism: envOr("GEMINI_API_KEY_AUTH_MECHANISM", "x-goog-api-key") as "x-goog-api-key" | "bearer",
    custom_headers: envOr("GEMINI_CLI_CUSTOM_HEADERS", ""),
    http_proxy: envOrNull("HTTPS_PROXY") ?? envOrNull("HTTP_PROXY"),

    // Code Assist
    code_assist_endpoint: envOr("CODE_ASSIST_ENDPOINT", "https://cloudcode-pa.googleapis.com"),
    code_assist_api_version: envOr("CODE_ASSIST_API_VERSION", "v1internal"),
    gemini_cli_config_dir: envOr("GEMINI_CLI_CONFIG_DIR", ""),

    // Client Auth
    jwt_public_key: loadPublicKey("api"),

    // Model
    default_model: envOr("DEFAULT_MODEL", userSettings.model.default || ""),
    thinking_budget: envFloat("THINKING_BUDGET") ?? userSettings.model.thinking_budget,
    temperature: envFloat("TEMPERATURE") ?? userSettings.model.temperature,

    // Billing
    overage_strategy: envOr("OVERAGE_STRATEGY", "never") as "ask" | "always" | "never",
  }

  if (overrides) {
    return { ...base, ...overrides }
  }
  return base
}

// ── Singleton ──────────────────────────────────────────────────────────────

export const settings: Settings = buildSettings()
