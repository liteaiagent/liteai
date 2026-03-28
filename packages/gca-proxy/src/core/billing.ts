/**
 * Billing & Credits — overage strategy, credit types, eligibility checks.
 *
 * Matching gemini-cli/packages/core/src/billing/billing.ts
 */

import { createLogger } from "./logger.js"
import { PREVIEW_GEMINI_3_1_MODEL, PREVIEW_GEMINI_MODEL } from "./model-config.js"

const logger = createLogger("billing")

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Strategy for handling quota exhaustion when AI credits are available.
 * - 'ask': Prompt the user each time
 * - 'always': Automatically use credits
 * - 'never': Never use credits
 */
export type OverageStrategy = "ask" | "always" | "never"

export type CreditType = "GOOGLE_ONE_AI"

export interface AvailableCredits {
  creditType: CreditType | string
  creditAmount?: string
}

/** Minimal user tier shape we care about for billing. */
export interface GeminiUserTier {
  id?: string
  name?: string
  availableCredits?: AvailableCredits[]
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Credit type for Google One AI credits */
export const G1_CREDIT_TYPE: CreditType = "GOOGLE_ONE_AI"

/** Models eligible for overage billing */
export const OVERAGE_ELIGIBLE_MODELS = new Set([PREVIEW_GEMINI_MODEL, PREVIEW_GEMINI_3_1_MODEL])

/** Minimum credit balance to allow automatic usage */
export const MIN_CREDIT_BALANCE = 50

// ── Functions ──────────────────────────────────────────────────────────────

/**
 * Checks if a model is eligible for AI credits overage billing.
 */
export function isOverageEligibleModel(model: string): boolean {
  return OVERAGE_ELIGIBLE_MODELS.has(model)
}

/**
 * Extracts the G1 AI credit balance from a tier's available credits.
 * @returns The credit amount as a number, 0 if eligible but empty, or null if not eligible.
 */
export function getG1CreditBalance(tier: GeminiUserTier | null | undefined): number | null {
  if (!tier?.availableCredits) return null

  const g1Credits = tier.availableCredits.filter((c) => c.creditType === G1_CREDIT_TYPE)
  if (g1Credits.length === 0) return null

  return g1Credits.reduce((sum, c) => {
    const amount = Number.parseInt(c.creditAmount ?? "0", 10)
    return sum + (Number.isNaN(amount) ? 0 : amount)
  }, 0)
}

/**
 * Determines if credits should be automatically used.
 */
export function shouldAutoUseCredits(strategy: OverageStrategy, creditBalance: number | null): boolean {
  return strategy === "always" && creditBalance != null && creditBalance >= MIN_CREDIT_BALANCE
}

/**
 * Determines if the overage menu should be shown.
 */
export function shouldShowOverageMenu(strategy: OverageStrategy, creditBalance: number | null): boolean {
  return strategy === "ask" && creditBalance != null && creditBalance >= MIN_CREDIT_BALANCE
}

// ── Credit Tracking ────────────────────────────────────────────────────────

/** Tracks consumed/remaining credits from streaming responses. */
export interface CreditSnapshot {
  consumed: number
  remaining: number
}

/**
 * Accumulate consumed and remaining credits from a CA streaming response.
 */
export function trackCreditsFromResponse(snapshot: CreditSnapshot, response: Record<string, unknown>): CreditSnapshot {
  const consumed = response.consumedCredits as AvailableCredits[] | undefined
  const remaining = response.remainingCredits as AvailableCredits[] | undefined

  let newConsumed = snapshot.consumed
  let newRemaining = snapshot.remaining

  if (consumed) {
    for (const credit of consumed) {
      if (credit.creditType === G1_CREDIT_TYPE && credit.creditAmount) {
        newConsumed += Number.parseInt(credit.creditAmount, 10) || 0
      }
    }
  }

  if (remaining) {
    newRemaining = remaining.reduce((sum, credit) => {
      if (credit.creditType === G1_CREDIT_TYPE && credit.creditAmount) {
        return sum + (Number.parseInt(credit.creditAmount, 10) || 0)
      }
      return sum
    }, 0)
  }

  if (newConsumed > snapshot.consumed) {
    logger.info(`Credits: consumed=${newConsumed}, remaining=${newRemaining}`)
  }

  return { consumed: newConsumed, remaining: newRemaining }
}
