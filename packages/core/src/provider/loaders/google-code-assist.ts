import { Auth } from "@/auth"
import { CA_CLIENT_ID, CA_CLIENT_SECRET } from "@/auth/providers/code-assist"
import { Log } from "@/util/log"
import type { Provider } from "../provider"
import { ModelID, ProviderID } from "../schema"
import { CA_ENDPOINT, fetchAvailableModels as clientFetchModels } from "../sdk/code-assist/client"
import type { LoaderResult, SDK } from "./types"
import { useLanguageModel } from "./types"

const log = Log.create({ service: "loader.google-code-assist" })

/** Fallback model IDs used when the fetchAvailableModels endpoint is unreachable. */
const FALLBACK_MODEL_IDS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
]

/**
 * Fetch available model IDs from the Code Assist API.
 * Uses the stored OAuth credentials to authenticate via the Code Assist client.
 */
async function fetchAvailableModels(): Promise<string[] | undefined> {
  const auth = await Auth.get("google-code-assist")
  if (!auth || auth.type !== "oauth") return undefined

  try {
    const { OAuth2Client } = await import("google-auth-library")
    const client = new OAuth2Client({
      clientId: CA_CLIENT_ID,
      clientSecret: CA_CLIENT_SECRET,
    })
    client.setCredentials({
      access_token: auth.access,
      refresh_token: auth.refresh,
      expiry_date: auth.expires,
    })

    // Listen for token refreshes triggered during model fetch
    client.on("tokens", async (tokens) => {
      const current = await Auth.get("google-code-assist")
      if (current?.type === "oauth") {
        await Auth.set("google-code-assist", {
          ...current,
          refresh: tokens.refresh_token || current.refresh,
          access: tokens.access_token || current.access,
          expires: tokens.expiry_date ?? Date.now() + 3600 * 1000,
        })
      }
    })

    const res = await clientFetchModels({ client })

    const models = res.models
    if (!models || !Array.isArray(models)) {
      log.warn("fetchAvailableModels returned unexpected shape", { data: res })
      return undefined
    }

    const ids = models.map((m) => m.model ?? "").filter(Boolean)
    log.info("fetched available models from Code Assist API", { count: ids.length, models: ids })
    return ids.length > 0 ? ids : undefined
  } catch (err) {
    log.warn("failed to fetch available models from Code Assist API, using fallback", { error: err })
    return undefined
  }
}

export async function googleCodeAssist(
  _input: unknown /* unused: required by CustomLoader interface */,
  database: Record<string, Provider.Info>,
): Promise<LoaderResult> {
  // Fetch model IDs from the API, falling back to hardcoded list
  const modelIds = (await fetchAvailableModels()) ?? FALLBACK_MODEL_IDS

  // Build Provider.Model entries using models.dev data for capabilities
  const models: Record<string, Provider.Model> = {}
  for (const id of modelIds) {
    models[id] = buildCodeAssistModel(id, database)
  }

  return {
    autoload: false,
    models,
    async getModel(sdk: SDK, modelID: string) {
      if (useLanguageModel(sdk)) return sdk.languageModel(modelID)
      return sdk.chat?.(modelID)
    },
    options: {},
  }
}

/** Build a Code Assist model entry, looking up capabilities from the google provider in models.dev. */
function buildCodeAssistModel(id: string, database: Record<string, Provider.Info>): Provider.Model {
  const pid = ProviderID.make("google-code-assist")
  const google = database.google
  const fallback: Pick<Provider.Model, "limit" | "capabilities" | "cost" | "release_date"> = {
    limit: { context: 1048576, output: 65536 },
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    release_date: "",
  }
  // Strip suffixes like "-customtools" to find the base model in google's data
  const base = id.replace(/-customtools$/, "")
  const ref = google?.models[base]
  return {
    id: ModelID.make(id),
    providerID: pid,
    name: ref?.name ?? id,
    family: ref?.family ?? "gemini",
    status: ref?.status ?? "active",
    headers: {},
    options: {},
    api: {
      id,
      npm: "@ai-sdk/google-code-assist",
      url: CA_ENDPOINT,
    },
    capabilities: ref?.capabilities ?? fallback.capabilities,
    limit: ref?.limit ?? fallback.limit,
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    release_date: ref?.release_date ?? fallback.release_date,
    variants: {},
  }
}
