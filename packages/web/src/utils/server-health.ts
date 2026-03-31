// Re-export from @liteai/ui/panes for backward compatibility

export type { ServerHealth } from "../context/server-health"
export { checkServerHealth } from "../context/server-health"

// Legacy hook that web code still uses — wraps createCheckServerHealth with Platform's fetch
import { usePlatform } from "@/context/platform"
import { createCheckServerHealth } from "../context/server-health"

export function useCheckServerHealth() {
  const platform = usePlatform()
  return createCheckServerHealth(platform.fetch)
}
