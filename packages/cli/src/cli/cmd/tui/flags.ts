/**
 * CLI-specific feature flags.
 *
 * These flags control behavior that is exclusively a TUI/CLI concern
 * and should not live in `@liteai/core`.
 */

function env(key: string) {
  return process.env[`LITEAI_${key}`]
}

function truthy(key: string) {
  const value = env(key)?.toLowerCase()
  return value === "true" || value === "1"
}

/**
 * When `true`, disables automatic clipboard copy on text selection.
 * Instead, requires explicit Ctrl+C or right-click to copy.
 *
 * Default: `true` on Windows, `false` otherwise.
 *
 * Env: `LITEAI_DISABLE_COPY_ON_SELECT`
 */
const raw = env("DISABLE_COPY_ON_SELECT")
export const DISABLE_COPY_ON_SELECT =
  raw === undefined ? process.platform === "win32" : truthy("DISABLE_COPY_ON_SELECT")
