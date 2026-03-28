import type { LanguageModelV2 } from "@ai-sdk/provider"
import { NamedError } from "@liteai/util/error"
import { type Provider as AiProvider, NoSuchModelError } from "ai"
import z from "zod"
import { iife } from "@/util/iife"
import { BunProc } from "../bun"
import { Env } from "../env"
import { Hash } from "../util/hash"
import { Log } from "../util/log"
import { BUNDLED_PROVIDERS } from "./loaders"
import type { ModelLoader, SDK } from "./loaders/types"
import type { Provider } from "./provider"
import { ModelID, ProviderID } from "./schema"
import { wrapSSE } from "./sse"

const DEFAULT_CHUNK_TIMEOUT = 300_000
const log = Log.create({ service: "provider.sdk" })

/** Truncate long string values inside a JSON body while preserving structure. */
function compact(json: string, limit = 300): string {
  function walk(val: unknown): unknown {
    if (typeof val === "string")
      return val.length > limit ? `${val.slice(0, limit)}...[${val.length - limit} chars truncated]` : val
    if (Array.isArray(val)) return val.map(walk)
    if (val && typeof val === "object")
      return Object.fromEntries(Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, walk(v)]))
    return val
  }
  try {
    return JSON.stringify(walk(JSON.parse(json)))
  } catch {
    return json
  }
}

interface State {
  models: Map<string, LanguageModelV2>
  providers: { [id: string]: Provider.Info }
  sdk: Map<string, AiProvider>
  modelLoaders: { [id: string]: ModelLoader }
  varsLoaders: { [id: string]: (options: Record<string, unknown>) => Record<string, string> }
}

