import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import { createSimpleContext } from "../../context"
import type { ServerConnection } from "./server"

type PickerPaths = string | string[] | null
type OpenDirectoryPickerOptions = { title?: string; multiple?: boolean }

export type Platform = {
  /** Platform discriminator */
  platform: "web" | "vscode"

  /** Open a URL in the default browser */
  openLink(url: string): void

  /** Restart the app  */
  restart(): Promise<void>

  /** Navigate back in history */
  back(): void

  /** Navigate forward in history */
  forward(): void

  /** Send a system notification (optional deep link) */
  notify(title: string, description?: string, href?: string): Promise<void>

  /** Open directory picker dialog (server-backed on web) */
  openDirectoryPickerDialog?(opts?: OpenDirectoryPickerOptions): Promise<PickerPaths>

  /** Storage mechanism, defaults to localStorage */
  storage?: (name?: string) => SyncStorage | AsyncStorage

  /** Fetch override (used by VSCode bridge to proxy through extension host) */
  fetch?: typeof fetch

  /** Get the configured default server URL */
  getDefaultServer?(): Promise<ServerConnection.Key | null>

  /** Set the default server URL to use on app startup */
  setDefaultServer?(url: ServerConnection.Key | null): Promise<void> | void

  /** Search files in the workspace (VSCode: workspace.findFiles) */
  searchFiles?: (query: string) => Promise<string[]>

  /** Navigate to a session (VSCode: postMessage route change) */
  navigateSession?: (projectID: string, sessionID: string) => void

  /** Open a file in the editor (VSCode: vscode.window.showTextDocument) */
  openFile?: (path: string) => void
}

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
