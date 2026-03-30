import { type Accessor, createMemo, type ParentProps } from "solid-js"
import { GlobalSDKProvider } from "./global-sdk"
import { GlobalSyncProvider } from "./global-sync"
import { LanguageProvider, type Locale } from "./language"
import { LocalProvider } from "./local"
import { ModelsProvider } from "./models"
import type { PaneRoute } from "./pane-route"
import { PaneRouteProvider } from "./pane-route"
import { PermissionProvider } from "./permission"
import { type Platform, PlatformProvider } from "./platform"
import { PromptProvider } from "./prompt"
import { SDKProvider } from "./sdk"
import { type ServerConnection, ServerProvider } from "./server"
import { SettingsProvider } from "./settings"
import { SyncProvider } from "./sync"

/**
 * PaneProviders — wraps all shared contexts needed by any Pane.
 *
 * Includes the full provider tree: GlobalSDK → GlobalSync → SDK → Sync → Local.
 * SDKProvider + SyncProvider are derived from the route's projectID unless
 * an explicit `directory` accessor is passed (web resolves directory separately).
 *
 * Usage (vscode — simplest):
 * ```tsx
 * <PaneProviders
 *   platform={vscodePlatform}
 *   route={routeSignal}
 *   server={ServerConnection.Key.make("http://localhost:PORT")}
 * >
 *   <ChatPane />
 * </PaneProviders>
 * ```
 *
 * Usage (web — explicit directory):
 * ```tsx
 * <PaneProviders
 *   platform={webPlatform}
 *   route={() => ({ projectID, sessionID })}
 *   server={ServerConnection.Key.make("http://localhost:3000")}
 *   directory={() => resolvedDir}
 *   dictionaries={mergeHostDictionaries(webDicts)}
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
    dictionaries?: Record<Locale, Record<string, unknown>>
    /** Explicit directory accessor. Falls back to route().projectID */
    directory?: Accessor<string>
  },
) {
  const projectID = createMemo(() => props.route()?.projectID ?? "")
  const directory = createMemo(() => (props.directory ? props.directory() : projectID()))

  return (
    <PlatformProvider value={props.platform}>
      <ServerProvider defaultServer={props.server} servers={props.servers}>
        <GlobalSDKProvider>
          <LanguageProvider dictionaries={props.dictionaries}>
            <SettingsProvider>
              <PaneRouteProvider route={props.route}>
                <GlobalSyncProvider>
                  <SDKProvider projectID={projectID} directory={directory}>
                    <SyncProvider>
                      <ModelsProvider>
                        <PromptProvider>
                          <PermissionProvider>
                            <LocalProvider>{props.children}</LocalProvider>
                          </PermissionProvider>
                        </PromptProvider>
                      </ModelsProvider>
                    </SyncProvider>
                  </SDKProvider>
                </GlobalSyncProvider>
              </PaneRouteProvider>
            </SettingsProvider>
          </LanguageProvider>
        </GlobalSDKProvider>
      </ServerProvider>
    </PlatformProvider>
  )
}
