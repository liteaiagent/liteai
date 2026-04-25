/**
 * Hex-string color utilities.
 *
 * Supports #RGB, #RRGGBB, and #RRGGBBAA formats.
 * All functions operate on strings to avoid complex color classes.
 */

export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

/**
 * Parses a hex string into RGBA components (0-255).
 */
export function parseHex(hex: string): RGBA {
  const rgbMatch = hex.match(/rgb:(.+)/)
  if (rgbMatch) {
    const parts = rgbMatch[1]?.split("/")
    if (parts.length === 3) {
      const parsePart = (p: string) => {
        if (!p) return 0
        if (p.length === 1) return Number.parseInt(p + p, 16)
        if (p.length === 2) return Number.parseInt(p, 16)
        return Math.round((Number.parseInt(p.slice(0, 4).padEnd(4, "0"), 16) / 65535) * 255)
      }
      return {
        r: parsePart(parts[0] || ""),
        g: parsePart(parts[1] || ""),
        b: parsePart(parts[2] || ""),
        a: 255,
      }
    }
  }

  const cleanHex = hex.replace("#", "")

  let r = 0
  let g = 0
  let b = 0
  let a = 255

  if (cleanHex.length === 3) {
    r = Number.parseInt(cleanHex.charAt(0) + cleanHex.charAt(0), 16)
    g = Number.parseInt(cleanHex.charAt(1) + cleanHex.charAt(1), 16)
    b = Number.parseInt(cleanHex.charAt(2) + cleanHex.charAt(2), 16)
  } else if (cleanHex.length === 6) {
    r = Number.parseInt(cleanHex.slice(0, 2), 16)
    g = Number.parseInt(cleanHex.slice(2, 4), 16)
    b = Number.parseInt(cleanHex.slice(4, 6), 16)
  } else if (cleanHex.length === 8) {
    r = Number.parseInt(cleanHex.slice(0, 2), 16)
    g = Number.parseInt(cleanHex.slice(2, 4), 16)
    b = Number.parseInt(cleanHex.slice(4, 6), 16)
    a = Number.parseInt(cleanHex.slice(6, 8), 16)
  } else {
    throw new Error(`Invalid hex color: ${hex}`)
  }

  return { r, g, b, a }
}

/**
 * Converts RGBA components to a hex string (#RRGGBBAA).
 */
export function fromInts(r: number, g: number, b: number, a = 255): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`
}

/**
 * Calculates relative luminance (sRGB) of a color.
 * Returns a value between 0 (darkest) and 1 (lightest).
 */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex)

  const normalize = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * normalize(r) + 0.7152 * normalize(g) + 0.0722 * normalize(b)
}

/**
 * Calculates the contrast ratio between two colors.
 * Returns a value between 1 and 21.
 */
export function contrast(hex1: string, hex2: string): number {
  const l1 = luminance(hex1)
  const l2 = luminance(hex2)

  const brightest = Math.max(l1, l2)
  const darkest = Math.min(l1, l2)

  return (brightest + 0.05) / (darkest + 0.05)
}

/**
 * Tints a color by a given amount (-1 to 1).
 * Positive amount lightens, negative amount darkens.
 */
export function tint(hex: string, amount: number): string {
  const { r, g, b, a } = parseHex(hex)

  const apply = (c: number) => {
    if (amount > 0) {
      return Math.round(c + (255 - c) * amount)
    }
    return Math.round(c + c * amount)
  }

  return fromInts(apply(r), apply(g), apply(b), a)
}

/**
 * Returns a new hex string with the specified alpha value (0-1).
 */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex)
  return fromInts(r, g, b, Math.round(alpha * 255))
}
