import { Brand } from "../brand"

function env(key: string) {
  return process.env[`${Brand.env}${key}`]
}

function truthy(key: string) {
  const value = env(key)?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = env(key)?.toLowerCase()
  return value === "false" || value === "0"
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
  export const LITEAI_DISABLE_AUTOUPDATE = truthy("DISABLE_AUTOUPDATE")
  export const LITEAI_DISABLE_PRUNE = truthy("DISABLE_PRUNE")
  export const LITEAI_DISABLE_TERMINAL_TITLE = truthy("DISABLE_TERMINAL_TITLE")
  export const LITEAI_PERMISSION = env("PERMISSION")
  export const LITEAI_DISABLE_DEFAULT_PLUGINS = truthy("DISABLE_DEFAULT_PLUGINS")
  export const LITEAI_DISABLE_LSP_DOWNLOAD = truthy("DISABLE_LSP_DOWNLOAD")
  export const LITEAI_ENABLE_EXPERIMENTAL_MODELS = truthy("ENABLE_EXPERIMENTAL_MODELS")
  export const LITEAI_DISABLE_AUTOCOMPACT = truthy("DISABLE_AUTOCOMPACT")
  export const LITEAI_DISABLE_MODELS_FETCH = truthy("DISABLE_MODELS_FETCH")
  export const LITEAI_ENABLE_CLAUDE_CODE = truthy("ENABLE_CLAUDE_CODE")
  export const LITEAI_DISABLE_CLAUDE_CODE_PROMPT = !LITEAI_ENABLE_CLAUDE_CODE || truthy("DISABLE_CLAUDE_CODE_PROMPT")
  export const LITEAI_DISABLE_CLAUDE_CODE_SKILLS = !LITEAI_ENABLE_CLAUDE_CODE || truthy("DISABLE_CLAUDE_CODE_SKILLS")
  export const LITEAI_DISABLE_EXTERNAL_SKILLS = LITEAI_DISABLE_CLAUDE_CODE_SKILLS || truthy("DISABLE_EXTERNAL_SKILLS")
  export declare const LITEAI_DISABLE_EXTERNAL_AGENTS: boolean
  export declare const LITEAI_DISABLE_PROJECT_CONFIG: boolean
  export const LITEAI_FAKE_VCS = env("FAKE_VCS")
  export declare const LITEAI_CLIENT: string
  export const LITEAI_SERVER_PASSWORD = env("SERVER_PASSWORD")
  export const LITEAI_SERVER_USERNAME = env("SERVER_USERNAME")
  export const LITEAI_ENABLE_QUESTION_TOOL = truthy("ENABLE_QUESTION_TOOL")

  // Experimental
  export const LITEAI_EXPERIMENTAL = truthy("EXPERIMENTAL")
  export const LITEAI_EXPERIMENTAL_FILEWATCHER = truthy("EXPERIMENTAL_FILEWATCHER")
  export const LITEAI_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const LITEAI_EXPERIMENTAL_ICON_DISCOVERY = LITEAI_EXPERIMENTAL || truthy("EXPERIMENTAL_ICON_DISCOVERY")

  const copy = env("EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const LITEAI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const LITEAI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const LITEAI_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const LITEAI_EXPERIMENTAL_OXFMT = LITEAI_EXPERIMENTAL || truthy("EXPERIMENTAL_OXFMT")
  export const LITEAI_EXPERIMENTAL_LSP_TY = truthy("EXPERIMENTAL_LSP_TY")
  export const LITEAI_DISABLE_FILETIME_CHECK = truthy("DISABLE_FILETIME_CHECK")
  export const LITEAI_EXPERIMENTAL_PLAN_MODE = LITEAI_EXPERIMENTAL || truthy("EXPERIMENTAL_PLAN_MODE")
  export const LITEAI_EXPERIMENTAL_WORKSPACES = LITEAI_EXPERIMENTAL || truthy("EXPERIMENTAL_WORKSPACES")
  export const LITEAI_EXPERIMENTAL_MARKDOWN = !falsy("EXPERIMENTAL_MARKDOWN")
  export const LITEAI_MODELS_URL = env("MODELS_URL")
  export const LITEAI_MODELS_PATH = env("MODELS_PATH")
  export const LITEAI_DISABLE_CHANNEL_DB = truthy("DISABLE_CHANNEL_DB")
  export const LITEAI_SKIP_MIGRATIONS = truthy("SKIP_MIGRATIONS")

  export const LITEAI_HOME = env("HOME")
  export const LITEAI_MODEL = env("MODEL")
  export const LITEAI_PROVIDER = env("PROVIDER")

  /** Plugin directories (repeatable, comma-separated). Set at runtime via `--plugin-dir`. */
  export declare const LITEAI_PLUGIN_DIR: string[] | undefined
}

Object.defineProperty(Flag, "LITEAI_DISABLE_EXTERNAL_AGENTS", {
  get() {
    return !truthy("ENABLE_CLAUDE_CODE") || truthy("DISABLE_EXTERNAL_AGENTS")
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
