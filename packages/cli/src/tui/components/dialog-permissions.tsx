import { type Color, Text } from "@liteai/ink"
import type React from "react"
import { useMemo } from "react"
import { useSession } from "../context/session"
import { useTheme } from "../context/theme"
import { selectPermissions, useAppState } from "../state"
import { SelectPane } from "../ui/select-pane"

type Props = {
  onClose: () => void
}

export function DialogPermissions({ onClose }: Props): React.ReactNode {
  const { theme } = useTheme()
  const sessionID = useSession().sessionID

  const permissions = useAppState(selectPermissions(sessionID ?? ""))

  // Group by tool name
  const grouped = useMemo(() => {
    const map = new Map<string, import("@liteai/sdk").PermissionRequest[]>()
    for (const p of permissions) {
      // biome-ignore lint/suspicious/noExplicitAny: SDK type outdated
      const tool = (p.tool as any)?.name ?? "unknown"
      if (!map.has(tool)) map.set(tool, [])
      map.get(tool)?.push(p)
    }
    return Array.from(map.entries())
  }, [permissions])

  const options = grouped.map(([tool, perms]) => ({
    key: tool,
    value: tool,
    label: tool,
    description: `${perms.length} pending`,
  }))

  return (
    <SelectPane
      title="Permissions"
      header={<Text color={theme.textMuted as Color}>{permissions.length} pending approvals</Text>}
      items={options}
      onSelect={() => {}} // View-only for now
      onClose={onClose}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ navigate · Esc close</Text>}
    />
  )
}
