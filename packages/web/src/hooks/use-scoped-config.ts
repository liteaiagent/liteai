import type { Config } from "@liteai/sdk/client"
import { createSignal } from "solid-js"
import type { SettingsScope } from "@/components/settings-scope-switcher"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

/**
 * Hook providing scope-aware config read/write.
 *
 * - **User scope:** reads from `config.get` (user-only config), writes via `globalSync.updateConfig`.
 * - **Project scope:** reads from `project.config.get` (merged union), writes via `project.config.update`.
 *
 * The `projectID` is needed for project scope operations. Pass it only when a workspace is active.
 */
export function useScopedConfig() {
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const [scope, setScope] = createSignal<SettingsScope>("user")

  async function getConfig(projectID?: string): Promise<Config> {
    if (scope() === "project" && projectID) {
      const res = await globalSDK.client.project.config.get({ projectID })
      return res.data ?? {}
    }
    // User scope: global-only config
    const res = await globalSDK.client.config.get()
    return res.data ?? {}
  }

  async function updateConfig(config: Config, projectID?: string) {
    if (scope() === "project" && projectID) {
      await globalSDK.client.project.config.update({ projectID, config })
      return
    }
    // User scope: global config update + trigger re-bootstrap
    await globalSync.updateConfig(config)
  }

  return { scope, setScope, getConfig, updateConfig }
}
