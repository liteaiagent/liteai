import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { createLogger, getLogLevel, getRequestId, type LogLevel, setLogLevel, withRequestId } from "../logger.js"

// ── Log Level Filtering ────────────────────────────────────────────────────

describe("log level filtering", () => {
  let originalLevel: LogLevel

  beforeEach(() => {
    originalLevel = getLogLevel()
  })

  afterEach(() => {
    setLogLevel(originalLevel)
  })

  it("getLogLevel returns current level", () => {
    setLogLevel("WARN")
    expect(getLogLevel()).toBe("WARN")
  })

  it("setLogLevel changes the level", () => {
    setLogLevel("ERROR")
    expect(getLogLevel()).toBe("ERROR")
  })

  it("DEBUG messages are suppressed at INFO level", () => {
    setLogLevel("INFO")
    const spy = spyOn(console, "debug").mockImplementation(() => {})
    const logger = createLogger("test")
    logger.debug("hidden message")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it("INFO messages show at INFO level", () => {
    setLogLevel("INFO")
    const spy = spyOn(console, "info").mockImplementation(() => {})
    const logger = createLogger("test")
    logger.info("visible message")
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it("TRACE messages are suppressed at DEBUG level", () => {
    setLogLevel("DEBUG")
    const spy = spyOn(console, "debug").mockImplementation(() => {})
    const logger = createLogger("test")
    logger.trace("hidden trace")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it("TRACE messages show at TRACE level", () => {
    setLogLevel("TRACE")
    const spy = spyOn(console, "debug").mockImplementation(() => {})
    const logger = createLogger("test")
    logger.trace("visible trace")
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it("ERROR messages always show", () => {
    setLogLevel("ERROR")
    const spy = spyOn(console, "error").mockImplementation(() => {})
    const logger = createLogger("test")
    logger.error("error message")
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})

// ── Structured Metadata ────────────────────────────────────────────────────

describe("structured metadata", () => {
  it("includes key=value metadata in output", () => {
    setLogLevel("DEBUG")
    const spy = spyOn(console, "debug").mockImplementation(() => {})
    const logger = createLogger("test")
    logger.debug("with meta", { model: "gemini-2.5-pro", latencyMs: 123 })

    const output = spy.mock.calls[0]?.[0] as string
    expect(output).toContain("model=gemini-2.5-pro")
    expect(output).toContain("latencyMs=123")

    spy.mockRestore()
    setLogLevel("INFO")
  })

  it("works without metadata (backwards compatible)", () => {
    setLogLevel("DEBUG")
    const spy = spyOn(console, "debug").mockImplementation(() => {})
    const logger = createLogger("test")
    logger.debug("no meta")

    const output = spy.mock.calls[0]?.[0] as string
    expect(output).toContain("no meta")

    spy.mockRestore()
    setLogLevel("INFO")
  })
})

// ── Request Correlation ────────────────────────────────────────────────────

describe("request correlation IDs", () => {
  it("getRequestId returns undefined outside withRequestId", () => {
    expect(getRequestId()).toBeUndefined()
  })

  it("withRequestId provides requestId to sync callbacks", () => {
    const captured = withRequestId("req-123", () => {
      return getRequestId()
    })

    expect(captured).toBe("req-123")
  })

  it("withRequestId provides requestId to async callbacks", async () => {
    const captured = await withRequestId("req-456", async () => {
      await Promise.resolve()
      return getRequestId()
    })

    expect(captured).toBe("req-456")
  })

  it("includes requestId in log output", () => {
    setLogLevel("INFO")
    const spy = spyOn(console, "info").mockImplementation(() => {})
    const logger = createLogger("test")

    withRequestId("abc12345", () => {
      logger.info("test message")
    })

    const output = spy.mock.calls[0]?.[0] as string
    expect(output).toContain("[abc12345]")

    spy.mockRestore()
  })
})

// ── Logger Name ────────────────────────────────────────────────────────────

describe("logger name", () => {
  it("includes logger name in output", () => {
    setLogLevel("INFO")
    const spy = spyOn(console, "info").mockImplementation(() => {})
    const logger = createLogger("my.module")
    logger.info("test")

    const output = spy.mock.calls[0]?.[0] as string
    expect(output).toContain("my.module")

    spy.mockRestore()
  })
})
