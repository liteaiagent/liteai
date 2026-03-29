import { type Accessor, createContext, useContext } from "solid-js"

/**
 * PaneRoute — Router-agnostic route state for Panes.
 *
 * In `@liteai/web`, PaneRoute is derived from `@solidjs/router` `useParams()`.
 * In `@liteai/vscode`, PaneRoute is driven by the extension host via `postMessage`.
 *
 * Panes use `usePaneRoute()` instead of `useParams()` so they stay host-agnostic.
 */
export type PaneRoute = {
  projectID?: string
  sessionID?: string
}

const PaneRouteContext = createContext<Accessor<PaneRoute>>()

export function PaneRouteProvider(props: { route: Accessor<PaneRoute>; children: any }) {
  return <PaneRouteContext.Provider value={props.route}>{props.children}</PaneRouteContext.Provider>
}

export function usePaneRoute(): Accessor<PaneRoute> {
  const ctx = useContext(PaneRouteContext)
  if (!ctx) throw new Error("usePaneRoute must be used within PaneRouteProvider")
  return ctx
}
