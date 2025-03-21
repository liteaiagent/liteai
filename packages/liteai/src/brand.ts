// Single source of truth for all config-derived identifiers.
// To rebrand, change only these values.

export namespace Brand {
  /** App identifier used for XDG sub-paths and branding */
  export const app = "liteai"

  /** Dot-prefixed home directory: ~/.<home> */
  export const home = `.${app}`

  /** Project-level config directory (dot-prefixed) */
  export const dir = `.${app}`

  /** Config file basename (without extension) */
  export const config = "settings"

  /** Environment variable prefix (uppercase, with trailing underscore) */
  export const env = `${app.toUpperCase()}_`

  /** HTTP header prefix */
  export const header = `x-${app}`

  /** Shell RC comment marker */
  export const marker = `# ${app}`

  /** Well-known path segment */
  export const wellknown = app

  /** Enterprise managed dir name */
  export const managed = app
}
