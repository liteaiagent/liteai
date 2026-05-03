import path from "node:path"
import { Global } from "@liteai/core/global/index"
import { Provider } from "@liteai/core/provider/provider"
import type { Agent } from "@liteai/sdk"
import { Fs as Filesystem } from "@liteai/util/fs"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useMemo } from "react"
import { uniqueBy } from "remeda"
import { useStore } from "zustand"
import { immer } from "zustand/middleware/immer"
import { createStore } from "zustand/vanilla"
import { useAppState } from "../state"
import { useArgs } from "./args"
import { useSDK } from "./sdk"
import { useTheme } from "./theme"
import { useToast } from "./toast"

export type ModelVisibility = "show" | "hide"

export interface LocalState {
  agent: {
    current: string
  }
  model: {
    ready: boolean
    model: Record<string, { providerID: string; modelID: string }>
    recent: { providerID: string; modelID: string }[]
    favorite: { providerID: string; modelID: string }[]
    variant: Record<string, string | undefined>
    visibility: { providerID: string; modelID: string; state: ModelVisibility }[]
  }
}

export interface LocalActions {
  agent: {
    list: () => Agent[]
    current: () => Agent | undefined
    set: (name: string) => void
    move: (direction: 1 | -1) => void
    color: (name: string) => string
  }
  model: {
    current: () => { providerID: string; modelID: string } | undefined
    ready: boolean
    recent: () => { providerID: string; modelID: string }[]
    favorite: () => { providerID: string; modelID: string }[]
    parsed: () => { provider: string; model: string; reasoning: boolean }
    cycle: (direction: 1 | -1) => void
    cycleFavorite: (direction: 1 | -1) => void
    set: (model: { providerID: string; modelID: string }, options?: { recent?: boolean }) => void
    toggleFavorite: (model: { providerID: string; modelID: string }) => void
    visible: (model: { providerID: string; modelID: string }) => boolean
    setVisibility: (model: { providerID: string; modelID: string }, state: boolean) => void
    variant: {
      current: () => string | undefined
      list: () => string[]
      set: (value: string | undefined) => void
      cycle: () => void
    }
  }
  mcp: {
    isEnabled: (name: string) => boolean
    toggle: (name: string) => Promise<void>
  }
}

export type LocalContextValue = LocalActions & { ready: boolean }

const LocalContext = createContext<LocalContextValue | undefined>(undefined)

export function useLocal(): LocalContextValue {
  const context = useContext(LocalContext)
  if (!context) throw new Error("useLocal must be used within a LocalProvider")
  return context
}

