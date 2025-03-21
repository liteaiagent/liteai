/**
 * Environment variable expansion utility.
 * Supports `${VAR}` and `${VAR:-default}` syntax in string values.
 */

const PATTERN = /\$\{([^}:]+)(?::-((?:[^}\\]|\\.)*)?)?\}/g

/** Expand `${VAR}` and `${VAR:-default}` patterns in a string. */
export function expand(input: string): string {
  return input.replace(PATTERN, (_, name, fallback) => {
    const val = process.env[name]
    if (val !== undefined && val !== "") return val
    if (fallback !== undefined) return fallback.replace(/\\}/g, "}")
    return ""
  })
}

/** Recursively expand env vars in all string values of an object. */
export function expandDeep<T>(value: T): T {
  if (typeof value === "string") return expand(value) as T
  if (Array.isArray(value)) return value.map(expandDeep) as T
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = expandDeep(v)
    }
    return out as T
  }
  return value
}
