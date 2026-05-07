import { Log } from "@liteai/util/log"
import type { Provider } from "../provider"
import { ModelID, type ProviderID } from "../schema"

const log = Log.create({ service: "loader.openai-compat" })

export interface FetchModelsOptions {
  /** API key for authenticated providers. Sent as `Authorization: Bearer {apiKey}`. */
  apiKey?: string
  /** Request timeout in milliseconds. Default: 5000. */
  timeout?: number
  /** Additional headers to send with the request. */
  headers?: Record<string, string>
}

/**
 * Fetch available model IDs from an OpenAI-compatible `/v1/models` endpoint.
 *
 * Handles both `{ data: [{ id }] }` and bare `[{ id }]` response shapes.
 * Returns `undefined` on any failure (timeout, network, invalid response) — never throws.
 */
export async function fetchOpenAICompatibleModels(
  baseUrl: string,
  opts?: FetchModelsOptions,
): Promise<string[] | undefined> {
  // Normalize: strip trailing slashes, ensure we hit /models
  const normalized = baseUrl.replace(/\/+$/, "")
  const url = normalized.endsWith("/models") ? normalized : `${normalized}/models`

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...opts?.headers,
  }
  if (opts?.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(opts?.timeout ?? 5000),
    })

    if (!res.ok) {
      log.warn("dynamic model fetch failed", { url, status: res.status })
      return undefined
    }

    const data = (await res.json()) as { data?: Array<{ id?: string }> } | Array<{ id?: string }>

    // Handle both { data: [...] } and [...] response shapes
    const items = Array.isArray(data) ? data : data?.data
    if (!items || !Array.isArray(items)) {
      log.warn("dynamic model fetch returned unexpected shape", { url, data })
      return undefined
    }

    const ids = items.map((m) => m.id ?? "").filter(Boolean)
    if (ids.length === 0) {
      log.warn("dynamic model fetch returned empty model list", { url })
      return undefined
    }

    log.info("fetched dynamic model list", { url, count: ids.length, models: ids })
    return ids
  } catch (err) {
    log.warn("dynamic model fetch failed", { url, error: err })
    return undefined
  }
}

/** Default capabilities for dynamically-discovered models. */
const DEFAULT_CAPABILITIES: Provider.Model["capabilities"] = {
  temperature: true,
  reasoning: false,
  attachment: false,
  toolcall: true,
  input: { text: true, audio: false, image: false, video: false, pdf: false },
  output: { text: true, audio: false, image: false, video: false, pdf: false },
  interleaved: false,
}

/** Default limits for dynamically-discovered models. */
const DEFAULT_LIMIT: Provider.Model["limit"] = {
  context: 128000,
  output: 8192,
}

/** Default cost for dynamically-discovered models (0 — assumed local/self-hosted). */
const DEFAULT_COST: Provider.Model["cost"] = {
  input: 0,
  output: 0,
  cache: { read: 0, write: 0 },
}

/**
 * Search all providers in the models.dev database for a model matching the given ID.
 * Returns the first match found, or undefined if no provider has this model.
 *
 * This is a read-only lookup — the database is never mutated.
 */
function lookupModelInDatabase(id: string, database: Record<string, Provider.Info>): Provider.Model | undefined {
  for (const provider of Object.values(database)) {
    const match = provider.models[id]
    if (match) return match
  }
  return undefined
}

/**
 * Build a `Provider.Model` for a dynamically-discovered model ID.
 *
 * Performs a read-only lookup against the models.dev database to enrich
 * capabilities, limits, family, name, cost, and release_date for known models.
 * Falls back to sensible defaults for unrecognized model IDs.
 *
 * The dynamic fetch remains authoritative for *which* models exist —
 * models.dev is used only as a reference catalog for capability metadata.
 */
export function buildDynamicModel(
  id: string,
  providerID: ProviderID,
  npm: string,
  baseUrl: string,
  database?: Record<string, Provider.Info>,
): Provider.Model {
  const ref = database ? lookupModelInDatabase(id, database) : undefined

  if (ref) {
    log.debug("dynamic model matched models.dev entry", { id, refProvider: ref.providerID })
  }

  return {
    id: ModelID.make(id),
    providerID,
    name: ref?.name ?? id,
    family: ref?.family ?? "",
    status: ref?.status ?? "active",
    headers: {},
    options: {},
    api: {
      id,
      npm,
      url: baseUrl,
    },
    capabilities: ref?.capabilities ? { ...ref.capabilities } : { ...DEFAULT_CAPABILITIES },
    limit: ref?.limit ? { ...ref.limit } : { ...DEFAULT_LIMIT },
    cost: ref?.cost ? { ...ref.cost, cache: { ...ref.cost.cache } } : { ...DEFAULT_COST },
    release_date: ref?.release_date ?? "",
    variants: {},
  }
}

/**
 * Build `Provider.Model` entries for a batch of dynamically-discovered model IDs.
 *
 * When `database` is provided, each model ID is looked up in models.dev
 * to enrich its capabilities. Unrecognized IDs get sensible defaults.
 */
export function buildDynamicModels(
  ids: string[],
  providerID: ProviderID,
  npm: string,
  baseUrl: string,
  database?: Record<string, Provider.Info>,
): Record<string, Provider.Model> {
  const models: Record<string, Provider.Model> = {}
  for (const id of ids) {
    models[id] = buildDynamicModel(id, providerID, npm, baseUrl, database)
  }
  return models
}