export async function getSDK(model: Provider.Model, s: State) {
  try {
    using _ = log.time("getSDK", {
      providerID: model.providerID,
    })
    const provider = s.providers[model.providerID]
    const options = { ...provider.options }

    if (model.providerID === "google-vertex" && !model.api.npm.includes("@ai-sdk/openai-compatible")) {
      delete options.fetch
    }

    if (model.api.npm.includes("@ai-sdk/openai-compatible") && options.includeUsage !== false) {
      options.includeUsage = true
    }

    const baseURL = iife(() => {
      let url = typeof options.baseURL === "string" && options.baseURL !== "" ? options.baseURL : model.api.url
      if (!url) return

      // some models/providers have variable urls, ex: "https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1"
      // We track this in models.dev, and then when we are resolving the baseURL
      // we need to string replace that literal: "${AZURE_RESOURCE_NAME}"
      const loader = s.varsLoaders[model.providerID]
      if (loader) {
        const vars = loader(options)
        for (const [key, value] of Object.entries(vars)) {
          const field = `\${${key}}`
          url = url.replaceAll(field, value)
        }
      }

      url = url.replace(/\$\{([^}]+)\}/g, (item, key) => {
        const val = Env.get(String(key))
        return val ?? item
      })
      return url
    })

    if (baseURL !== undefined) options.baseURL = baseURL
    if (options.apiKey === undefined && provider.key) options.apiKey = provider.key
    if (model.headers)
      options.headers = {
        ...options.headers,
        ...model.headers,
      }

    const key = Hash.fast(JSON.stringify({ providerID: model.providerID, npm: model.api.npm, options }))
    const existing = s.sdk.get(key)
    if (existing) return existing

    const customFetch = options.fetch
    const chunkTimeout = options.chunkTimeout || DEFAULT_CHUNK_TIMEOUT
    delete options.chunkTimeout

    const http = Log.create({ service: "http" })

    options.fetch = async (input: unknown, init?: BunFetchRequestInit) => {
      // Preserve custom fetch if it exists, wrap it with timeout logic
      const fetchFn = customFetch ?? fetch
      const opts = init ?? {}
      const chunkAbortCtl = typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined
      const signals: AbortSignal[] = []

      if (opts.signal) signals.push(opts.signal)
      if (chunkAbortCtl) signals.push(chunkAbortCtl.signal)
      if (options.timeout !== undefined && options.timeout !== null && options.timeout !== false)
        signals.push(AbortSignal.timeout(options.timeout))

      const combined = signals.length === 0 ? null : signals.length === 1 ? signals[0] : AbortSignal.any(signals)
      if (combined) opts.signal = combined

      // Strip openai itemId metadata following what codex does
      // Codex uses #[serde(skip_serializing)] on id fields for all item types:
      // Message, Reasoning, FunctionCall, LocalShellCall, CustomToolCall, WebSearchCall
      // IDs are only re-attached for Azure with store=true
      if (model.api.npm === "@ai-sdk/openai" && opts.body && opts.method === "POST") {
        const body = JSON.parse(opts.body as string)
        const isAzure = model.providerID.includes("azure")
        const keepIds = isAzure && body.store === true
        if (!keepIds && Array.isArray(body.input)) {
          for (const item of body.input) {
            if ("id" in item) {
              delete item.id
            }
          }
          opts.body = JSON.stringify(body)
        }
      }

      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url
      const body = typeof opts.body === "string" ? opts.body : undefined
      // Extract actual model from request body; the closure's model.id may be stale
      // because SDK instances are cached per provider, not per model
      const mid = body?.match(/"model"\s*:\s*"([^"]+)"/)?.[1] ?? model.id
      http.info("request", {
        provider: model.providerID,
        model: mid,
        method: opts.method ?? "GET",
        url,
        headers: opts.headers,
        body: body ? compact(body) : undefined,
      })

      const res = await fetchFn(input, {
        ...opts,
        timeout: false,
      })

      if (!res.ok) {
        let text: string | undefined
        try {
          const clone = res.clone()
          const raw = await clone.text()
          text = compact(raw)
        } catch {}
        http.error("response", {
          provider: model.providerID,
          model: mid,
          status: res.status,
          statusText: res.statusText,
          url,
          headers: Object.fromEntries(res.headers.entries()),
          body: text,
        })
        log.error("fetch failed", {
          status: res.status,
          statusText: res.statusText,
          url,
          providerID: model.providerID,
          modelID: mid,
        })
      } else {
        const clone = res.clone()
        clone
          .text()
          .then((raw: string) => {
            http.info("response", {
              provider: model.providerID,
              model: mid,
              status: res.status,
              url,
              headers: Object.fromEntries(res.headers.entries()),
              body: compact(raw),
            })
          })
          .catch(() => {
            http.info("response", {
              provider: model.providerID,
              model: mid,
              status: res.status,
              url,
              headers: Object.fromEntries(res.headers.entries()),
            })
          })
      }

      if (!chunkAbortCtl) return res
      return wrapSSE(res, chunkTimeout, chunkAbortCtl)
    }

    const bundledFn = BUNDLED_PROVIDERS[model.api.npm]
    if (bundledFn) {
      log.info("using bundled provider", { providerID: model.providerID, pkg: model.api.npm })
      const loaded = bundledFn({
        name: model.providerID,
        ...options,
      })
      s.sdk.set(key, loaded as AiProvider)
      return loaded as AiProvider
    }

    let installedPath: string
    if (!model.api.npm.startsWith("file://")) {
      installedPath = await BunProc.install(model.api.npm, "latest")
    } else {
      log.info("loading local provider", { pkg: model.api.npm })
      installedPath = model.api.npm
    }

    const mod = await import(installedPath)

    const entry = Object.keys(mod).find((k) => k.startsWith("create"))
    if (!entry) throw new InitError({ providerID: model.providerID })
    const loaded = mod[entry]({
      name: model.providerID,
      ...options,
    })
    s.sdk.set(key, loaded as AiProvider)
    return loaded as AiProvider
  } catch (e) {
    log.error("provider init failed", { error: e, providerID: model.providerID })
    throw new InitError({ providerID: model.providerID }, { cause: e })
  }
}

export async function getLanguage(model: Provider.Model, s: State): Promise<LanguageModelV2> {
  const key = `${model.providerID}/${model.id}`
  const cached = s.models.get(key)
  if (cached) return cached

  const provider = s.providers[model.providerID]
  const sdk = await getSDK(model, s)

  try {
    const language = s.modelLoaders[model.providerID]
      ? await s.modelLoaders[model.providerID](sdk as unknown as SDK, model.api.id, provider.options)
      : (sdk.languageModel(model.api.id) as LanguageModelV2)
    if (!language)
      throw new ModelNotFoundError({
        modelID: model.id,
        providerID: model.providerID,
      })
    s.models.set(key, language)
    return language
  } catch (e) {
    if (e instanceof NoSuchModelError)
      throw new ModelNotFoundError(
        {
          modelID: model.id,
          providerID: model.providerID,
        },
        { cause: e },
      )
    throw e
  }
}

export const ModelNotFoundError = NamedError.create(
  "ProviderModelNotFoundError",
  z.object({
    providerID: ProviderID.zod,
    modelID: ModelID.zod,
    suggestions: z.array(z.string()).optional(),
  }),
)

export const InitError = NamedError.create(
  "ProviderInitError",
  z.object({
    providerID: ProviderID.zod,
  }),
)
