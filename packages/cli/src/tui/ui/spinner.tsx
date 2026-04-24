/** @jsxImportSource react */

import { Box, type Color, Text, useAnimationFrame } from "@liteai/ink"
import type React from "react"

const DEFAULT_CHARACTERS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const SPINNER_FRAMES = [...DEFAULT_CHARACTERS, ...[...DEFAULT_CHARACTERS].reverse()]

export type SpinnerMode = "thinking" | "working" | "reading"

type SpinnerProps = {
  reducedMotion?: boolean
}

export function Spinner({ reducedMotion = false }: SpinnerProps): React.ReactNode {
  const [ref, time] = useAnimationFrame(reducedMotion ? null : 120)

  if (reducedMotion) {
    return (
      <Box ref={ref} flexWrap="wrap" height={1} width={2}>
        <Text>●</Text>
      </Box>
    )
  }

  const frame = Math.floor(time / 120) % SPINNER_FRAMES.length

  return (
    <Box ref={ref} flexWrap="wrap" height={1} width={2}>
      <Text>{SPINNER_FRAMES[frame]}</Text>
    </Box>
  )
}

const MODE_MESSAGES: Record<SpinnerMode, string> = {
  thinking: "Thinking…",
  working: "Working…",
  reading: "Reading…",
}

type SpinnerWithVerbProps = {
  mode: SpinnerMode
  message?: string
  color?: Color
  reducedMotion?: boolean
}

export function SpinnerWithVerb({
  mode,
  message,
  color = "ansi:blue",
  reducedMotion = false,
}: SpinnerWithVerbProps): React.ReactNode {
  const displayMessage = message ?? MODE_MESSAGES[mode]

  return (
    <Box flexDirection="row" gap={1}>
      <Spinner reducedMotion={reducedMotion} />
      <Text color={color}>{displayMessage}</Text>
    </Box>
  )
}
