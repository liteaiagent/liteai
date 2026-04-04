import { Instance } from "../project/instance"

export namespace Env {
  const state = Instance.state(() => {
    // Create a shallow copy to isolate environment per instance
    // Prevents parallel tests from interfering with each other's env vars
    return { ...process.env } as Record<string, string | undefined>
  })

  export function get(key: string) {
    try {
      const env = state()
      return env[key]
    } catch {
      return process.env[key]
    }
  }

  export function all() {
    try {
      return state()
    } catch {
      return { ...process.env } as Record<string, string | undefined>
    }
  }

  export function set(key: string, value: string) {
    try {
      const env = state()
      env[key] = value
    } catch {
      process.env[key] = value
    }
  }

  export function remove(key: string) {
    try {
      const env = state()
      delete env[key]
    } catch {
      delete process.env[key]
    }
  }
}
