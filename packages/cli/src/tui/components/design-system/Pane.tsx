/** @jsxImportSource react */

import { Box, type Color } from "@liteai/ink"
import type React from "react"
import { useIsInsideModal } from "../../ui/dialog"
import { Divider } from "./Divider"

type PaneProps = {
  children: React.ReactNode
  color?: Color
}

export function Pane({ children, color }: PaneProps): React.ReactNode {
  if (useIsInsideModal()) {
    return (
      <Box flexDirection="column" paddingX={1} flexShrink={0}>
        {children}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" paddingTop={1}>
      <Divider color={color} />
      <Box flexDirection="column" paddingX={2}>
        {children}
      </Box>
    </Box>
  )
}
