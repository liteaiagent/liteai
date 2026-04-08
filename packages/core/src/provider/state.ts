import type { LanguageModelV2 } from "@ai-sdk/provider"
import type { Provider as AiProvider } from "ai"
import { mapValues, mergeDeep, omit, pickBy } from "remeda"
import { iife } from "@/util/iife"
import { Auth } from "../auth"
import { AUTH_PROVIDERS } from "../auth/registry"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { Instance } from "../project/instance"
import { lazy } from "../util/lazy"
import { Log } from "../util/log"
import { CUSTOM_LOADERS, type ModelLoader, type VarsLoader } from "./loaders"
import { ModelsDev } from "./models"
import type { Provider } from "./provider"
import { ModelID, ProviderID } from "./schema"
import { ProviderTransform } from "./transform"

const log = Log.create({ service: "provider" })

function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Provider.Model {
  const m: Provider.Model = {
    id: ModelID.make(model.id),
    providerID: ProviderID.make(provider.id),
    name: model.name,
    family: model.family,
    api: {
      id: model.id,
      url: model.provider?.api ?? provider.api ?? "",
      npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
    },
    status: model.status ?? "active",
    headers: model.headers ?? {},
    options: model.options ?? {},
    cost: {
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
      cache: {
        read: model.cost?.cache_read ?? 0,
        write: model.cost?.cache_write ?? 0,
      },
      experimentalOver200K: model.cost?.context_over_200k
        ? {
            cache: {
              read: model.cost.context_over_200k.cache_read ?? 0,
              write: model.cost.context_over_200k.cache_write ?? 0,
            },
            input: model.cost.context_over_200k.input,
            output: model.cost.context_over_200k.output,
          }
        : undefined,
    },
    limit: {
      context: model.limit.context,
      input: model.limit.input,
      output: model.limit.output,
    },
    capabilities: {
      temperature: model.temperature,
      reasoning: model.reasoning,
      attachment: model.attachment,
      toolcall: model.tool_call,
      input: {
        text: model.modalities?.input?.includes("text") ?? false,
        audio: model.modalities?.input?.includes("audio") ?? false,
        image: model.modalities?.input?.includes("image") ?? false,
        video: model.modalities?.input?.includes("video") ?? false,
        pdf: model.modalities?.input?.includes("pdf") ?? false,
      },
      output: {
        text: model.modalities?.output?.includes("text") ?? false,
        audio: model.modalities?.output?.includes("audio") ?? false,
        image: model.modalities?.output?.includes("image") ?? false,
        video: model.modalities?.output?.includes("video") ?? false,
        pdf: model.modalities?.output?.includes("pdf") ?? false,
      },
      interleaved: model.interleaved ?? false,
    },
    release_date: model.release_date,
    variants: {},
  }

  m.variants = mapValues(ProviderTransform.variants(m), (v) => v)

  return m
}

export function fromModelsDevProvider(provider: ModelsDev.Provider): Provider.Info {
  return {
    id: ProviderID.make(provider.id),
    source: "custom",
    name: provider.name,
    env: provider.env ?? [],
    options: {},
    models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
  }
}

function registerCopilotEnterprise(database: Record<string, Provider.Info>) {
  if (!database["github-copilot"]) return
  const copilot = database["github-copilot"]
  database["github-copilot-enterprise"] = {
    ...copilot,
    id: ProviderID.githubCopilotEnterprise,
    name: "GitHub Copilot Enterprise",
    models: mapValues(copilot.models, (model) => ({
      ...model,
      providerID: ProviderID.githubCopilotEnterprise,
    })),
  }
}

function registerCodeAssist(database: Record<string, Provider.Info>) {
  const pid = ProviderID.make("google-code-assist")
  database["google-code-assist"] = {
    id: pid,
    name: "Google Code Assist",
    env: [],
    options: {},
    source: "api",
    models: {},
  }
}

function registerAi4all(database: Record<string, Provider.Info>) {
  const pid = ProviderID.make("ai4all")
  database.ai4all = {
    id: pid,
    name: "AI4ALL",
    env: ["AI4ALL_API_KEY"],
    options: {},
    source: "env",
    models: {},
  }
}

