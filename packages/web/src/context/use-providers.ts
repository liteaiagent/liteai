import { usePaneRoute } from "@liteai/ui/panes"
import { createMemo } from "solid-js"
import { useGlobalSync } from "./global-sync"

export const popularProviders = ["anthropic", "google", "openai", "google-code-assist", "ai4all"]
const popularProviderSet = new Set(popularProviders)

export function useProviders() {
  const globalSync = useGlobalSync()
  const route = usePaneRoute()
  const dir = createMemo(() => globalSync.data.project.find((p) => p.id === route()?.projectID)?.worktree ?? "")
  const providers = () => {
    if (dir()) {
      const [projectStore] = globalSync.child(dir())
      return projectStore.provider
    }
    return globalSync.data.provider
  }
  return {
    all: () => providers().all,
    default: () => providers().default,
    popular: () => providers().all.filter((p) => popularProviderSet.has(p.id)),
    connected: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter((p) => connected.has(p.id))
    },
    paid: () => {
      const connected = new Set(providers().connected)
      return providers().all.filter(
        (p) => connected.has(p.id) && (p.id !== "opencode" || Object.values(p.models).some((m) => m.cost?.input)),
      )
    },
  }
}
