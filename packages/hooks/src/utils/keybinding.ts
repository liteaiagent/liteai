import type { KeybindingPorts } from '../types.js'

/**
 * Platform-agnostic shell for useKeybinding hook.
 * Dispatches to the injected KeybindingPorts implementation.
 */
export function useKeybinding(
  ports: KeybindingPorts,
  action: string,
  handler: () => void | false | Promise<void>,
  options?: { context?: string; isActive?: boolean },
): void {
  ports.useKeybinding(action, handler, options)
}

/**
 * Platform-agnostic shell for useKeybindings hook.
 * Dispatches to the injected KeybindingPorts implementation.
 */
export function useKeybindings(
  ports: KeybindingPorts,
  handlers: Record<string, () => void | false | Promise<void>>,
  options?: { context?: string; isActive?: boolean },
): void {
  ports.useKeybindings(handlers, options)
}
