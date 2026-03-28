import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { detectAuthMode } from "../detection.js"

// ── Auth Detection ─────────────────────────────────────────────────────────

describe("detectAuthMode", () => {
  const envBackup: Record<string, string | undefined> = {}
  const envKeys = [
    "GOOGLE_GENAI_USE_GCA",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GEMINI_API_KEY",
    "CLOUD_SHELL",
    "GEMINI_CLI_USE_COMPUTE_ADC",
  ]

  beforeEach(() => {
    for (const key of envKeys) {
      envBackup[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (envBackup[key] !== undefined) {
        process.env[key] = envBackup[key]
      } else {
        delete process.env[key]
      }
    }
  })

  it("detects oauth when GOOGLE_GENAI_USE_GCA=true", () => {
    process.env.GOOGLE_GENAI_USE_GCA = "true"
    expect(detectAuthMode()).toBe("oauth")
  })

  it("detects vertex-ai when GOOGLE_GENAI_USE_VERTEXAI=true", () => {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = "true"
    expect(detectAuthMode()).toBe("vertex-ai")
  })

  it("detects api-key when GEMINI_API_KEY is set", () => {
    process.env.GEMINI_API_KEY = "test-key-123"
    expect(detectAuthMode()).toBe("api-key")
  })

  it("detects compute-adc when CLOUD_SHELL=true", () => {
    process.env.CLOUD_SHELL = "true"
    expect(detectAuthMode()).toBe("compute-adc")
  })

  it("detects compute-adc when GEMINI_CLI_USE_COMPUTE_ADC=true", () => {
    process.env.GEMINI_CLI_USE_COMPUTE_ADC = "true"
    expect(detectAuthMode()).toBe("compute-adc")
  })

  it("defaults to oauth when nothing is set", () => {
    const mode = detectAuthMode()
    expect(mode).toBe("oauth")
    // Side-effect: sets GOOGLE_GENAI_USE_GCA=true
    expect(process.env.GOOGLE_GENAI_USE_GCA).toBe("true")
  })

  it("GCA takes priority over vertex-ai", () => {
    process.env.GOOGLE_GENAI_USE_GCA = "true"
    process.env.GOOGLE_GENAI_USE_VERTEXAI = "true"
    expect(detectAuthMode()).toBe("oauth")
  })

  it("vertex-ai takes priority over api-key", () => {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = "true"
    process.env.GEMINI_API_KEY = "test-key"
    expect(detectAuthMode()).toBe("vertex-ai")
  })

  it("api-key takes priority over compute-adc", () => {
    process.env.GEMINI_API_KEY = "test-key"
    process.env.CLOUD_SHELL = "true"
    expect(detectAuthMode()).toBe("api-key")
  })
})
