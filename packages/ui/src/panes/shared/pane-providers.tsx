import type { Accessor, ParentProps } from "solid-js"
import { LanguageProvider, type Locale } from "./language"
import type { PaneRoute } from "./pane-route"
import { PaneRouteProvider } from "./pane-route"
import { type Platform, PlatformProvider } from "./platform"
import { SettingsProvider } from "./settings"

/**
 * PaneProviders (Slim) — platform-agnostic providers only.
 *
 * Provides: Platform → Language → Settings → PaneRoute.
 *
 * Does NOT include HTTP/SSE providers (GlobalSDK, GlobalSync, SDK, Sync,
 * Server, Models, Permission, Local). Those are composed by the host:
 * - Web: `WebPaneProviders` in `packages/web`
 * - VSCode: wires controllers directly via `ChatContextProvider`
 */
export function PaneProviders(
  props: ParentProps & {
    platform: Platform
    route: Accessor<PaneRoute>
    dictionaries?: Record<Locale, Record<string, unknown>>
  },
) {
  return (
    <PlatformProvider value={props.platform}>
      <LanguageProvider dictionaries={props.dictionaries}>
        <SettingsProvider>
          <PaneRouteProvider route={props.route}>{props.children}</PaneRouteProvider>
        </SettingsProvider>
      </LanguageProvider>
    </PlatformProvider>
  )
}
