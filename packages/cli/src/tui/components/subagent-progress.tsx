import { Box, type Color, Text, useAnimationFrame } from "@liteai/ink"
import { useTheme } from "../context/theme"
import { useElapsedTime } from "../hooks/use-elapsed-time"
import { SpinnerGlyph } from "../ui/spinner"

export type SubagentInfo = {
  partId: string
  description: string
  isRunning: boolean
  sessionId?: string
  startTime?: number
  endTime?: number
  toolCount: number
}

export type SubagentProgressProps = {
  subagents: SubagentInfo[]
  reducedMotion?: boolean
}

export function SubagentProgress({ subagents, reducedMotion = false }: SubagentProgressProps) {
  const { theme } = useTheme()
  const hasRunning = subagents.some((s) => s.isRunning)
  const [ref, time] = useAnimationFrame(hasRunning && !reducedMotion ? 50 : null)
  const frame = Math.floor(time / 120)

  if (subagents.length === 0) return null

  return (
    <Box ref={ref} flexDirection="column">
      {subagents.map((agent) => (
        <SubagentRow
          key={agent.partId}
          agent={agent}
          reducedMotion={reducedMotion}
          themeColor={theme.primary as string}
          time={time}
          frame={frame}
        />
      ))}
    </Box>
  )
}

function SubagentRow({
  agent,
  reducedMotion,
  themeColor,
  time,
  frame,
}: {
  agent: SubagentInfo
  reducedMotion: boolean
  themeColor: string
  time: number
  frame: number
}) {
  const { theme } = useTheme()
  const timing = useElapsedTime({ startTime: agent.startTime ?? null, endTime: agent.endTime })

  const timingText = timing.formatted ? ` (${timing.formatted})` : ""
  const toolText = ` · ${agent.toolCount} tool${agent.toolCount !== 1 ? "s" : ""}`

  return (
    <Box flexDirection="row" gap={1}>
      {agent.isRunning ? (
        <SpinnerGlyph frame={frame} color={themeColor} stalledIntensity={0} reducedMotion={reducedMotion} time={time} />
      ) : (
        <Box width={2}>
          <Text color={theme.success as Color}>✓</Text>
        </Box>
      )}
      <Text color={agent.isRunning ? (theme.text as Color) : (theme.textMuted as Color)}>
        Task: {agent.description}
        {timingText}
        <Text color={theme.textMuted as Color}>{toolText}</Text>
      </Text>
    </Box>
  )
}
