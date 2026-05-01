import { fromInts, parseHex, type RGBA } from "./color"

// Re-export for convenience
export type { RGBA }
export { parseHex, fromInts }

export const STALL_ERROR_RED: RGBA = { r: 171, g: 43, b: 63, a: 255 }
export const THINKING_DIM: RGBA = { r: 153, g: 153, b: 153, a: 255 }
export const THINKING_BRIGHT: RGBA = { r: 185, g: 185, b: 185, a: 255 }

/** Interpolate between two RGB colors. t=0→c1, t=1→c2 */
export function interpolateColor(c1: RGBA, c2: RGBA, t: number): RGBA {
  const clampedT = Math.max(0, Math.min(1, t))
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * clampedT),
    g: Math.round(c1.g + (c2.g - c1.g) * clampedT),
    b: Math.round(c1.b + (c2.b - c1.b) * clampedT),
    a: Math.round(c1.a + (c2.a - c1.a) * clampedT),
  }
}

/** Convert RGBA to Ink-compatible "rgb(r,g,b)" string */
export function toRGBString(color: RGBA): string {
  return `rgb(${color.r},${color.g},${color.b})`
}

const colorCache = new Map<string, RGBA>()

/** Parse theme hex color with cache for animation loop performance */
export function parseThemeColor(hex: string): RGBA {
  const cached = colorCache.get(hex)
  if (cached) return cached

  const parsed = parseHex(hex)
  colorCache.set(hex, parsed)
  return parsed
}
