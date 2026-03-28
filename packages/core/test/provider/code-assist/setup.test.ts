import { describe, expect, test } from "bun:test"
import type { FetchFunction } from "@ai-sdk/provider-utils"
import {
  IneligibleTierError,
  ProjectIdRequiredError,
  setup,
  ValidationRequiredError,
} from "../../../src/provider/sdk/code-assist/setup"
import type { LoadCodeAssistResponse, LongRunningOperationResponse } from "../../../src/provider/sdk/code-assist/types"
import { IneligibleTierReasonCode, UserTierId } from "../../../src/provider/sdk/code-assist/types"

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
}

// ── Error classes ──────────────────────────────────────────────────────

describe("error classes", () => {
  test("ProjectIdRequiredError has descriptive message", () => {
    const err = new ProjectIdRequiredError()
    expect(err.message).toContain("GOOGLE_CLOUD_PROJECT")
  })

  test("IneligibleTierError carries tiers", () => {
    const tiers = [{ reasonMessage: "Not allowed", tierId: UserTierId.FREE }]
    const err = new IneligibleTierError(tiers)
    expect(err.tiers).toBe(tiers)
    expect(err.message).toContain("Not allowed")
  })

  test("ValidationRequiredError carries url", () => {
    const err = new ValidationRequiredError("https://validate.example.com", "Please validate")
    expect(err.url).toBe("https://validate.example.com")
    expect(err.message).toBe("Please validate")
  })

  test("ValidationRequiredError default message", () => {
    const err = new ValidationRequiredError("https://validate.example.com")
    expect(err.message).toBe("Account validation required")
  })
})

// ── setup ──────────────────────────────────────────────────────────────

