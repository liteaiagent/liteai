import { describe, expect, it } from "bun:test"
import { contrast, fromInts, luminance, parseHex, tint, withAlpha } from "./color"

describe("color util", () => {
  it("should parse hex colors", () => {
    expect(parseHex("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(parseHex("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(parseHex("#ff000080")).toEqual({ r: 255, g: 0, b: 0, a: 128 })
  })

  it("should convert from ints", () => {
    expect(fromInts(255, 0, 0)).toBe("#ff0000ff")
    expect(fromInts(255, 0, 0, 128)).toBe("#ff000080")
  })

  it("should calculate luminance", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 5)
    expect(luminance("#000000")).toBeCloseTo(0, 5)
    // Relative luminance of #7f7f7f (~127/255)
    expect(luminance("#7f7f7f")).toBeGreaterThan(0.2)
    expect(luminance("#7f7f7f")).toBeLessThan(0.3)
  })

  it("should calculate contrast", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 1)
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 1)
  })

  it("should tint colors", () => {
    // Lighten
    expect(tint("#800000", 0.5)).toBe("#c08080ff")
    // Darken
    expect(tint("#800000", -0.5)).toBe("#400000ff")
  })

  it("should set alpha", () => {
    expect(withAlpha("#ff0000", 0.5)).toBe("#ff000080")
  })
})
