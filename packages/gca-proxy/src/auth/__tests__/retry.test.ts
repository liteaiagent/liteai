import { describe, expect, it, mock } from "bun:test"
import {
  isRetryableStatus,
  ProjectPermissionError,
  parseRetryDelayFrom429,
  raiseIfPermissionDenied,
  retryWithBackoff,
  TerminalQuotaError,
} from "../retry.js"

// ── isRetryableStatus ──────────────────────────────────────────────────────

describe("isRetryableStatus", () => {
  it("returns true for 429", () => {
    expect(isRetryableStatus(429)).toBe(true)
  })

  it("returns true for 500-599", () => {
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
    expect(isRetryableStatus(599)).toBe(true)
  })

  it("returns false for other codes", () => {
    expect(isRetryableStatus(200)).toBe(false)
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(401)).toBe(false)
    expect(isRetryableStatus(404)).toBe(false)
  })
})

// ── parseRetryDelayFrom429 ─────────────────────────────────────────────────

describe("parseRetryDelayFrom429", () => {
  it("returns null when no error field", () => {
    expect(parseRetryDelayFrom429({})).toBeNull()
  })

  it("parses 'reset after Xs' from message", () => {
    const result = parseRetryDelayFrom429({
      error: {
        message: "Rate limit exceeded, reset after 30s",
        details: [],
      },
    })
    expect(result).toBe(30)
  })

  it("parses RetryInfo from details", () => {
    const result = parseRetryDelayFrom429({
      error: {
        message: "",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "5.5s",
          },
        ],
      },
    })
    expect(result).toBe(5.5)
  })

  it("returns 10s for RATE_LIMIT_EXCEEDED from Code Assist", () => {
    const result = parseRetryDelayFrom429({
      error: {
        message: "",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "RATE_LIMIT_EXCEEDED",
            domain: "cloudcode-pa.googleapis.com",
          },
        ],
      },
    })
    expect(result).toBe(10.0)
  })

  it("throws TerminalQuotaError for QUOTA_EXHAUSTED", () => {
    expect(() =>
      parseRetryDelayFrom429({
        error: {
          message: "Daily quota exhausted",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "QUOTA_EXHAUSTED",
            },
          ],
        },
      }),
    ).toThrow(TerminalQuotaError)
  })

  it("parses 'Please retry in Xs' fallback", () => {
    const result = parseRetryDelayFrom429({
      error: {
        message: "Please retry in 15s",
        details: [],
      },
    })
    expect(result).toBe(15)
  })

  it("parses 'Please retry in Xms' fallback", () => {
    const result = parseRetryDelayFrom429({
      error: {
        message: "Please retry in 500ms",
        details: [],
      },
    })
    expect(result).toBe(0.5)
  })
})

// ── raiseIfPermissionDenied ────────────────────────────────────────────────

describe("raiseIfPermissionDenied", () => {
  it("does nothing when no error", () => {
    expect(() => raiseIfPermissionDenied({}, null)).not.toThrow()
  })

  it("throws ProjectPermissionError for IAM_PERMISSION_DENIED", () => {
    expect(() =>
      raiseIfPermissionDenied(
        {
          error: {
            message: "Permission denied",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "IAM_PERMISSION_DENIED",
                metadata: { resource: "my-project" },
              },
            ],
          },
        },
        "my-project",
      ),
    ).toThrow(ProjectPermissionError)
  })
})

// ── retryWithBackoff ───────────────────────────────────────────────────────

describe("retryWithBackoff", () => {
  it("returns on first success", async () => {
    const fn = mock().mockResolvedValue("ok")
    const result = await retryWithBackoff(fn)
    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("retries on retryable error then succeeds", async () => {
    const error = Object.assign(new Error("Server error"), { status: 500 })
    const fn = mock().mockRejectedValueOnce(error).mockResolvedValueOnce("ok")

    const result = await retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
    })
    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("throws immediately for non-retryable status", async () => {
    const error = Object.assign(new Error("Not found"), { status: 404 })
    const fn = mock().mockRejectedValue(error)

    await expect(retryWithBackoff(fn, { maxAttempts: 3, initialDelayMs: 10 })).rejects.toThrow("Not found")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("throws immediately for TerminalQuotaError", async () => {
    const fn = mock().mockRejectedValue(new TerminalQuotaError("Quota exhausted"))

    await expect(retryWithBackoff(fn, { maxAttempts: 3, initialDelayMs: 10 })).rejects.toThrow(TerminalQuotaError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("throws immediately for ProjectPermissionError", async () => {
    const fn = mock().mockRejectedValue(new ProjectPermissionError("my-project"))

    await expect(retryWithBackoff(fn, { maxAttempts: 3, initialDelayMs: 10 })).rejects.toThrow(ProjectPermissionError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("exhausts retries and throws last error", async () => {
    const error = Object.assign(new Error("Server error"), { status: 500 })
    const fn = mock().mockRejectedValue(error)

    await expect(retryWithBackoff(fn, { maxAttempts: 2, initialDelayMs: 10 })).rejects.toThrow("Server error")
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