function mergeConfigModels(
  database: Record<string, Provider.Info>,
  configProviders: [string, NonNullable<Awaited<ReturnType<typeof Config.get>>["provider"]>[string]][],
  modelsDev: Record<string, ModelsDev.Provider>,
) {
  for (const [providerID, provider] of configProviders) {
    const existing = database[providerID]
    const parsed: Provider.Info = {
      id: ProviderID.make(providerID),
      name: provider.name ?? existing?.name ?? providerID,
      env: provider.env ?? existing?.env ?? [],
      options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
      source: "config",
      models: existing?.models ?? {},
    }

    for (const [modelID, model] of Object.entries(provider.models ?? {})) {
      const existingModel = parsed.models[model.id ?? modelID]
      const name = iife(() => {
        if (model.name) return model.name
        if (model.id && model.id !== modelID) return modelID
        return existingModel?.name ?? modelID
      })
      const parsedModel: Provider.Model = {
        id: ModelID.make(modelID),
        api: {
          id: model.id ?? existingModel?.api.id ?? modelID,
          npm:
            model.provider?.npm ??
            provider.npm ??
            existingModel?.api.npm ??
            modelsDev[providerID]?.npm ??
            "@ai-sdk/openai-compatible",
          url: model.provider?.api ?? provider?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api,
        },
        status: model.status ?? existingModel?.status ?? "active",
        name,
        providerID: ProviderID.make(providerID),
        capabilities: {
          temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
          reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
          attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
          toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
          input: {
            text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities.input.text ?? true,
            audio: model.modalities?.input?.includes("audio") ?? existingModel?.capabilities.input.audio ?? false,
            image: model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false,
            video: model.modalities?.input?.includes("video") ?? existingModel?.capabilities.input.video ?? false,
            pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities.input.pdf ?? false,
          },
          output: {
            text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities.output.text ?? true,
            audio: model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
            image: model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
            video: model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
            pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
          },
          interleaved: model.interleaved ?? false,
        },
        cost: {
          input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
          output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
          cache: {
            read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
            write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
          },
        },
        options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
        limit: {
          context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
          output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
        },
        headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
        family: model.family ?? existingModel?.family ?? "",
        release_date: model.release_date ?? existingModel?.release_date ?? "",
        variants: {},
      }
      const merged = mergeDeep(ProviderTransform.variants(parsedModel), model.variants ?? {})
      parsedModel.variants = mapValues(
        pickBy(merged, (v) => !v.disabled),
        (v) => omit(v, ["disabled"]),
      )
      parsed.models[modelID] = parsedModel
    }
    database[providerID] = parsed
  }
}

async function loadEnvAuth(
  database: Record<string, Provider.Info>,
  disabled: Set<string>,
  merge: (id: ProviderID, patch: Partial<Provider.Info>) => void,
  env: Record<string, string | undefined>,
) {
  for (const [id, provider] of Object.entries(database)) {
    const providerID = ProviderID.make(id)
    if (disabled.has(providerID)) continue
    const apiKey = provider.env.map((item) => env[item]).find(Boolean)
    if (!apiKey) continue
    merge(providerID, {
      source: "env",
      key: provider.env.length === 1 ? apiKey : undefined,
    })
  }

  for (const [id, provider] of Object.entries(await Auth.all())) {
    const providerID = ProviderID.make(id)
    if (disabled.has(providerID)) continue
    if (provider.type === "api") {
      merge(providerID, {
        source: "api",
        key: provider.key,
      })
    }
  }
}

