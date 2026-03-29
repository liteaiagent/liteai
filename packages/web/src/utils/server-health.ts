// Re-export from @liteai/ui/panes for backward compatibility
export { checkServerHealth, createCheckServerHealth } from "@liteai/ui/panes"
export type { ServerHealth } from "@liteai/ui/panes"

// Legacy hook that web code still uses — wraps createCheckServerHealth with Platform's fetch
import { usePlatform } from "@/context/platform"
import { createCheckServerHealth } from "@liteai/ui/panes"

export function useCheckServerHealth() {
  const platform = usePlatform()
  return createCheckServerHealth(platform.fetch)
}
