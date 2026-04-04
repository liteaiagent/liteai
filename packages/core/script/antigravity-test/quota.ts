/**
 * Antigravity LSP — Full Quota Fetch
 *
 * Fetches and parses the complete user status (quota, models, user info)
 * from the Language Server's GetUserStatus gRPC-Web endpoint.
 */

import type { Protocol } from "./gateway"
import { rawRequest } from "./gateway"

// ── Response types (matching the server proto schema) ────────────────

export interface RawModelConfig {
  label: string
  modelOrAlias?: { model: string }
  quotaInfo?: {
    remainingFraction?: number
    resetTime: string
  }
}

export interface ServerUserStatusResponse {
  userStatus: {
    name?: string
    email?: string
    userTier?: {
      id?: string
      name?: string
      description?: string
      upgradeSubscriptionUri?: string
      upgradeSubscriptionText?: string
    }
    planStatus?: {
      planInfo: {
        monthlyPromptCredits: number
        monthlyFlowCredits?: number
        planName?: string
        teamsTier?: string
        browserEnabled?: boolean
        knowledgeBaseEnabled?: boolean
        canBuyMoreCredits?: boolean
      }
      availablePromptCredits: number
      availableFlowCredits?: number
    }
    cascadeModelConfigData?: {
      clientModelConfigs: RawModelConfig[]
    }
  }
}

export interface QuotaResult {
  raw: ServerUserStatusResponse
  user: {
    name?: string
    email?: string
    tier?: string
    plan?: string
  }
  credits: {
    prompt: { available: number; monthly: number; pct: number } | null
    flow: { available: number; monthly: number; pct: number } | null
  }
  models: Array<{
    label: string
    modelId: string
    remainingPct: number
    exhausted: boolean
    resetsIn: string
  }>
}

const ENDPOINT = "/exa.language_server_pb.LanguageServerService/GetUserStatus"

function formatTime(ms: number): string {
  if (ms <= 0) return "Ready"
  const mins = Math.ceil(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  return `${hours}h ${mins % 60}m`
}

/**
 * Fetch and parse full quota data from the Language Server.
 */
export async function fetchQuota(
  protocol: Protocol,
  hostname: string,
  port: number,
  csrfToken: string,
): Promise<QuotaResult> {
  const body = {
    metadata: {
      ideName: "liteai",
      extensionName: "liteai",
      locale: "en",
    },
  }

  const res = await rawRequest<ServerUserStatusResponse>(
    protocol, hostname, port, ENDPOINT, csrfToken, body,
  )

  if (res.statusCode !== 200) {
    throw new Error(`HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`)
  }

  const us = res.data.userStatus
  if (!us) throw new Error("Response missing userStatus field")

  // Parse credits
  const plan = us.planStatus?.planInfo
  const promptCredits = plan && us.planStatus?.availablePromptCredits != null
    ? {
        available: Number(us.planStatus.availablePromptCredits),
        monthly: Number(plan.monthlyPromptCredits),
        pct: plan.monthlyPromptCredits > 0
          ? Math.round((Number(us.planStatus.availablePromptCredits) / Number(plan.monthlyPromptCredits)) * 100)
          : 0,
      }
    : null

  const flowCredits = plan?.monthlyFlowCredits && us.planStatus?.availableFlowCredits != null
    ? {
        available: Number(us.planStatus.availableFlowCredits),
        monthly: Number(plan.monthlyFlowCredits),
        pct: plan.monthlyFlowCredits > 0
          ? Math.round((Number(us.planStatus.availableFlowCredits) / Number(plan.monthlyFlowCredits)) * 100)
          : 0,
      }
    : null

  // Parse models
  const rawModels = us.cascadeModelConfigData?.clientModelConfigs ?? []
  const models = rawModels
    .filter((m) => m.quotaInfo)
    .map((m) => {
      const frac = m.quotaInfo!.remainingFraction ?? 0
      const reset = new Date(m.quotaInfo!.resetTime)
      const diff = reset.getTime() - Date.now()
      return {
        label: m.label,
        modelId: m.modelOrAlias?.model ?? "unknown",
        remainingPct: Math.round(frac * 100),
        exhausted: frac === 0,
        resetsIn: formatTime(diff),
      }
    })

  return {
    raw: res.data,
    user: {
      name: us.name,
      email: us.email,
      tier: us.userTier?.name ?? plan?.teamsTier,
      plan: plan?.planName,
    },
    credits: { prompt: promptCredits, flow: flowCredits },
    models,
  }
}
