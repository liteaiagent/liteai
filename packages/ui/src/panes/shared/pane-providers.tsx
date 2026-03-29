import type { Accessor, ParentProps } from "solid-js"
import type { PaneRoute } from "./pane-route"
import { PaneRouteProvider } from "./pane-route"
import { type Platform, PlatformProvider } from "./platform"
import { type ServerConnection, ServerProvider } from "./server"
import { GlobalSDKProvider } from "./global-sdk"
import { LanguageProvider, type Locale, mergeHostDictionaries } from "./language"
import { SettingsProvider } from "./settings"
import { GlobalSyncProvider } from "./global-sync"
import { ModelsProvider } from "./models"
import { PromptProvider } from "./prompt"
import { PermissionProvider } from "./permission"
import { LocalProvider } from "./local"

/**
 * PaneProviders — wraps all shared contexts needed by any Pane.
 *
 * Phase 2: includes all migrated providers in the correct nesting order.
 *
 * Usage (web):
 * ```tsx
 * <PaneProviders
 *   platform={webPlatform}
 *   route={() => ({ projectID, sessionID })}
 *   server={ServerConnection.Key.make("http://localhost:3000")}
 *   dictionaries={mergeHostDictionaries(webDicts)}
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
    dictionaries?: Record<Locale, Record<string, unknown>>
  },
) {
  return (
    <PlatformProvider value={props.platform}>
      <ServerProvider defaultServer={props.server} servers={props.servers}>
        <GlobalSDKProvider>
          <LanguageProvider dictionaries={props.dictionaries}>
            <SettingsProvider>
              <PaneRouteProvider route={props.route}>
                <GlobalSyncProvider>
                  <ModelsProvider>
                    <PromptProvider>
                      <PermissionProvider>
                        <LocalProvider>{props.children}</LocalProvider>
                      </PermissionProvider>
                    </PromptProvider>
                  </ModelsProvider>
                </GlobalSyncProvider>
              </PaneRouteProvider>
            </SettingsProvider>
          </LanguageProvider>
        </GlobalSDKProvider>
      </ServerProvider>
    </PlatformProvider>
  )
}
