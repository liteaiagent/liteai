import type { Accessor, ParentProps } from "solid-js"
import type { PaneRoute } from "./pane-route"
import { PaneRouteProvider } from "./pane-route"
import { type Platform, PlatformProvider } from "./platform"
import { type ServerConnection, ServerProvider } from "./server"
import { GlobalSDKProvider } from "./global-sdk"

/**
 * PaneProviders — wraps all shared contexts needed by any Pane.
 *
 * This is the minimal shell for Phase 1. Additional providers (GlobalSync, Sync,
 * Prompt, Models, Settings, Permission, Local) will be added in Phase 2 as those
 * contexts are migrated.
 *
 * Usage (web):
 * ```tsx
 * <PaneProviders
 *   platform={webPlatform}
 *   route={() => ({ projectID, sessionID })}
 *   server={ServerConnection.Key.make("http://localhost:3000")}
 * >
 *   <ChatPane />
 * </PaneProviders>
 * ```
 *
 * Usage (vscode):
 * ```tsx
 * <PaneProviders
 *   platform={vscodePlatform}
 *   route={routeSignal}
 *   server={ServerConnection.Key.make("http://localhost:PORT")}
 * >
 *   <ChatPane />
 * </PaneProviders>
 * ```
 */
export function PaneProviders(
  props: ParentProps & {
    platform: Platform
    route: Accessor<PaneRoute>
    server: ServerConnection.Key
    servers?: Array<ServerConnection.Any>
  },
) {
  return (
    <PlatformProvider value={props.platform}>
      <ServerProvider defaultServer={props.server} servers={props.servers}>
        <GlobalSDKProvider>
          <PaneRouteProvider route={props.route}>{props.children}</PaneRouteProvider>
        </GlobalSDKProvider>
      </ServerProvider>
    </PlatformProvider>
  )
}
