import type React from "react"
import { createContext, useContext, useMemo, useState } from "react"
import type { PromptInfo } from "../types"

export type HomeRoute = {
  type: "home"
  initialPrompt?: PromptInfo
  workspaceID?: string
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  initialPrompt?: PromptInfo
}

export type Route = HomeRoute | SessionRoute

export type RouteContextValue = {
  readonly data: Route
  navigate: (next: Route) => void
}

const RouteContext = createContext<RouteContextValue | undefined>(undefined)

export function useRoute(): RouteContextValue {
  const context = useContext(RouteContext)
  if (context === undefined) {
    throw new Error("Route context must be used within a context provider")
  }
  return context
}

export function RouteProvider({ children }: { children?: React.ReactNode }) {
  const [route, setRoute] = useState<Route>(() => {
    if (process.env.LITEAI_ROUTE) {
      try {
        return JSON.parse(process.env.LITEAI_ROUTE)
      } catch {
        // ignore
      }
    }
    return { type: "home" }
  })

  const value = useMemo(
    () => ({
      get data() {
        return route
      },
      navigate(next: Route) {
        setRoute(next)
      },
    }),
    [route],
  )

  return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>
}
export function useRouteData<T extends Route["type"]>(_type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: T }>
}
