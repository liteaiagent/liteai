import type { AssistantMessage, Message, Part, ToolPart } from "@liteai/sdk"
import { enableMapSet } from "immer"
import { useEffect, useMemo } from "react"
import { useStore } from "zustand"
import { immer } from "zustand/middleware/immer"
import { createStore } from "zustand/vanilla"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { selectMessages, useAppState } from "../state"

enableMapSet()

export type ModelMetrics = {
  modelID: string
  providerID: string
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  cost: number
  requests: number
}

export type SessionStats = {
  totalTokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  totalCost: number | null // null when provider doesn't expose pricing
  contextUtilization: number // 0.0–1.0, derived from totalTokens / contextLimit
  contextLimit: number // max context tokens for current model (from provider.models[modelID].limit.context)
  turnCount: number // count of assistant messages seen
  toolCalls: {
    total: number
    success: number
    failed: number
  }
  duration: number // session wall-time in ms (Date.now() - firstMessageTime)
  perModel: ModelMetrics[] // per-model breakdown for multi-model sessions
}

interface StatsStoreState {
  totalTokens: SessionStats["totalTokens"]
  totalCost: number
  hasCostData: boolean
  turnCount: number
  toolCalls: SessionStats["toolCalls"]
  createdAt: number
  processedMessageIDs: Set<string>
  processedToolPartIDs: Set<string>
  perModel: Map<string, ModelMetrics> // key: `${providerID}/${modelID}`
}

