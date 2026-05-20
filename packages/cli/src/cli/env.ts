/**
 * Lightweight environment variable helpers for CLI.
 *
 * Replaces the previous import of `Flag` from `@liteai/core/flag/flag` which
 * was a thin `process.env` reader that pulled in core as a transitive dependency.
 * CLI runs locally and only needs a handful of flags — reading them directly
 * avoids the core coupling entirely.
 */

const PREFIX = "LITEAI_"

function env(key: string): string | undefined {
  return process.env[`${PREFIX}${key}`]
}

const TRUTHY_TOKENS: ReadonlySet<string> = new Set(["true", "1", "yes", "y", "on"])

function truthy(key: string): boolean {
  const value = env(key)?.toLowerCase()
  return value !== undefined && TRUTHY_TOKENS.has(value)
}

export namespace Env {
  export const AUTO_SHARE = truthy("AUTO_SHARE")
  export const GIT_BASH_PATH = env("GIT_BASH_PATH")
  export const SERVER_PASSWORD = env("SERVER_PASSWORD")
  export const SERVER_USERNAME = env("SERVER_USERNAME")

  // Dynamic getters — must be evaluated at access time, not module load time,
  // because external tooling or CLI middleware may set these env vars at runtime.
  export declare const TUI_CONFIG: string | undefined
  export declare const CONFIG_DIR: string | undefined
}

Object.defineProperty(Env, "TUI_CONFIG", {
  get() {
    return env("TUI_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

Object.defineProperty(Env, "CONFIG_DIR", {
  get() {
    return env("CONFIG_DIR")
  },
  enumerable: true,
  configurable: false,
})
