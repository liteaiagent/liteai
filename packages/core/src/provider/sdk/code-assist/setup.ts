// User onboarding and project discovery logic.
// Ported from gemini-cli/packages/core/src/code_assist/setup.ts.
// Called after OAuth is complete to discover the user's GCP project and tier.

import type { ClientConfig } from "./client"
import { getOperation, loadCodeAssist, onboardUser } from "./client"
import {
  type ClientMetadata,
  type GeminiUserTier,
  type IneligibleTier,
  IneligibleTierReasonCode,
  type LoadCodeAssistResponse,
  UserTierId,
} from "./types"

export interface UserData {
  project: string
  tier: UserTierId
  tierName?: string
  paidTier?: GeminiUserTier
}

export class ProjectIdRequiredError extends Error {
  constructor() {
    super(
      "This account requires setting the GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID env var. " +
        "See https://goo.gle/gemini-cli-auth-docs#workspace-gca",
    )
  }
}

export class IneligibleTierError extends Error {
  readonly tiers: IneligibleTier[]
  constructor(tiers: IneligibleTier[]) {
    super(tiers.map((t) => t.reasonMessage).join(", "))
    this.tiers = tiers
  }
}

export class ValidationRequiredError extends Error {
  readonly url: string
  readonly description?: string
  constructor(url: string, description?: string) {
    super(description ?? "Account validation required")
    this.url = url
    this.description = description
  }
}

const META: ClientMetadata = {
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
}

/**
 * Discovers the user's GCP project and tier by calling loadCodeAssist + onboardUser.
 * Returns a `UserData` with the project ID, tier, and optional paid tier info.
 *
 * @param cfg - HTTP client config (with AuthClient)
 * @param envProject - Optional project ID from env vars (GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_PROJECT_ID)
 */
export async function setup(cfg: ClientConfig, envProject?: string): Promise<UserData> {
  const res = await loadCodeAssist(cfg, {
    cloudaicompanionProject: envProject,
    metadata: {
      ...META,
      duetProject: envProject,
    },
  })

  validate(res)

  // Already onboarded — return current tier
  if (res.currentTier) {
    if (!res.cloudaicompanionProject) {
      // Env project override
      if (envProject) {
        return {
          project: envProject,
          tier: res.paidTier?.id ?? res.currentTier.id ?? UserTierId.STANDARD,
          tierName: res.paidTier?.name ?? res.currentTier.name,
          paidTier: res.paidTier ?? undefined,
        }
      }
      throwIneligible(res)
    }
    return {
      project: res.cloudaicompanionProject,
      tier: res.paidTier?.id ?? res.currentTier.id ?? UserTierId.STANDARD,
      tierName: res.paidTier?.name ?? res.currentTier.name,
      paidTier: res.paidTier ?? undefined,
    }
  }

  // Not yet onboarded — find default tier
  const tier = defaultTier(res)

  // Free tier uses managed project — don't send a project ID
  const req =
    tier.id === UserTierId.FREE
      ? { tierId: tier.id, cloudaicompanionProject: undefined, metadata: META }
      : {
          tierId: tier.id,
          cloudaicompanionProject: envProject,
          metadata: { ...META, duetProject: envProject },
        }

  let lro = await onboardUser(cfg, req)

  // Poll long-running operation
  if (!lro.done && lro.name) {
    const name = lro.name
    while (!lro.done) {
      await new Promise((r) => setTimeout(r, 5000))
      lro = await getOperation(cfg, name)
    }
  }

  if (!lro.response?.cloudaicompanionProject?.id) {
    if (envProject) {
      return {
        project: envProject,
        tier: tier.id ?? UserTierId.STANDARD,
        tierName: tier.name,
      }
    }
    throwIneligible(res)
  }

  return {
    project: lro.response.cloudaicompanionProject.id,
    tier: tier.id ?? UserTierId.STANDARD,
    tierName: tier.name,
  }
}

function validate(res: LoadCodeAssistResponse) {
  if (!res) throw new Error("loadCodeAssist returned empty response")

  if (!res.currentTier && res.ineligibleTiers?.length) {
    const v = res.ineligibleTiers.find(
      (t) => t.validationUrl && t.reasonCode === IneligibleTierReasonCode.VALIDATION_REQUIRED,
    )
    if (v?.validationUrl) {
      throw new ValidationRequiredError(v.validationUrl, v.reasonMessage)
    }
  }
}

function defaultTier(res: LoadCodeAssistResponse): GeminiUserTier {
  for (const tier of res.allowedTiers ?? []) {
    if (tier.isDefault) return tier
  }
  return {
    name: "",
    description: "",
    id: UserTierId.LEGACY,
    userDefinedCloudaicompanionProject: true,
  }
}

function throwIneligible(res: LoadCodeAssistResponse): never {
  if (res.ineligibleTiers?.length) {
    throw new IneligibleTierError(res.ineligibleTiers)
  }
  throw new ProjectIdRequiredError()
}