describe("setup", () => {
  test("already onboarded with project", async () => {
    const load: LoadCodeAssistResponse = {
      currentTier: { id: UserTierId.STANDARD, name: "Standard" },
      cloudaicompanionProject: "proj-123",
    }
    const cfg = {
      fetch: (async (_url: string) => ok(load)) as unknown as FetchFunction,
    }
    const result = await setup(cfg)
    expect(result.project).toBe("proj-123")
    expect(result.tier).toBe(UserTierId.STANDARD)
    expect(result.tierName).toBe("Standard")
  })

  test("already onboarded with paidTier overrides currentTier", async () => {
    const load: LoadCodeAssistResponse = {
      currentTier: { id: UserTierId.STANDARD, name: "Standard" },
      paidTier: { id: UserTierId.PRO, name: "Pro" },
      cloudaicompanionProject: "proj",
    }
    const cfg = {
      fetch: (async () => ok(load)) as unknown as FetchFunction,
    }
    const result = await setup(cfg)
    expect(result.tier).toBe(UserTierId.PRO)
    expect(result.tierName).toBe("Pro")
    expect(result.paidTier?.id).toBe(UserTierId.PRO)
  })

  test("already onboarded no project with envProject", async () => {
    const load: LoadCodeAssistResponse = {
      currentTier: { id: UserTierId.STANDARD, name: "Standard" },
      cloudaicompanionProject: null,
    }
    const cfg = {
      fetch: (async () => ok(load)) as unknown as FetchFunction,
    }
    const result = await setup(cfg, "env-proj")
    expect(result.project).toBe("env-proj")
  })

  test("already onboarded no project no envProject throws", async () => {
    const load: LoadCodeAssistResponse = {
      currentTier: { id: UserTierId.STANDARD },
      cloudaicompanionProject: null,
    }
    const cfg = {
      fetch: (async () => ok(load)) as unknown as FetchFunction,
    }
    expect(setup(cfg)).rejects.toThrow(ProjectIdRequiredError)
  })

  test("already onboarded no project with ineligible tiers throws IneligibleTierError", async () => {
    const load: LoadCodeAssistResponse = {
      currentTier: { id: UserTierId.STANDARD },
      cloudaicompanionProject: null,
      ineligibleTiers: [{ reasonMessage: "restricted", tierId: UserTierId.PRO }],
    }
    const cfg = {
      fetch: (async () => ok(load)) as unknown as FetchFunction,
    }
    expect(setup(cfg)).rejects.toThrow(IneligibleTierError)
  })

  test("not onboarded triggers onboardUser", async () => {
    const load: LoadCodeAssistResponse = {
      currentTier: null,
      allowedTiers: [{ id: UserTierId.FREE, isDefault: true, name: "Free" }],
    }
    const lro: LongRunningOperationResponse = {
      done: true,
      response: { cloudaicompanionProject: { id: "new-proj", name: "New Project" } },
    }
    let calls = 0
    const cfg = {
      fetch: (async (url: string) => {
        calls++
        if (url.includes("loadCodeAssist")) return ok(load)
        if (url.includes("onboardUser")) return ok(lro)
        return ok({})
      }) as unknown as FetchFunction,
    }
    const result = await setup(cfg)
    expect(result.project).toBe("new-proj")
    expect(result.tier).toBe(UserTierId.FREE)
    expect(calls).toBe(2) // loadCodeAssist + onboardUser
  })

  test("not onboarded with LRO polling", async () => {
    const load: LoadCodeAssistResponse = {
      currentTier: null,
      allowedTiers: [{ id: UserTierId.STANDARD, isDefault: true, name: "Standard" }],
    }
    const pending: LongRunningOperationResponse = { name: "operations/x", done: false }
    const done: LongRunningOperationResponse = {
      name: "operations/x",
      done: true,
      response: { cloudaicompanionProject: { id: "polled-proj" } },
    }
    let polls = 0
    const cfg = {
      fetch: (async (url: string) => {
        if (url.includes("loadCodeAssist")) return ok(load)
        if (url.includes("onboardUser")) return ok(pending)
        // getOperation polls
        polls++
        if (polls >= 1) return ok(done)
        return ok(pending)
      }) as unknown as FetchFunction,
    }
    const result = await setup(cfg)
    expect(result.project).toBe("polled-proj")
  }, 30_000)

  test("not onboarded LRO no project falls back to envProject", async () => {
    const load: LoadCodeAssistResponse = {
      currentTier: null,
      allowedTiers: [{ id: UserTierId.STANDARD, isDefault: true, name: "Standard" }],
    }
    const lro: LongRunningOperationResponse = { done: true }
    const cfg = {
      fetch: (async (url: string) => {
        if (url.includes("loadCodeAssist")) return ok(load)
        if (url.includes("onboardUser")) return ok(lro)
        return ok({})
      }) as unknown as FetchFunction,
    }
    const result = await setup(cfg, "fallback-proj")
    expect(result.project).toBe("fallback-proj")
  })

  test("not onboarded LRO no project no envProject throws", async () => {
    const load: LoadCodeAssistResponse = {
      currentTier: null,
      allowedTiers: [{ id: UserTierId.STANDARD, isDefault: true, name: "Standard" }],
    }
    const lro: LongRunningOperationResponse = { done: true }
    const cfg = {
      fetch: (async (url: string) => {
        if (url.includes("loadCodeAssist")) return ok(load)
        if (url.includes("onboardUser")) return ok(lro)
        return ok({})
      }) as unknown as FetchFunction,
    }
    expect(setup(cfg)).rejects.toThrow(ProjectIdRequiredError)
  })

  test("validation required throws ValidationRequiredError", async () => {
    const load: LoadCodeAssistResponse = {
      currentTier: null,
      ineligibleTiers: [
        {
          reasonCode: IneligibleTierReasonCode.VALIDATION_REQUIRED,
          validationUrl: "https://validate.example.com",
          reasonMessage: "Verify your account",
        },
      ],
    }
    const cfg = {
      fetch: (async () => ok(load)) as unknown as FetchFunction,
    }
    expect(setup(cfg)).rejects.toThrow(ValidationRequiredError)
  })

  test("uses legacy tier when no default in allowedTiers", async () => {
    const load: LoadCodeAssistResponse = {
      currentTier: null,
      allowedTiers: [{ id: UserTierId.PRO, isDefault: false, name: "Pro" }],
    }
    const lro: LongRunningOperationResponse = {
      done: true,
      response: { cloudaicompanionProject: { id: "proj" } },
    }
    const cfg = {
      fetch: (async (url: string) => {
        if (url.includes("loadCodeAssist")) return ok(load)
        if (url.includes("onboardUser")) return ok(lro)
        return ok({})
      }) as unknown as FetchFunction,
    }
    const result = await setup(cfg)
    // Falls back to legacy tier
    expect(result.tier).toBe(UserTierId.LEGACY)
  })
})
