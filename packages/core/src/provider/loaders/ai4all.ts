import { Auth } from "@/auth"
import { Env } from "@/env"
import { Installation } from "@/installation"
import { Log } from "@/util/log"
import type { Provider } from "../provider"
import { ModelID, ProviderID } from "../schema"
import type { LoaderInput, LoaderResult } from "./types"

const log = Log.create({ service: "loader.ai4all" })

const APIGEE_HOST = "api-dev.valeo.com"
const REFRESH_URL = `https://${APIGEE_HOST}/rsd/ai4all/auth/token`
const MODELS_URL = `https://${APIGEE_HOST}/rsd/ai4all/llm/models`
const HEADER = `liteai/${Installation.VERSION}`

/** Fallback model IDs used when the models endpoint is unreachable. */
const FALLBACK_MODEL_IDS = [
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "claude-sonnet-4",
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "mistral-large-2411",
  "deepseek-r1-0528-maas",
  "imagen-4.0-generate-001",
  "imagen-3.0-generate-002",
]

/**
 * Parse the `exp` claim from a JWT access token.
 * Returns the expiry as a Unix-ms timestamp, or 0 if parsing fails.
 */
function jwtExpiry(token: string): number {
  try {
    const payload = token.split(".")[1]
    if (!payload) return 0
    // Handle base64url → base64 conversion and padding
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
    const json = Buffer.from(padded, "base64").toString("utf-8")
    const { exp } = JSON.parse(json) as { exp?: number }
    return exp ? exp * 1000 : 0
  } catch {
    return 0
  }
}

/** 60-second buffer before considering a token expired (matches working CLI script). */
const EXPIRY_BUFFER_MS = 60_000

function isTokenExpired(auth: { access: string; expires: number }): boolean {
  // Prefer the JWT `exp` claim when available (more reliable than stored expires_in)
  const jwtExp = jwtExpiry(auth.access)
  const effectiveExpiry = jwtExp || auth.expires
  return Date.now() >= effectiveExpiry - EXPIRY_BUFFER_MS
}

async function refresh(input: LoaderInput): Promise<string | undefined> {
  const auth = await Auth.get("ai4all")
  if (!auth || auth.type !== "oauth") return undefined

  // If the access token is still valid, return it
  if (!isTokenExpired(auth)) return auth.access

  // Access token expired — try refresh
  if (!auth.refresh) {
    log.warn("access token expired but no refresh token available — re-login required")
    return undefined
  }

  const id = input.options.clientId ?? Env.get("AI4ALL_CLIENT_ID") ?? auth.clientId
  const secret = input.options.clientSecret ?? Env.get("AI4ALL_CLIENT_SECRET") ?? auth.clientSecret
  if (!id || !secret) {
    log.error("cannot refresh — no client credentials (AI4ALL_CLIENT_ID / AI4ALL_CLIENT_SECRET)")
    return undefined
  }

  log.info("access token expired, refreshing via refresh_token…")

  const creds = Buffer.from(`${id}:${secret}`).toString("base64")
  let res: Response
  try {
    res = await fetch(REFRESH_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "x-ai4all-client": HEADER,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: auth.refresh,
      }),
    })
  } catch (err) {
    log.error("refresh request failed (network error)", { error: err })
    return undefined
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    log.error("refresh failed", { status: res.status, body })
    return undefined
  }

  const body = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!body.access_token) {
    log.error("refresh response missing access_token")
    return undefined
  }

  const expires = Date.now() + ((body.expires_in ?? 3600) - 60) * 1000
  await Auth.set("ai4all", {
    type: "oauth",
    access: body.access_token,
    refresh: body.refresh_token ?? auth.refresh,
    expires,
    clientId: id,
    clientSecret: secret,
  })

  log.info("token refreshed successfully")
  return body.access_token
}

async function token(input: LoaderInput): Promise<string | undefined> {
  // 1. Explicit env var (manual paste)
  const key = Env.get("AI4ALL_API_KEY")
  if (key) return key

  // 2. OAuth stored credentials (with auto-refresh)
  return refresh(input)
}

/**
 * Fetch available model IDs from the AI4ALL models endpoint.
 */
async function fetchAvailableModels(accessToken: string): Promise<string[] | undefined> {
  try {
    const res = await fetch(MODELS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-ai4all-client": HEADER,
      },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      log.warn("fetchAvailableModels failed", { status: res.status })
      return undefined
    }

    const data = (await res.json()) as { data?: Array<{ id?: string }> } | Array<{ id?: string }>

    // Handle both { data: [...] } and [...] response shapes
    const items = Array.isArray(data) ? data : data?.data
    if (!items || !Array.isArray(items)) {
      log.warn("fetchAvailableModels returned unexpected shape", { data })
      return undefined
    }

    const ids = items.map((m) => m.id ?? "").filter(Boolean)
    log.info("fetched available models from AI4ALL API", { count: ids.length, models: ids })
    return ids.length > 0 ? ids : undefined
  } catch (err) {
    log.warn("failed to fetch available models from AI4ALL API, using fallback", { error: err })
    return undefined
  }
}

