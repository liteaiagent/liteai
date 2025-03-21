/**
 * Model configuration — mirrors gemini-cli-core/src/config/models.ts
 *
 * Port of liteai/core/model_config.py
 */

import { userSettings } from "./user-settings.js"

// ── Concrete Model Names ───────────────────────────────────────────────────

export const PREVIEW_GEMINI_MODEL = "gemini-3-pro-preview"
export const PREVIEW_GEMINI_3_1_MODEL = "gemini-3.1-pro-preview"
export const PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL = "gemini-3.1-pro-preview-customtools"
export const PREVIEW_GEMINI_FLASH_MODEL = "gemini-3-flash-preview"
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
export const DEFAULT_GEMINI_FLASH_MODEL = "gemini-2.5-flash"
export const DEFAULT_GEMINI_FLASH_LITE_MODEL = "gemini-2.5-flash-lite"

// ── Auto / Meta Models ─────────────────────────────────────────────────────

export const PREVIEW_GEMINI_MODEL_AUTO = "auto-gemini-3"
export const DEFAULT_GEMINI_MODEL_AUTO = "auto-gemini-2.5"

// ── User-Friendly Aliases ──────────────────────────────────────────────────

export const GEMINI_MODEL_ALIAS_AUTO = "auto"
export const GEMINI_MODEL_ALIAS_PRO = "pro"
export const GEMINI_MODEL_ALIAS_FLASH = "flash"
export const GEMINI_MODEL_ALIAS_FLASH_LITE = "flash-lite"

// ── Valid Models Set ────────────────────────────────────────────────────────

export const VALID_GEMINI_MODELS = new Set([
  PREVIEW_GEMINI_MODEL,
  PREVIEW_GEMINI_3_1_MODEL,
  PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL,
  PREVIEW_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
])

export const MODEL_ALIASES = new Set([
  GEMINI_MODEL_ALIAS_AUTO,
  GEMINI_MODEL_ALIAS_PRO,
  GEMINI_MODEL_ALIAS_FLASH,
  GEMINI_MODEL_ALIAS_FLASH_LITE,
  PREVIEW_GEMINI_MODEL_AUTO,
  DEFAULT_GEMINI_MODEL_AUTO,
])

// ── Built-in Alias Map ─────────────────────────────────────────────────────

const BUILTIN_ALIAS_MAP: Record<string, string> = {
  [PREVIEW_GEMINI_MODEL_AUTO]: PREVIEW_GEMINI_MODEL,
  [GEMINI_MODEL_ALIAS_AUTO]: PREVIEW_GEMINI_MODEL,
  [GEMINI_MODEL_ALIAS_PRO]: PREVIEW_GEMINI_MODEL,
  [DEFAULT_GEMINI_MODEL_AUTO]: DEFAULT_GEMINI_MODEL,
  [GEMINI_MODEL_ALIAS_FLASH]: PREVIEW_GEMINI_FLASH_MODEL,
  [GEMINI_MODEL_ALIAS_FLASH_LITE]: DEFAULT_GEMINI_FLASH_LITE_MODEL,
}

// ── Default Model ──────────────────────────────────────────────────────────

export const SERVER_DEFAULT_MODEL = DEFAULT_GEMINI_FLASH_MODEL

// ── Default Thinking Config ────────────────────────────────────────────────

export const DEFAULT_THINKING_BUDGET = 8192

// ── Helpers ────────────────────────────────────────────────────────────────

export function isGemini2Model(model: string): boolean {
  return model.startsWith("gemini-2")
}

export function isGemini3Model(model: string): boolean {
  return /^gemini-3(\.|-)?./.test(model)
}

function getEffectiveAliasMap(): Record<string, string> {
  const merged = { ...BUILTIN_ALIAS_MAP }
  if (userSettings.model.aliases) {
    Object.assign(merged, userSettings.model.aliases)
  }
  return merged
}

export function resolveModel(requestedModel: string): string {
  const aliasMap = getEffectiveAliasMap()
  return aliasMap[requestedModel] ?? requestedModel
}

export function getDefaultModel(): string {
  // Note: settings must be imported at call time to avoid circular import
  // The caller should pass settings.default_model if needed
  if (userSettings.model.default) {
    return resolveModel(userSettings.model.default)
  }
  return SERVER_DEFAULT_MODEL
}

export function getDisplayString(model: string): string {
  const displayMap: Record<string, string> = {
    [PREVIEW_GEMINI_MODEL_AUTO]: "Auto (Gemini 3)",
    [DEFAULT_GEMINI_MODEL_AUTO]: "Auto (Gemini 2.5)",
    [GEMINI_MODEL_ALIAS_PRO]: PREVIEW_GEMINI_MODEL,
    [GEMINI_MODEL_ALIAS_FLASH]: PREVIEW_GEMINI_FLASH_MODEL,
  }
  return displayMap[model] ?? model
}
