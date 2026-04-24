/** @jsxImportSource react */

import { Text } from "@liteai/ink"
import type React from "react"

type Props = {
  shortcut: string
  action: string
  parens?: boolean
  bold?: boolean
}

export function KeyboardShortcutHint({ shortcut, action, parens = false, bold = false }: Props): React.ReactNode {
  const shortcutText = bold ? <Text bold>{shortcut}</Text> : shortcut

  if (parens) {
    return (
      <Text>
        ({shortcutText} to {action})
      </Text>
    )
  }
  return (
    <Text>
      {shortcutText} to {action}
    </Text>
  )
}