export function useSessionStats(sessionID: string): SessionStats {
  const sdk = useSDK()
  const messages = useAppState(selectMessages(sessionID))
  const partsMap = useAppState((s) => s.part)
  const providers = useAppState((s) => s.provider)
  const local = useLocal()

  const store = useMemo(() => {
    const s = createStore<StatsStoreState>()(
      immer(() => ({
        totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        totalCost: 0,
        hasCostData: false,
        turnCount: 0,
        toolCalls: { total: 0, success: 0, failed: 0 },
        createdAt: Date.now(),
        processedMessageIDs: new Set<string>(),
        processedToolPartIDs: new Set<string>(),
        perModel: new Map<string, ModelMetrics>(),
      })),
    )

    function processAssistantMessage(msg: AssistantMessage) {
      s.setState((state) => {
        if (state.processedMessageIDs.has(msg.id)) return
        state.processedMessageIDs.add(msg.id)
        state.totalTokens.input += msg.tokens.input
        state.totalTokens.output += msg.tokens.output
        state.totalTokens.reasoning += msg.tokens.reasoning
        state.totalTokens.cache.read += msg.tokens.cache.read
        state.totalTokens.cache.write += msg.tokens.cache.write
        state.totalCost += msg.cost
        if (msg.cost > 0) state.hasCostData = true
        state.turnCount += 1

        // Per-model accumulation
        const modelKey = `${msg.providerID}/${msg.modelID}`
        const existing = state.perModel.get(modelKey)
        if (existing) {
          existing.tokens.input += msg.tokens.input
          existing.tokens.output += msg.tokens.output
          existing.tokens.reasoning += msg.tokens.reasoning
          existing.tokens.cache.read += msg.tokens.cache.read
          existing.tokens.cache.write += msg.tokens.cache.write
          existing.cost += msg.cost
          existing.requests += 1
        } else {
          state.perModel.set(modelKey, {
            modelID: msg.modelID,
            providerID: msg.providerID,
            tokens: { ...msg.tokens },
            cost: msg.cost,
            requests: 1,
          })
        }
      })
    }

    function processToolPart(part: ToolPart) {
      s.setState((state) => {
        const key = part.id
        // Only count terminal states, and only once
        if (part.state.status === "completed" || part.state.status === "error") {
          if (state.processedToolPartIDs.has(key)) return
          state.processedToolPartIDs.add(key)
          state.toolCalls.total += 1
          if (part.state.status === "completed") state.toolCalls.success += 1
          else state.toolCalls.failed += 1
        }
      })
    }

    // Bootstrap from existing messages already in sync store
    const existingMessages = messages
    for (const msg of existingMessages) {
      if (msg.role === "assistant") {
        processAssistantMessage(msg)
      }
    }
    // Bootstrap existing tool parts
    for (const msg of existingMessages) {
      const parts = partsMap[msg.id] ?? []
      for (const part of parts) {
        if (part.type === "tool") {
          processToolPart(part)
        }
      }
    }

    return s
  }, [sessionID, messages, partsMap]) // recreate when session changes

  // Subscribe to live events
  useEffect(() => {
    const unsub = sdk.event.on(
      () => true,
      (event) => {
        switch (event.type) {
          case "message.updated": {
            const info = event.properties.info as Message
            if (info.sessionID !== sessionID) return
            if (info.role !== "assistant") return

            store.setState((state) => {
              if (state.processedMessageIDs.has(info.id)) return
              state.processedMessageIDs.add(info.id)
              state.totalTokens.input += info.tokens.input
              state.totalTokens.output += info.tokens.output
              state.totalTokens.reasoning += info.tokens.reasoning
              state.totalTokens.cache.read += info.tokens.cache.read
              state.totalTokens.cache.write += info.tokens.cache.write
              state.totalCost += info.cost
              if (info.cost > 0) state.hasCostData = true
              state.turnCount += 1

              // Per-model accumulation
              const modelKey = `${info.providerID}/${info.modelID}`
              const existing = state.perModel.get(modelKey)
              if (existing) {
                existing.tokens.input += info.tokens.input
                existing.tokens.output += info.tokens.output
                existing.tokens.reasoning += info.tokens.reasoning
                existing.tokens.cache.read += info.tokens.cache.read
                existing.tokens.cache.write += info.tokens.cache.write
                existing.cost += info.cost
                existing.requests += 1
              } else {
                state.perModel.set(modelKey, {
                  modelID: info.modelID,
                  providerID: info.providerID,
                  tokens: { ...info.tokens },
                  cost: info.cost,
                  requests: 1,
                })
              }
            })
            break
          }
          case "message.part.updated": {
            const part = event.properties.part as Part
            if (part.sessionID !== sessionID) return
            if (part.type !== "tool") return

            store.setState((state) => {
              const key = part.id
              // Only count terminal states, and only once
              if (part.state.status === "completed" || part.state.status === "error") {
                if (state.processedToolPartIDs.has(key)) return
                state.processedToolPartIDs.add(key)
                state.toolCalls.total += 1
                if (part.state.status === "completed") state.toolCalls.success += 1
                else state.toolCalls.failed += 1
              }
            })
            break
          }
        }
      },
    )
    return unsub
  }, [sdk, store, sessionID])

  const state = useStore(store)

  // Derive contextLimit from current model
  const currentModel = local.model.current()
  const contextLimit = useMemo(() => {
    if (!currentModel) return 200_000
    const provider = providers.find((p) => p.id === currentModel.providerID)
    const modelInfo = provider?.models[currentModel.modelID]
    return modelInfo?.limit?.context ?? 200_000
  }, [currentModel, providers])

  // Compute contextUtilization
  const totalUsedTokens =
    state.totalTokens.input +
    state.totalTokens.output +
    state.totalTokens.reasoning +
    state.totalTokens.cache.read +
    state.totalTokens.cache.write

  const contextUtilization = Math.min(1, Math.max(0, totalUsedTokens / contextLimit))

  return {
    totalTokens: state.totalTokens,
    totalCost: state.hasCostData ? state.totalCost : null,
    contextUtilization,
    contextLimit,
    turnCount: state.turnCount,
    toolCalls: state.toolCalls,
    duration: Date.now() - state.createdAt,
    perModel: Array.from(state.perModel.values()),
  }
}
