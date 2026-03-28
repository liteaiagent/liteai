/**
 * Retry logic with exponential backoff and jitter.
 *
 * Aligned with gemini-cli/packages/core:
 * - googleQuotaErrors.ts (error classification)
 * - utils/retry.ts (retry strategy)
 * - core/geminiChat.ts (InvalidStreamError)
 */

import { createLogger } from "../core/logger.js"

const logger = createLogger("auth.retry")

// ── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_INITIAL_DELAY_MS = 1_000
export const DEFAULT_MAX_DELAY_MS = 30_000

// ── Exceptions ─────────────────────────────────────────────────────────────

export class TerminalQuotaError extends Error {
  readonly retryDelayMs?: number
  readonly reason?: string

  constructor(message: string, retryDelaySeconds?: number, reason?: string) {
    super(message)
    this.name = "TerminalQuotaError"
    this.retryDelayMs = retryDelaySeconds ? retryDelaySeconds * 1000 : undefined
    this.reason = reason
  }

  get isInsufficientCredits(): boolean {
    return this.reason === "INSUFFICIENT_G1_CREDITS_BALANCE"
  }
}

export class ProjectPermissionError extends Error {
  project: string | null
  constructor(project: string | null, detail = "") {
    const msg =
      `\n${"=".repeat(70)}\n` +
      `PERMISSION DENIED on project '${project}'\n\n` +
      `The project '${project}' does not have the\n` +
      `'cloudaicompanion.companions.generateChat' permission.\n\n` +
      `This usually means GOOGLE_CLOUD_PROJECT is set to a project\n` +
      `that your current OAuth account cannot use for Code Assist.\n\n` +
      `To fix, do ONE of the following:\n` +
      `  1. Remove/clear GOOGLE_CLOUD_PROJECT from your .env file\n` +
      `     AND from your system environment variables\n` +
      `  2. Set GOOGLE_CLOUD_PROJECT to a project you have access to\n` +
      `  3. Switch to an account that has permissions on '${project}'\n` +
      `${"=".repeat(70)}` +
      (detail ? `\nAPI response: ${detail.slice(0, 300)}` : "")
    super(msg)
    this.name = "ProjectPermissionError"
    this.project = project
  }
}

/**
 * Signals that a stream completed with invalid content — should trigger a retry.
 * Matching gemini-cli/packages/core/src/core/geminiChat.ts
 */
export class InvalidStreamError extends Error {
  readonly type: "NO_FINISH_REASON" | "NO_RESPONSE_TEXT" | "MALFORMED_FUNCTION_CALL"

  constructor(message: string, type: "NO_FINISH_REASON" | "NO_RESPONSE_TEXT" | "MALFORMED_FUNCTION_CALL") {
    super(message)
    this.name = "InvalidStreamError"
    this.type = type
  }
}

/**
 * Signals that user validation is required before proceeding.
 * Matching gemini-cli/packages/core/src/utils/googleQuotaErrors.ts
 */
export class ValidationRequiredError extends Error {
  readonly validationLink?: string
  readonly validationDescription?: string
  readonly learnMoreUrl?: string