export function LocalProvider({ children }: { children: React.ReactNode }) {
  const sdk = useSDK()
  const toast = useToast()
  const args = useArgs()
  const { theme } = useTheme()

  const syncProvider = useAppState((s) => s.provider)
  const syncAgent = useAppState((s) => s.agent)
  const syncConfig = useAppState((s) => s.config)
  const syncProviderDefault = useAppState((s) => s.provider_default)
  const syncMcp = useAppState((s) => s.mcp)
  const syncReady = useAppState((s) => s.status !== "loading")

  const store = useMemo(() => {
    return createStore<LocalState>()(
      immer(() => ({
        agent: {
          current: "", // Will be initialized by effect or bootstrap
        },
        model: {
          ready: false,
          model: {},
          recent: [],
          favorite: [],
          variant: {},
          visibility: [],
        },
      })),
    )
  }, [])

  const state = useStore(store)
  const modelFilePath = useMemo(() => path.join(Global.Path.state, "model.json"), [])

  const saveModel = useCallback(() => {
    const s = store.getState().model
    if (!s.ready) return
    Filesystem.writeJson(modelFilePath, {
      recent: s.recent,
      favorite: s.favorite,
      variant: s.variant,
      visibility: s.visibility,
    })
  }, [store, modelFilePath])

  useEffect(() => {
    Filesystem.readJson<{
      recent?: { providerID: string; modelID: string }[]
      favorite?: { providerID: string; modelID: string }[]
      variant?: Record<string, string | undefined>
      visibility?: { providerID: string; modelID: string; state: ModelVisibility }[]
    }>(modelFilePath)
      .then((x) => {
        store.setState((s) => {
          if (Array.isArray(x.recent)) s.model.recent = x.recent
          if (Array.isArray(x.favorite)) s.model.favorite = x.favorite
          if (typeof x.variant === "object" && x.variant !== null) s.model.variant = x.variant
          if (Array.isArray(x.visibility)) s.model.visibility = x.visibility
          s.model.ready = true
        })
      })
      .catch(() => {
        store.setState((s) => {
          s.model.ready = true
        })
      })
  }, [store, modelFilePath])

  const isModelValid = useCallback(
    (model: { providerID: string; modelID: string }) => {
      const provider = syncProvider.find((x) => x.id === model.providerID)
      return !!provider?.models[model.modelID]
    },
    [syncProvider],
  )

  const agents = useMemo(() => syncAgent.filter((x) => x.mode !== "subagent" && !x.hidden), [syncAgent])
  const visibleAgents = useMemo(() => syncAgent.filter((x) => !x.hidden), [syncAgent])

  useEffect(() => {
    if (agents.length > 0 && !state.agent.current) {
      store.setState((s) => {
        s.agent.current = agents[0].name
      })
    }
  }, [agents, state.agent.current, store])

  const colors = useMemo(
    () => [theme.secondary, theme.accent, theme.success, theme.warning, theme.primary, theme.error, theme.info],
    [theme],
  )

  const fallbackModel = useMemo(() => {
    if (args.model) {
      const { providerID, modelID } = Provider.parseModel(args.model)
      if (isModelValid({ providerID, modelID })) return { providerID, modelID }
    }

    if (syncConfig.model) {
      const { providerID, modelID } = Provider.parseModel(syncConfig.model as unknown as string)
      if (isModelValid({ providerID, modelID })) return { providerID, modelID }
    }

    for (const item of state.model.recent) {
      if (isModelValid(item)) return item
    }

    const provider = syncProvider[0]
    if (!provider) return undefined
    const defaultModel = syncProviderDefault[provider.id]
    const firstModel = Object.values(provider.models)[0]
    const modelID = defaultModel ?? firstModel?.id
    if (!modelID) return undefined
    return { providerID: provider.id, modelID }
  }, [args.model, syncConfig.model, syncProvider, syncProviderDefault, state.model.recent, isModelValid])

  const currentAgent = useMemo(() => {
    return agents.find((x) => x.name === state.agent.current) ?? agents[0]
  }, [agents, state.agent.current])

  const currentModel = useMemo(() => {
    const a = currentAgent
    if (!a) return fallbackModel

    const agentModel = state.model.model[a.name]
    if (agentModel && isModelValid(agentModel)) return agentModel

    if (a.model && isModelValid(a.model)) return a.model

    return fallbackModel
  }, [currentAgent, state.model.model, fallbackModel, isModelValid])

  // Sync agent model changes
  useEffect(() => {
    if (currentAgent?.model && isModelValid(currentAgent.model)) {
      const m = currentAgent.model
      store.setState((s) => {
        s.model.model[currentAgent.name] = { providerID: m.providerID, modelID: m.modelID }
      })
    }
  }, [currentAgent, isModelValid, store])

  const actions: LocalActions = {
    agent: {
      list: () => agents,
      current: () => currentAgent,
      set: (name: string) => {
        if (!agents.some((x) => x.name === name)) {
          return toast.show({ variant: "warning", message: `Agent not found: ${name}` })
        }
        store.setState((s) => {
          s.agent.current = name
        })
      },
      move: (direction: 1 | -1) => {
        const index = agents.findIndex((x) => x.name === state.agent.current)
        let next = index + direction
        if (next < 0) next = agents.length - 1
        if (next >= agents.length) next = 0
        const value = agents[next]
        if (value)
          store.setState((s) => {
            s.agent.current = value.name
          })
      },
      color: (name: string) => {
        const index = visibleAgents.findIndex((x) => x.name === name)
        if (index === -1) return colors[0]
        const a = visibleAgents[index]
        if (a?.color) {
          if (a.color.startsWith("#")) return a.color
          return theme[a.color as keyof typeof theme] as string
        }
        return colors[index % colors.length]
      },
    },
    model: {
      current: () => currentModel,
      ready: state.model.ready,
      recent: () => state.model.recent,
      favorite: () => state.model.favorite,
      parsed: () => {
        if (!currentModel) {
          return { provider: "Connect a provider", model: "No provider selected", reasoning: false }
        }
        const provider = syncProvider.find((x) => x.id === currentModel.providerID)
        const info = provider?.models[currentModel.modelID]
        return {
          provider: provider?.name ?? currentModel.providerID,
          model: info?.name ?? currentModel.modelID,
          reasoning: !!info?.reasoning,
        }
      },
      cycle: (direction: 1 | -1) => {
        if (!currentModel) return
        const recent = state.model.recent
        const index = recent.findIndex(
          (x) => x.providerID === currentModel.providerID && x.modelID === currentModel.modelID,
        )
        if (index === -1) return
        let next = index + direction
        if (next < 0) next = recent.length - 1
        if (next >= recent.length) next = 0
        const val = recent[next]
        if (val)
          store.setState((s) => {
            s.model.model[currentAgent.name] = { ...val }
          })
      },
      cycleFavorite: (direction: 1 | -1) => {
        const favorites = state.model.favorite.filter((item) => isModelValid(item))
        if (!favorites.length) {
          return toast.show({ variant: "info", message: "Add a favorite model to use this shortcut" })
        }
        let index = currentModel
          ? favorites.findIndex((x) => x.providerID === currentModel.providerID && x.modelID === currentModel.modelID)
          : -1
        if (index === -1) {
          index = direction === 1 ? 0 : favorites.length - 1
        } else {
          index = (index + direction + favorites.length) % favorites.length
        }
        const next = favorites[index]
        if (next) {
          store.setState((s) => {
            s.model.model[currentAgent.name] = { ...next }
            const uniq = uniqueBy([next, ...s.model.recent], (x) => `${x.providerID}/${x.modelID}`)
            if (uniq.length > 10) uniq.pop()
            s.model.recent = uniq
          })
          saveModel()
        }
      },
      set: (m: { providerID: string; modelID: string }, options?: { recent?: boolean }) => {
        if (!isModelValid(m)) {
          return toast.show({ variant: "warning", message: `Model ${m.providerID}/${m.modelID} is not valid` })
        }
        store.setState((s) => {
          s.model.model[currentAgent.name] = m
          if (options?.recent) {
            const uniq = uniqueBy([m, ...s.model.recent], (x) => `${x.providerID}/${x.modelID}`)
            if (uniq.length > 10) uniq.pop()
            s.model.recent = uniq
          }
        })
        if (options?.recent) saveModel()
      },
      toggleFavorite: (m: { providerID: string; modelID: string }) => {
        if (!isModelValid(m)) {
          return toast.show({ variant: "warning", message: `Model ${m.providerID}/${m.modelID} is not valid` })
        }
        store.setState((s) => {
          const exists = s.model.favorite.some((x) => x.providerID === m.providerID && x.modelID === m.modelID)
          if (exists) {
            s.model.favorite = s.model.favorite.filter((x) => x.providerID !== m.providerID || x.modelID !== m.modelID)
          } else {
            s.model.favorite.unshift(m)
          }
        })
        saveModel()
      },
      visible: (m: { providerID: string; modelID: string }) => {
        const entry = state.model.visibility.find((x) => x.providerID === m.providerID && x.modelID === m.modelID)
        if (!entry) return true
        return entry.state === "show"
      },
      setVisibility: (m: { providerID: string; modelID: string }, visible: boolean) => {
        store.setState((s) => {
          const index = s.model.visibility.findIndex((x) => x.providerID === m.providerID && x.modelID === m.modelID)
          const newState: ModelVisibility = visible ? "show" : "hide"
          if (index >= 0) {
            s.model.visibility[index].state = newState
          } else {
            s.model.visibility.push({ ...m, state: newState })
          }
        })
        saveModel()
      },
      variant: {
        current: () => {
          if (!currentModel) return undefined
          return state.model.variant[`${currentModel.providerID}/${currentModel.modelID}`]
        },
        list: () => {
          if (!currentModel) return []
          const provider = syncProvider.find((x) => x.id === currentModel.providerID)
          const info = provider?.models[currentModel.modelID]
          return info?.variants ? Object.keys(info.variants) : []
        },
        set: (value: string | undefined) => {
          if (!currentModel) return
          const key = `${currentModel.providerID}/${currentModel.modelID}`
          store.setState((s) => {
            s.model.variant[key] = value
          })
          saveModel()
        },
        cycle: () => {
          const variants = actions.model.variant.list()
          if (variants.length === 0) return
          const current = actions.model.variant.current()
          if (!current) return actions.model.variant.set(variants[0])
          const index = variants.indexOf(current)
          actions.model.variant.set(index === -1 || index === variants.length - 1 ? undefined : variants[index + 1])
        },
      },
    },
    mcp: {
      isEnabled: (name: string) => syncMcp[name]?.status === "connected",
      toggle: async (name: string) => {
        const s = syncMcp[name]
        if (s?.status === "connected") {
          await sdk.client.project.mcp.disconnect({ projectID: sdk.projectID, name })
        } else {
          await sdk.client.project.mcp.connect({ projectID: sdk.projectID, name })
        }
      },
    },
  }

  const value = useMemo(
    () => ({
      ...state,
      ...actions,
      ready: state.model.ready && syncReady,
    }),
    [state, actions, syncReady],
  )

  return <LocalContext.Provider value={value}>{children}</LocalContext.Provider>
}
