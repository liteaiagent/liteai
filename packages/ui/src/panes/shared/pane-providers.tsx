import type { Accessor, ParentProps } from "solid-js"
import { FileIconSprite } from "../../components/file-icon"
import { ProviderIconSprite } from "../../components/provider-icon"
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
      {/* Inline SVG sprite sheets — fragment-only <use href="#id"> references
          work same-document and never trigger external HTTP requests (which
          VS Code webviews block with 403 for cross-origin SVG assets). */}
      <FileIconSprite />
      <ProviderIconSprite />
      <LanguageProvider dictionaries={props.dictionaries}>
        <SettingsProvider>
          <PaneRouteProvider route={props.route}>{props.children}</PaneRouteProvider>
        </SettingsProvider>
      </LanguageProvider>
    </PlatformProvider>
  )
}
