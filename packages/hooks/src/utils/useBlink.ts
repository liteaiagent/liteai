import type { AnimationPorts } from '../types.js'

const BLINK_INTERVAL_MS = 600

/**
 * Hook for synchronized blinking animations that pause when offscreen or blurred.
 *
 * @param enabled - Whether blinking is active
 * @param ports - AnimationPorts for platform-specific animation/focus
 * @param intervalMs - Blink interval in milliseconds
 * @returns [ref, isVisible] - Ref to attach to element, true when visible in blink cycle
 */
export function useBlink(
  enabled: boolean,
  ports: AnimationPorts,
  intervalMs = BLINK_INTERVAL_MS,
): [ref: (element: HTMLElement | null) => void, isVisible: boolean] {
  const focused = ports.useTerminalFocus()
  const [ref, time] = ports.useAnimationFrame(enabled && focused ? intervalMs : null)

  if (!enabled || !focused) return [ref, true]

  // Derive blink state from time - all instances see the same time so they sync
  const isVisible = Math.floor(time / intervalMs) % 2 === 0
  return [ref, isVisible]
}
