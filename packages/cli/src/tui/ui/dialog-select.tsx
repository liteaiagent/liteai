/** @jsxImportSource react */

import { Box, Text } from "@liteai/ink"
import type React from "react"
import { FuzzyPicker } from "./fuzzy-picker"

export type DialogSelectProps<T> = {
  title: string
  options: readonly T[]
  getLabel: (item: T) => string
  getValue?: (item: T) => string
  onSelect?: (item: T) => void
  onCancel?: () => void
}

export function DialogSelect<T>({
  title,
  options,
  getLabel,
  onSelect,
  onCancel,
}: DialogSelectProps<T>): React.ReactNode {
  return (
    <Box flexDirection="column">
      <FuzzyPicker
        title={title}
        items={options}
        getKey={(item) => getLabel(item)}
        renderItem={(item, isFocused) => <Text color={isFocused ? "ansi:blue" : undefined}>{getLabel(item)}</Text>}
        onQueryChange={() => {}}
        onSelect={(item) => onSelect?.(item)}
        onCancel={() => onCancel?.()}
      />
    </Box>
  )
}
