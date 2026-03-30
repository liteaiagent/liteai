import type { HostCapabilities } from "./types"

/**
 * Global capabilities context.
 *
 * Set once at startup via `Capabilities.set()` and read everywhere via
 * `Capabilities.get()`. Unlike Instance context (which is per-request via
 * AsyncLocalStorage), capabilities are process-global because the mode
 * (local vs hosted) doesn't change during the server's lifetime.
 */

let current: HostCapabilities | undefined

export namespace Capabilities {
  /** Install the HostCapabilities implementation. Must be called once at startup. */
  export function set(capabilities: HostCapabilities) {
    if (current) {
      throw new Error("Capabilities already initialized — set() must be called exactly once")
    }
    current = capabilities
  }

  /** Get the active HostCapabilities. Throws if not yet initialized. */
  export function get(): HostCapabilities {
    if (!current) {
      throw new Error("Capabilities not initialized — call Capabilities.set() at startup")
    }
    return current
  }

  /** Whether capabilities have been initialized. */
  export function ready(): boolean {
    return current !== undefined
  }

  /** Whether running in hosted mode. Safe to call before init (returns false). */
  export function isHosted(): boolean {
    return current?.hosted ?? false
  }

  /**
   * Reset for testing. Not for production use.
   * @internal
   */
  export function reset() {
    current = undefined
  }
}
