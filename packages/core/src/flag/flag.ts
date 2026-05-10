import { Brand } from "../brand"

function env(key: string) {
  return process.env[`${Brand.env}${key}`]
}

function truthy(key: string) {
  const value = env(key)?.toLowerCase()
  return value === "true" || value === "1"
}

function number(key: string) {
  const value = env(key)
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

export namespace Flag {
  export const LITEAI_AUTO_SHARE = truthy("AUTO_SHARE")
  export const LITEAI_GIT_BASH_PATH = env("GIT_BASH_PATH")
  export const LITEAI_CONFIG = env("CONFIG")
  export declare const LITEAI_TUI_CONFIG: string | undefined
  export declare const LITEAI_CONFIG_DIR: string | undefined
  export const LITEAI_CONFIG_CONTENT = env("CONFIG_CONTENT")
  export const LITEAI_DISABLE_PRUNE = truthy("DISABLE_PRUNE")
  export const LITEAI_DISABLE_TERMINAL_TITLE = truthy("DISABLE_TERMINAL_TITLE")
  export const LITEAI_PERMISSION = env("PERMISSION")
  export const LITEAI_DISABLE_LSP_DOWNLOAD = truthy("DISABLE_LSP_DOWNLOAD")
  export const LITEAI_ENABLE_ALPHA_MODELS = truthy("ENABLE_ALPHA_MODELS")
  export const LITEAI_DISABLE_AUTOCOMPACT = truthy("DISABLE_AUTOCOMPACT")
  export const LITEAI_COMPACTION_BUFFER_TOKENS = number("COMPACTION_BUFFER_TOKENS")
  export const LITEAI_PRUNE_MINIMUM_TOKENS = number("PRUNE_MINIMUM_TOKENS")
  export const LITEAI_PRUNE_PROTECT_TOKENS = number("PRUNE_PROTECT_TOKENS")
  export const LITEAI_DISABLE_MODELS_FETCH = truthy("DISABLE_MODELS_FETCH")
  /**
   * Active external coding-agent platform whose directory conventions
   * should be scanned (e.g., "claude", "gemini", "codex").
   * When unset / "none", only the neutral `.agents/` dirs are used.
   */
  export declare const LITEAI_PLATFORM: string | undefined
  export const LITEAI_DISABLE_SKILLS = truthy("DISABLE_SKILLS")
  export const LITEAI_INJECT_SKILLS_IN_SYSTEM_PROMPT = truthy("INJECT_SKILLS_IN_SYSTEM_PROMPT")
  export declare const LITEAI_DISABLE_AGENTS: boolean
  export declare const LITEAI_DISABLE_PROJECT_CONFIG: boolean
  export declare const LITEAI_FORK_SUBAGENT: boolean
  export declare const LITEAI_COORDINATOR_MODE: boolean
  export declare const LITEAI_CLIENT: string
  export const LITEAI_SERVER_PASSWORD = env("SERVER_PASSWORD")
  export const LITEAI_SERVER_USERNAME = env("SERVER_USERNAME")
  export const LITEAI_SERVER_CSRF_TOKEN = env("SERVER_CSRF_TOKEN")

  // Experimental
  export const LITEAI_DISABLE_FILEWATCHER = truthy("DISABLE_FILEWATCHER")

  export const LITEAI_BASH_TIMEOUT_MS = number("BASH_TIMEOUT_MS")
  export const LITEAI_OUTPUT_TOKEN_MAX = number("OUTPUT_TOKEN_MAX")
  export const LITEAI_DISABLE_FILETIME_CHECK = truthy("DISABLE_FILETIME_CHECK")
  export const LITEAI_MODELS_URL = env("MODELS_URL")

  // Configuration Overrides
  export const LITEAI_HOME = env("HOME")
  export const LITEAI_MODEL = env("MODEL")
  export const LITEAI_PROVIDER = env("PROVIDER")

  /** Plugin directories (repeatable, comma-separated). Set at runtime via `--plugin-dir`. */
  export declare const LITEAI_PLUGIN_DIR: string[] | undefined

  // DB Testing
  export const LITEAI_DB_MEMORY = truthy("DB_MEMORY")
  export const LITEAI_DISABLE_CHANNEL_DB = truthy("DISABLE_CHANNEL_DB")
  export const LITEAI_SKIP_MIGRATIONS = truthy("SKIP_MIGRATIONS")

  // General Testing
  export const LITEAI_FAKE_VCS = env("FAKE_VCS")
  export const LITEAI_MODELS_PATH = env("MODELS_PATH")
}

Object.defineProperty(Flag, "LITEAI_DISABLE_AGENTS", {
  get() {
    return truthy("DISABLE_AGENTS")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for LITEAI_PLATFORM
Object.defineProperty(Flag, "LITEAI_PLATFORM", {
  get() {
    return env("PLATFORM")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for LITEAI_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "LITEAI_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for LITEAI_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "LITEAI_TUI_CONFIG", {
  get() {
    return env("TUI_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for LITEAI_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "LITEAI_CONFIG_DIR", {
  get() {
    return env("CONFIG_DIR")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for LITEAI_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "LITEAI_CLIENT", {
  get() {
    return env("CLIENT") ?? "cli"
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for LITEAI_PLUGIN_DIR
// Evaluated at access time so --plugin-dir CLI can set it at runtime.
// Supports comma-separated values and filters empty strings.
Object.defineProperty(Flag, "LITEAI_PLUGIN_DIR", {
  get() {
    const val = env("PLUGIN_DIR")
    if (!val) return undefined
    const dirs = val
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
    return dirs.length ? dirs : undefined
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for LITEAI_FORK_SUBAGENT
Object.defineProperty(Flag, "LITEAI_FORK_SUBAGENT", {
  get() {
    return truthy("FORK_SUBAGENT")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for LITEAI_COORDINATOR_MODE
Object.defineProperty(Flag, "LITEAI_COORDINATOR_MODE", {
  get() {
    return truthy("COORDINATOR_MODE")
  },
  enumerable: true,
  configurable: false,
})
