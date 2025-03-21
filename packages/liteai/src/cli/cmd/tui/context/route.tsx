import { createStore } from "solid-js/store"
import type { PromptInfo } from "../component/prompt/history"
import { createSimpleContext } from "./helper"

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
    const [store, setStore] = createStore<Route>(
      process.env.LITEAI_ROUTE
        ? JSON.parse(process.env.LITEAI_ROUTE)
        : {
            type: "home",
          },
    )

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        console.log("navigate", route)
        setStore(route)
      },
    }
  },
})

export function useRouteData<T extends Route["type"]>(_type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: T }>
}
