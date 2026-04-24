/** @jsxImportSource react */
import { useMemo, useState } from "react"
import { createSimpleContext } from "./helper"

export type PromptInfo = {
  input: string
  parts: unknown[]
}

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

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
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

    return useMemo(
      () => ({
        get data() {
          return route
        },
        navigate(next: Route) {
          console.log("navigate", next)
          setRoute(next)
        },
      }),
      [route],
    )
  },
})

export function useRouteData<T extends Route["type"]>(_type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: T }>
}
