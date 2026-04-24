/** @jsxImportSource react */

import { Box, Text } from "@liteai/ink"
import type React from "react"
import { Dialog } from "./dialog"

export function DialogHelp(): React.ReactNode {
  return (
    <Dialog title="Help" onCancel={() => {}} isCancelActive>
      <Box paddingBottom={1}>
        <Text dim>
          Press <Text bold>Ctrl+P</Text> to see all available actions and commands in any context.
        </Text>
      </Box>
    </Dialog>
  )
}