export async function ai4all(input: LoaderInput, database: Record<string, Provider.Info>): Promise<LoaderResult> {
  const key = await token(input)

  // Fetch model IDs from the API if we have auth, falling back to hardcoded list
  let modelIds = FALLBACK_MODEL_IDS
  if (key) {
    const fetched = await fetchAvailableModels(key)
    if (fetched) modelIds = fetched
  }

  // Build Provider.Model entries using models.dev data for capabilities
  const models: Record<string, Provider.Model> = {}
  for (const id of modelIds) {
    models[id] = buildAi4allModel(id, database)
  }

  return {
    autoload: !!key,
    models,
    options: {
      ...(key && { apiKey: key }),
      headers: {
        "x-ai4all-client": HEADER,
      },
      fetch: async (url: unknown, init?: RequestInit) => {
        if (!Env.get("AI4ALL_API_KEY")) {
          const fresh = await refresh(input)
          if (fresh) {
            const hdrs = new Headers(init?.headers)
            hdrs.set("Authorization", `Bearer ${fresh}`)
            init = { ...init, headers: hdrs }
          }
        }

        const res = await fetch(url as string, init)

        // On 401, force a token refresh and retry once
        if (res.status === 401 && !Env.get("AI4ALL_API_KEY")) {
          log.warn("received 401 — forcing token refresh and retrying…")

          // Invalidate the stored expiry so refresh() actually calls the server
          const auth = await Auth.get("ai4all")
          if (auth && auth.type === "oauth") {
            await Auth.set("ai4all", { ...auth, expires: 0, clientId: auth.clientId, clientSecret: auth.clientSecret })
          }

          const retryToken = await refresh(input)
          if (retryToken) {
            const hdrs = new Headers(init?.headers)
            hdrs.set("Authorization", `Bearer ${retryToken}`)
            return fetch(url as string, { ...init, headers: hdrs })
          }
        }

        return res
      },
    },
  }
}

/** Build an AI4ALL model entry, looking up capabilities from the original provider in models.dev. */
function buildAi4allModel(id: string, database: Record<string, Provider.Info>): Provider.Model {
  const pid = ProviderID.make("ai4all")
  const fallback: Pick<Provider.Model, "limit" | "capabilities" | "cost" | "release_date"> = {
    limit: { context: 200000, output: 8192 },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    release_date: "",
  }

  function ref(modelId: string) {
    const lookup = (db: (typeof database)[string] | undefined) =>
      db?.models[modelId] ?? db?.models[modelId.replace(/-maas$/, "")]

    if (modelId.startsWith("gemini")) return lookup(database.google)
    if (modelId.startsWith("claude")) return lookup(database.anthropic)
    if (modelId.startsWith("mistral")) return lookup(database.mistral)
    if (modelId.startsWith("deepseek")) return lookup(database.deepseek)
    if (modelId.startsWith("imagen")) return lookup(database.google)
    if (modelId.startsWith("glm")) return lookup(database.zhipuai)
    return undefined
  }

  function family(modelId: string) {
    if (modelId.startsWith("gemini")) return "gemini"
    if (modelId.startsWith("claude")) return "claude"
    if (modelId.startsWith("mistral")) return "mistral"
    if (modelId.startsWith("deepseek")) return "deepseek"
    if (modelId.startsWith("imagen")) return "imagen"
    if (modelId.startsWith("glm")) return "glm"
    return "unknown"
  }

  const r = ref(id)
  // DeepSeek-R1 models are always reasoning models, even without a ref match
  const capabilities = r?.capabilities ?? {
    ...fallback.capabilities,
    reasoning: id.includes("-r1-") || fallback.capabilities.reasoning,
  }
  return {
    id: ModelID.make(id),
    providerID: pid,
    name: r?.name ?? id,
    family: r?.family ?? family(id),
    status: r?.status ?? "active",
    headers: {},
    options: {},
    api: {
      id,
      npm: "@ai-sdk/openai-compatible",
      url: "https://api-dev.valeo.com/rsd/ai4all/llm/v1",
    },
    capabilities,
    limit: r?.limit ?? fallback.limit,
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    release_date: r?.release_date ?? fallback.release_date,
    variants: {},
  }
}