  constructor(message: string, validationLink?: string, validationDescription?: string, learnMoreUrl?: string) {
    super(message)
    this.name = "ValidationRequiredError"
    this.validationLink = validationLink
    this.validationDescription = validationDescription
    this.learnMoreUrl = learnMoreUrl
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 429 || (statusCode >= 500 && statusCode < 600)
}

export function raiseIfPermissionDenied(body: Record<string, unknown>, projectId: string | null): void {
  const error = body.error as Record<string, unknown> | undefined
  if (!error) return
  const details = (error.details as Array<Record<string, unknown>>) ?? []
  for (const detail of details) {
    if (detail["@type"] === "type.googleapis.com/google.rpc.ErrorInfo" && detail.reason === "IAM_PERMISSION_DENIED") {
      const metadata = detail.metadata as Record<string, string> | undefined
      const resourceProject = metadata?.resource ?? ""
      throw new ProjectPermissionError(projectId || resourceProject, (error.message as string) || "")
    }
  }
}

export function parseRetryDelayFrom429(body: Record<string, unknown>): number | null {
  const error = body.error as Record<string, unknown> | undefined
  if (!error) return null

  const message = (error.message as string) || ""
  const details = (error.details as Array<Record<string, unknown>>) ?? []

  // Check for QUOTA_EXHAUSTED (terminal — do NOT retry)
  for (const detail of details) {
    if (detail["@type"] === "type.googleapis.com/google.rpc.ErrorInfo" && detail.reason === "QUOTA_EXHAUSTED") {
      throw new TerminalQuotaError(
        `Daily quota exhausted: ${message || "QUOTA_EXHAUSTED"}. This will not reset until tomorrow.`,
      )
    }
  }

  // Try to parse "reset after Xs" from message
  const resetMatch = message.match(/reset after (\d+)s/)
  if (resetMatch) return Number(resetMatch[1])

  // Check for RetryInfo in details
  for (const detail of details) {
    if (detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo") {
      const retryDelay = (detail.retryDelay as string) || ""
      const delayMatch = retryDelay.match(/([\d.]+)s/)
      if (delayMatch) return Number(delayMatch[1])
    }
  }

  // Check for RATE_LIMIT_EXCEEDED from Code Assist
  for (const detail of details) {
    if (
      detail["@type"] === "type.googleapis.com/google.rpc.ErrorInfo" &&
      detail.reason === "RATE_LIMIT_EXCEEDED" &&
      ((detail.domain as string) || "").includes("cloudcode-pa")
    ) {
      return 10.0
    }
  }

  // Fallback: "Please retry in Xs"
  const retryMatch = message.match(/Please retry in ([\d.]+)(ms|s)/)
  if (retryMatch) {
    const val = Number(retryMatch[1])
    return retryMatch[2] === "ms" ? val / 1000 : val
  }

  return null
}

/**
 * Classify a 403 VALIDATION_REQUIRED error from the Code Assist API.
 * Matching gemini-cli/packages/core/src/utils/googleQuotaErrors.ts
 */
export function classifyValidationRequired(body: Record<string, unknown>): ValidationRequiredError | null {
  const error = body.error as Record<string, unknown> | undefined
  if (!error) return null
  const details = (error.details as Array<Record<string, unknown>>) ?? []

  const errorInfo = details.find(
    (d) =>
      d["@type"] === "type.googleapis.com/google.rpc.ErrorInfo" &&
      d.reason === "VALIDATION_REQUIRED" &&
      ((d.domain as string) || "").includes("cloudcode-pa"),
  )
  if (!errorInfo) return null

  // Try to extract from Help detail
  const helpDetail = details.find((d) => d["@type"] === "type.googleapis.com/google.rpc.Help")

  let validationLink: string | undefined
  let validationDescription: string | undefined
  let learnMoreUrl: string | undefined

  const links = (helpDetail as { links?: Array<{ url: string; description: string }> })?.links
  if (links?.length) {
    validationLink = links[0]?.url
    validationDescription = links[0]?.description
    const learnMore = links.find(
      (l) => l.description.toLowerCase().trim() === "learn more" || l.url.includes("support.google.com"),
    )
    if (learnMore) learnMoreUrl = learnMore.url
  }

  // Fallback to metadata
  if (!validationLink) {
    const metadata = errorInfo.metadata as Record<string, string> | undefined
    validationLink = metadata?.validation_link
  }

  return new ValidationRequiredError(
    (error.message as string) || "Validation required",
    validationLink,
    validationDescription,
    learnMoreUrl,
  )
}

// ── Main Retry Function ───────────────────────────────────────────────────

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"))
      return
    }
    const timer = setTimeout(resolve, ms)
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer)
        reject(signal.reason ?? new Error("Aborted"))
      }
      signal.addEventListener("abort", onAbort, { once: true })
    }
  })
}

export interface RetryOptions {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  /** AbortSignal — if aborted, retries stop immediately. */
  signal?: AbortSignal
  /** Called when all retries are exhausted with 429 — return true to retry with fallback model. */
  onPersistent429?: () => Promise<boolean | string | null>
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const signal = options?.signal
  let currentDelay = options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  let attempt = 0
  let consecutive429s = 0

  while (attempt < maxAttempts) {
    attempt++

    if (signal?.aborted) {
      throw signal.reason ?? new Error("Aborted")
    }

    try {
      return await fn()
    } catch (e) {
      if (e instanceof TerminalQuotaError) throw e
      if (e instanceof ProjectPermissionError) throw e
      if (e instanceof ValidationRequiredError) throw e
      if (signal?.aborted) throw e

      const status = (e as { status?: number }).status
      if (status !== undefined && !isRetryableStatus(status)) throw e

      // Track persistent 429s for model fallback
      if (status === 429) {
        consecutive429s++
      } else {
        consecutive429s = 0
      }

      if (attempt >= maxAttempts) {
        // On persistent 429, try model fallback before giving up
        if (consecutive429s >= maxAttempts && options?.onPersistent429) {
          const fallbackResult = await options.onPersistent429()
          if (fallbackResult) {
            logger.info("Model fallback triggered on persistent 429")
            // Reset and retry with the (presumably changed) model
            attempt = 0
            consecutive429s = 0
            currentDelay = options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
            continue
          }
        }
        logger.warn(`Attempt ${attempt} failed. Max attempts reached.`)
        throw e
      }

      // For 429, try to use server-suggested delay
      if (status === 429) {
        try {
          const body = (e as { body?: Record<string, unknown> }).body
          if (body) {
            const serverDelay = parseRetryDelayFrom429(body)
            if (serverDelay !== null) {
              currentDelay = Math.max(currentDelay, serverDelay * 1000)
              const jitter = currentDelay * 0.2 * Math.random()
              const delayMs = currentDelay + jitter
              logger.info(
                `Attempt ${attempt} rate limited. Server suggests ${serverDelay.toFixed(0)}s, retrying in ${(delayMs / 1000).toFixed(1)}s...`,
              )
              await sleep(delayMs, signal)
              currentDelay = Math.min(maxDelayMs, currentDelay * 2)
              continue
            }
          }
        } catch (parseErr) {
          if (parseErr instanceof TerminalQuotaError) throw parseErr
        }
      }

      // Exponential backoff with jitter
      const jitter = currentDelay * 0.3 * (Math.random() * 2 - 1)
      const delayMs = Math.max(0, currentDelay + jitter)
      logger.info(
        `Attempt ${attempt} failed${status ? ` with ${status}` : ""}. Retrying in ${(delayMs / 1000).toFixed(1)}s...`,
      )
      await sleep(delayMs, signal)
      currentDelay = Math.min(maxDelayMs, currentDelay * 2)
    }
  }

  throw new Error("Retry attempts exhausted")
}
