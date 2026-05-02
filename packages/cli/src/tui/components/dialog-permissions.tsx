import { type Color, Text } from "@liteai/ink"
import type React from "react"
import { useMemo } from "react"
import { useDialog } from "../context/dialog"
import { useSession } from "../context/session"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { DialogSelect } from "../ui/dialog-select"

export function DialogPermissions(): React.ReactNode {
  const sync = useSync()
  // biome-ignore lint/correctness/noUnusedVariables: reserved for future actions
  const dialog = useDialog()
  const { theme } = useTheme()
  const sessionID = useSession().sessionID

  const permissions = useMemo(() => {
    return sync.permission[sessionID ?? ""] ?? []
  }, [sync.permission, sessionID])

  // Group by tool name
  const grouped = useMemo(() => {
    const map = new Map<string, typeof permissions>()
    for (const p of permissions) {
      // biome-ignore lint/suspicious/noExplicitAny: SDK type outdated
      const tool = (p.tool as any)?.name ?? "unknown"
      if (!map.has(tool)) map.set(tool, [])
      map.get(tool)?.push(p)
    }
    return Array.from(map.entries())
  }, [permissions])

  const options = grouped.map(([tool, perms]) => ({
    value: tool,
    title: tool,
    description: `${perms.length} pending`,
  }))

  return (
    <DialogSelect
      title="Permissions"
      header={<Text color={theme.textMuted as Color}>{permissions.length} pending approvals</Text>}
      options={options}
      onSelect={() => {}} // View-only for now
      footerContent={<Text color={theme.textMuted as Color}>↑↓ navigate · Esc close</Text>}
    />
  )
}
