import type { Agent, LiteaiClient, McpResource } from "@liteai/sdk"
import fuzzysort from "fuzzysort"
import { useEffect, useReducer, useRef } from "react"
import { type AtToken, extractAtToken } from "../components/prompt/utils/at-token"

export type AtCompletionCategory = "file" | "agent" | "resource"

export type AtCompletionItem = {
  id: string
  displayText: string
  category: AtCompletionCategory
  isDirectory: boolean
  tag?: string
  description?: string
}

type AtCompleterStatus = "idle" | "searching" | "ready" | "error"

type State = {
  status: AtCompleterStatus
  items: AtCompletionItem[]
  error: string | null
}

type Action =
  | { type: "SEARCH_START" }
  | { type: "SEARCH_COMPLETE"; items: AtCompletionItem[] }
  | { type: "SEARCH_ERROR"; error: string }
  | { type: "RESET" }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SEARCH_START":
      return { ...state, status: "searching", error: null }
    case "SEARCH_COMPLETE":
      return { ...state, status: "ready", items: action.items, error: null }
    case "SEARCH_ERROR":
      return { ...state, status: "error", error: action.error, items: [] }
    case "RESET":
      return { status: "idle", items: [], error: null }
    default:
      return state
  }
}

export function useAtCompleter(opts: {
  input: string
  cursorOffset: number
  agents: Agent[]
  mcpResources: Record<string, McpResource>
  projectID: string
  sdk: LiteaiClient
  enabled?: boolean
}): {
  active: boolean
  items: AtCompletionItem[]
  isLoading: boolean
  token: AtToken | null
} {
  const { input, cursorOffset, agents, mcpResources, projectID, sdk, enabled = true } = opts
  const [state, dispatch] = useReducer(reducer, { status: "idle", items: [], error: null })

  const token = extractAtToken(input, cursorOffset)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (abortRef.current) abortRef.current.abort()

    if (!token || !enabled) {
      dispatch({ type: "RESET" })
      return
    }

    dispatch({ type: "SEARCH_START" })

    timerRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const query = token.searchText

        // 1. Search Files via SDK
        let fileItems: AtCompletionItem[] = []
        try {
          const filesResponse = await sdk.project.find.files({
            projectID,
            query,
            limit: 20,
          })
          if (filesResponse.data) {
            fileItems = filesResponse.data.map((path: string) => {
              const isDirectory = path.endsWith("/")
              return {
                id: `file:${path}`,
                displayText: path,
                category: "file",
                isDirectory,
                tag: "[File]",
              }
            })
          }
        } catch (e) {
          // Ignore file search errors if agent/resource still works, but log if needed
          console.error("File search error:", e)
        }

        if (controller.signal.aborted) return

        // 2. Search Agents (local fuzzysort)
        let agentItems: AtCompletionItem[] = []
        if (agents.length > 0) {
          if (!query) {
            agentItems = agents.map((a) => ({
              id: `agent:${a.name}`,
              displayText: a.name,
              category: "agent",
              isDirectory: false,
              tag: "[Agent]",
              description: a.description,
            }))
          } else {
            const results = fuzzysort.go(query, agents, { key: "name", threshold: -10000 })
            agentItems = results.map((r) => ({
              id: `agent:${r.obj.name}`,
              displayText: r.obj.name,
              category: "agent",
              isDirectory: false,
              tag: "[Agent]",
              description: r.obj.description,
            }))
          }
        }

        // 3. Search MCP Resources (local filtering)
        let resourceItems: AtCompletionItem[] = []
        const resourceKeys = Object.keys(mcpResources)
        if (resourceKeys.length > 0) {
          if (!query) {
            resourceItems = resourceKeys.slice(0, 10).map((key) => ({
              id: `resource:${key}`,
              displayText: key,
              category: "resource",
              isDirectory: false,
              tag: "[Resource]",
              description: mcpResources[key]?.name,
            }))
          } else {
            const results = fuzzysort.go(query, resourceKeys, { threshold: -10000 })
            resourceItems = results.map((r) => ({
              id: `resource:${r.target}`,
              displayText: r.target,
              category: "resource",
              isDirectory: false,
              tag: "[Resource]",
              description: mcpResources[r.target]?.name,
            }))
          }
        }

        if (controller.signal.aborted) return

        // Combine and dispatch
        dispatch({
          type: "SEARCH_COMPLETE",
          items: [...fileItems, ...agentItems, ...resourceItems],
        })
      } catch (e) {
        if (!controller.signal.aborted) {
          dispatch({ type: "SEARCH_ERROR", error: String(e) })
        }
      }
    }, 100)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [token?.searchText, enabled, projectID, sdk, agents, mcpResources])

  return {
    active: !!token && enabled,
    items: state.items,
    isLoading: state.status === "searching",
    token,
  }
}