async function loadPlugins(
  database: Record<string, Provider.Info>,
  providers: Record<string, Provider.Info>,
  disabled: Set<string>,
  merge: (id: ProviderID, patch: Partial<Provider.Info>) => void,
) {
  for (const [id, provider] of AUTH_PROVIDERS) {
    const providerID = ProviderID.make(id)
    if (disabled.has(providerID)) {
      log.info("auth plugin skipped (disabled)", { providerID })
      continue
    }

    // For github-copilot, check if auth exists for either github-copilot or github-copilot-enterprise
    let hasAuth = false
    const auth = await Auth.get(providerID)
    if (auth) hasAuth = true

    // Special handling for github-copilot: also check for enterprise auth
    if (providerID === ProviderID.githubCopilot && !hasAuth) {
      const enterpriseAuth = await Auth.get("github-copilot-enterprise")
      if (enterpriseAuth) hasAuth = true
    }

    if (!hasAuth) {
      log.info("auth plugin skipped (no credentials)", { providerID })
      continue
    }
    if (!provider.auth.loader) {
      log.info("auth plugin skipped (no loader)", { providerID })
      continue
    }

    log.info("running auth plugin", { providerID })

    // Load for the main provider if auth exists
    if (auth) {
      // biome-ignore lint/suspicious/noExplicitAny: auth getter returns different shapes per provider
      const options = await provider.auth.loader(() => Auth.get(providerID) as any, database[id])
      const opts = options ?? {}
      const patch: Partial<Provider.Info> = providers[providerID] ? { options: opts } : { source: "api", options: opts }
      merge(providerID, patch)
      log.info("auth plugin loaded", { providerID })
    }

    // If this is github-copilot, also register for github-copilot-enterprise if auth exists
    if (providerID === ProviderID.githubCopilot) {
      const enterpriseProviderID = ProviderID.githubCopilotEnterprise
      if (!disabled.has(enterpriseProviderID)) {
        const enterpriseAuth = await Auth.get(enterpriseProviderID)
        if (enterpriseAuth) {
          log.info("running auth plugin (enterprise)", { providerID: enterpriseProviderID })
          const enterpriseOptions = await provider.auth.loader(
            // biome-ignore lint/suspicious/noExplicitAny: auth getter returns different shapes per provider
            () => Auth.get(enterpriseProviderID) as any,
            database[enterpriseProviderID],
          )
          const opts = enterpriseOptions ?? {}
          const patch: Partial<Provider.Info> = providers[enterpriseProviderID]
            ? { options: opts }
            : { source: "api", options: opts }
          merge(enterpriseProviderID, patch)
          log.info("auth plugin loaded (enterprise)", { providerID: enterpriseProviderID })
        }
      }
    }
  }
}

async function loadCustom(
  database: Record<string, Provider.Info>,
  providers: Record<string, Provider.Info>,
  disabled: Set<string>,
  merge: (id: ProviderID, patch: Partial<Provider.Info>) => void,
  modelLoaders: Record<string, ModelLoader>,
  varsLoaders: Record<string, VarsLoader>,
) {
  for (const [id, fn] of Object.entries(CUSTOM_LOADERS)) {
    const providerID = ProviderID.make(id)
    if (disabled.has(providerID)) continue
    const data = database[providerID]
    if (!data) {
      log.error(`Provider does not exist in model list ${providerID}`)
      continue
    }
    const result = await fn(data, database).catch((err) => {
      // Custom loaders may call Env.get / Config.get which require Instance context.
      // When resolving the global provider list (no project selected), skip them gracefully.
      log.debug("custom loader skipped (no instance context)", { providerID, err })
      return undefined
    })
    if (result && (result.autoload || providers[providerID])) {
      if (result.getModel) modelLoaders[providerID] = result.getModel
      if (result.vars) varsLoaders[providerID] = result.vars
      // If the loader provides a model list, merge into the database entry.
      // Loader models are set first; any config-defined models override for same IDs.
      let mergedModels: Record<string, Provider.Model> | undefined
      if (result.models && Object.keys(result.models).length > 0) {
        const existingModels = database[providerID].models
        mergedModels = { ...result.models, ...existingModels }
        database[providerID] = {
          ...database[providerID],
          models: mergedModels,
        }
        log.info("loader provided models", { providerID, count: Object.keys(result.models).length })
      }
      const opts = result.options ?? {}
      const patch: Partial<Provider.Info> = providers[providerID]
        ? { options: opts, ...(mergedModels && { models: mergedModels }) }
        : { source: data.source ?? "custom", options: opts }
      merge(providerID, patch)
    }
  }
}

