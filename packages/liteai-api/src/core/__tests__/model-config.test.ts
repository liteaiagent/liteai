import { describe, expect, it } from "bun:test"
import {
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  DEFAULT_GEMINI_MODEL,
  isGemini2Model,
  isGemini3Model,
  PREVIEW_GEMINI_FLASH_MODEL,
  PREVIEW_GEMINI_MODEL,
  resolveModel,
} from "../model-config.js"

// ── isGemini2Model ─────────────────────────────────────────────────────────

describe("isGemini2Model", () => {
  it("returns true for gemini-2.x models", () => {
    expect(isGemini2Model("gemini-2.5-pro")).toBe(true)
    expect(isGemini2Model("gemini-2.5-flash")).toBe(true)
    expect(isGemini2Model("gemini-2.5-flash-lite")).toBe(true)
    expect(isGemini2Model("gemini-2.0-flash")).toBe(true)
  })

  it("returns false for non-gemini-2 models", () => {
    expect(isGemini2Model("gemini-3-pro-preview")).toBe(false)
    expect(isGemini2Model("gemini-1.5-pro")).toBe(false)
    expect(isGemini2Model("gpt-4")).toBe(false)
  })
})

// ── isGemini3Model ─────────────────────────────────────────────────────────

describe("isGemini3Model", () => {
  it("returns true for gemini-3.x models", () => {
    expect(isGemini3Model("gemini-3-pro-preview")).toBe(true)
    expect(isGemini3Model("gemini-3-flash-preview")).toBe(true)
    expect(isGemini3Model("gemini-3.1-pro-preview")).toBe(true)
    expect(isGemini3Model("gemini-3.1-pro-preview-customtools")).toBe(true)
  })

  it("returns false for non-gemini-3 models", () => {
    expect(isGemini3Model("gemini-2.5-pro")).toBe(false)
    expect(isGemini3Model("gemini-1.5-pro")).toBe(false)
    expect(isGemini3Model("gpt-4")).toBe(false)
  })
})

// ── resolveModel ───────────────────────────────────────────────────────────

describe("resolveModel", () => {
  it("resolves 'auto' alias to a model", () => {
    const result = resolveModel("auto")
    expect(result).toBe(PREVIEW_GEMINI_MODEL)
  })

  it("resolves 'pro' alias", () => {
    expect(resolveModel("pro")).toBe(PREVIEW_GEMINI_MODEL)
  })

  it("resolves 'flash' alias", () => {
    expect(resolveModel("flash")).toBe(PREVIEW_GEMINI_FLASH_MODEL)
  })

  it("resolves 'flash-lite' alias", () => {
    expect(resolveModel("flash-lite")).toBe(DEFAULT_GEMINI_FLASH_LITE_MODEL)
  })

  it("returns unknown models as-is", () => {
    expect(resolveModel("gpt-4")).toBe("gpt-4")
    expect(resolveModel("custom-model")).toBe("custom-model")
  })

  it("resolves auto-gemini-2.5 alias", () => {
    expect(resolveModel("auto-gemini-2.5")).toBe(DEFAULT_GEMINI_MODEL)
  })
})