function filterProviders(
  providers: Record<string, Provider.Info>,
  config: Awaited<ReturnType<typeof Config.get>>,
  allowed: (id: ProviderID) => boolean,
) {
  for (const [id, provider] of Object.entries(providers)) {
    const providerID = ProviderID.make(id)
    if (!allowed(providerID)) {
      delete providers[providerID]
      continue
    }

    const configProvider = config.provider?.[providerID]

    for (const [modelID, model] of Object.entries(provider.models)) {
      model.api.id = model.api.id ?? model.id ?? modelID
      if (modelID === "gpt-5-chat-latest" || (providerID === ProviderID.openrouter && modelID === "openai/gpt-5-chat"))
        delete provider.models[modelID]
      if (model.status === "alpha" && !Flag.LITEAI_ENABLE_ALPHA_MODELS) delete provider.models[modelID]
      if (model.status === "deprecated") delete provider.models[modelID]
      if (
        configProvider?.blacklist?.includes(modelID) ||
        (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
      )
        delete provider.models[modelID]

      model.variants = mapValues(ProviderTransform.variants(model), (v) => v)

      // Filter out disabled variants from config
      const configVariants = configProvider?.models?.[modelID]?.variants
      if (configVariants && model.variants) {
        const merged = mergeDeep(model.variants, configVariants)
        model.variants = mapValues(
          pickBy(merged, (v) => !v.disabled),
          (v) => omit(v, ["disabled"]),
        )
      }
    }

    if (Object.keys(provider.models).length === 0) {
      delete providers[providerID]
      continue
    }

    log.info("found", { providerID })
  }
}

async function resolveProviders(
  config: Awaited<ReturnType<typeof Config.get>>,
  env: Record<string, string | undefined>,
) {
  using _ = log.time("state")
  const modelsDev = await ModelsDev.get()
  const database: Record<string, Provider.Info> = mapValues(modelsDev, fromModelsDevProvider)

  // Provider filtering uses the provided config (which may be global or project-specific depending on context)
  const disabled = new Set(config.disabled_providers ?? [])
  const enabled = config.enabled_providers ? new Set(config.enabled_providers) : null

  function allowed(providerID: ProviderID): boolean {
    if (enabled && !enabled.has(providerID)) return false
    if (disabled.has(providerID)) return false
    return true
  }

  const providers: Record<string, Provider.Info> = {}
  const languages = new Map<string, LanguageModelV2>()
  const modelLoaders: Record<string, ModelLoader> = {}
  const varsLoaders: Record<string, VarsLoader> = {}
  const sdk = new Map<string, AiProvider>()

  log.info("init")

  const configProviders = Object.entries(config.provider ?? {})

  registerCopilotEnterprise(database)
  registerCodeAssist(database)
  registerAi4all(database)

  function merge(providerID: ProviderID, provider: Partial<Provider.Info>) {
    const existing = providers[providerID]
    if (existing) {
      // @ts-expect-error
      providers[providerID] = mergeDeep(existing, provider)
      return
    }
    const match = database[providerID]
    if (!match) return
    // @ts-expect-error
    providers[providerID] = mergeDeep(match, provider)
  }

  mergeConfigModels(database, configProviders, modelsDev)

  await loadEnvAuth(database, disabled, merge, env)
  await loadPlugins(database, providers, disabled, merge)
  await loadCustom(database, providers, disabled, merge, modelLoaders, varsLoaders)

  // load config overrides
  for (const [id, provider] of configProviders) {
    const providerID = ProviderID.make(id)
    const partial: Partial<Provider.Info> = { source: "config" }
    if (provider.env) partial.env = provider.env
    if (provider.name) partial.name = provider.name
    if (provider.options) partial.options = provider.options
    merge(providerID, partial)
  }

  filterProviders(providers, config, allowed)

  return {
    models: languages,
    providers,
    sdk,
    modelLoaders,
    varsLoaders,
  }
}

/** Global provider state — uses global config only, no Instance/directory context required. */
export const globalState = lazy(async () => {
  const config = await Config.getGlobal()
  return resolveProviders(config, { ...process.env })
})

/** Per-project provider state — merges global + project config. */
export const state = Instance.state(async () => {
  const { Env } = await import("../env")
  const config = await Config.get()
  return resolveProviders(config, Env.all())
})
