import { Box, type Color, TerminalSizeContext, Text, useInput } from "@liteai/ink"
import { useContext, useEffect, useMemo, useState } from "react"
import { useTheme } from "../context/theme"
import { type DateRange, useGlobalStats } from "../hooks/use-global-stats"
import { useSessionStats } from "../hooks/use-session-stats"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybindings } from "../keybindings/use-keybinding"
import { useAppState } from "../state"
import { ContextUsageDisplay } from "./context-usage-display"
import { Heatmap } from "./heatmap"

type Props = {
  sessionID: string
  onClose: () => void
}

const FACTOIDS = [
  { threshold: 1_000_000, text: "You've crossed the million-token mark!" },
  { threshold: 730_000, text: "That's roughly War and Peace in tokens!" },
  { threshold: 100_000, text: "That's a short novel worth of tokens." },
]

export function DialogStats({ sessionID, onClose: _onClose }: Props) {
  useRegisterKeybindingContext("Tabs")
  const { theme } = useTheme()
  const session_diff = useAppState((s) => s.session_diff)
  const stats = useSessionStats(sessionID)
  const terminalSize = useContext(TerminalSizeContext)

  const [tab, setTab] = useState<"session" | "global">("session")
  const [dateRange, setDateRange] = useState<DateRange>("30d")
  const globalStats = useGlobalStats(dateRange)

  const RANGES: DateRange[] = ["7d", "30d", "90d", "all"]

  useKeybindings(
    {
      "tabs:next": () => setTab((t) => (t === "session" ? "global" : "session")),
      "tabs:previous": () => setTab((t) => (t === "session" ? "global" : "session")),
      "select:cycleRange": () => setDateRange((r) => RANGES[(RANGES.indexOf(r) + 1) % RANGES.length]),
      "global:close": _onClose,
    },
    { context: "Tabs" },
  )

  // Defensive fallback: direct escape handler ensures Esc always closes the dialog.
  // The keybinding system's context resolution between Chat and Tabs can race,
  // causing the Tabs "global:close" handler to be suppressed. This pattern is
  // proven in dialog-provider.tsx's AuthUrlHeader.
  //
  // Mount guard: delay activation by one frame so stale escape bytes in the
  // terminal input buffer don't immediately close the dialog on mount.
  const [escActive, setEscActive] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setEscActive(true), 50)
    return () => clearTimeout(id)
  }, [])
  useInput(
    (_input, key) => {
      if (key.escape) _onClose()
    },
    { isActive: escActive },
  )

  const diff = session_diff[sessionID]
  const changes = useMemo(() => {
    if (!diff || diff.length === 0) return null
    let files = 0
    let additions = 0
    let deletions = 0
    for (const d of diff) {
      files++
      additions += d.additions
      deletions += d.deletions
    }
    return { files, additions, deletions }
  }, [diff])

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  }

  const formatTokens = (t: number) => t.toLocaleString()

  const factoid = useMemo(() => {
    const total = globalStats.totalTokens
    for (const f of FACTOIDS) {
      if (total >= f.threshold) return f.text
    }
    return "Keep chatting to reach new milestones!"
  }, [globalStats.totalTokens])

  const renderSessionTab = () => (
    <Box flexDirection="column" gap={1}>
      {/* Session Info */}
      <Box flexDirection="column" paddingBottom={1}>
        <Text color={theme.text as Color} bold>
          Info
        </Text>
        <Box flexDirection="row" gap={2}>
          <Text color={theme.textMuted as Color}>Session ID:</Text>
          <Text color={theme.text as Color}>{sessionID}</Text>
        </Box>
        <Box flexDirection="row" gap={2}>
          <Text color={theme.textMuted as Color}>Duration:</Text>
          <Text color={theme.text as Color}>{formatDuration(stats.duration)}</Text>
        </Box>
        <Box flexDirection="row" gap={2}>
          <Text color={theme.textMuted as Color}>Turns:</Text>
          <Text color={theme.text as Color}>{stats.turnCount}</Text>
        </Box>
      </Box>

      {/* Context Window */}
      <Box flexDirection="column" paddingBottom={1}>
        <Text color={theme.text as Color} bold>
          Context Window
        </Text>
        <ContextUsageDisplay utilization={stats.contextUtilization} contextLimit={stats.contextLimit} />
      </Box>

      {/* Economics */}
      <Box flexDirection="column" paddingBottom={1}>
        <Text color={theme.text as Color} bold>
          Economics
        </Text>
        <Box flexDirection="row" gap={2}>
          <Text color={theme.textMuted as Color}>Total Cost:</Text>
          <Text color={theme.text as Color}>
            {stats.totalCost !== null ? `$${stats.totalCost.toFixed(4)}` : "No cost data available"}
          </Text>
        </Box>
      </Box>

      {/* Tool Calls */}
      <Box flexDirection="column" paddingBottom={1}>
        <Text color={theme.text as Color} bold>
          Tool Calls
        </Text>
        <Box flexDirection="row" gap={2}>
          <Text color={theme.textMuted as Color}>Total:</Text>
          <Text color={theme.text as Color}>{stats.toolCalls.total}</Text>
        </Box>
        <Box flexDirection="row" gap={2}>
          <Text color={theme.textMuted as Color}>Success:</Text>
          <Text color={theme.success as Color}>{stats.toolCalls.success}</Text>
        </Box>
        <Box flexDirection="row" gap={2}>
          <Text color={theme.textMuted as Color}>Failed:</Text>
          <Text color={theme.error as Color}>{stats.toolCalls.failed}</Text>
        </Box>
      </Box>

      {/* Code Changes */}
      {changes && (
        <Box flexDirection="column" paddingBottom={1}>
          <Text color={theme.text as Color} bold>
            Code Changes
          </Text>
          <Box flexDirection="row" gap={2}>
            <Text color={theme.textMuted as Color}>Files Changed:</Text>
            <Text color={theme.text as Color}>{changes.files}</Text>
          </Box>
          <Box flexDirection="row" gap={2}>
            <Text color={theme.textMuted as Color}>Lines:</Text>
            <Box flexDirection="row" gap={1}>
              <Text color={theme.success as Color}>+{changes.additions}</Text>
              <Text color={theme.error as Color}>-{changes.deletions}</Text>
            </Box>
          </Box>
        </Box>
      )}

      {/* Per-Model Breakdown */}
      {stats.perModel.length > 0 && (
        <Box flexDirection="column" paddingBottom={1}>
          <Text color={theme.text as Color} bold>
            Per-Model Breakdown
          </Text>
          <Box flexDirection="row" gap={2}>
            <Box width={20}>
              <Text color={theme.textMuted as Color} underline>
                Model
              </Text>
            </Box>
            <Box width={10}>
              <Text color={theme.textMuted as Color} underline>
                Reqs
              </Text>
            </Box>
            <Box width={12}>
              <Text color={theme.textMuted as Color} underline>
                Input Tok
              </Text>
            </Box>
            <Box width={12}>
              <Text color={theme.textMuted as Color} underline>
                Output Tok
              </Text>
            </Box>
            <Box width={10}>
              <Text color={theme.textMuted as Color} underline>
                Cost
              </Text>
            </Box>
          </Box>
          {stats.perModel.map((model) => (
            <Box flexDirection="row" gap={2} key={`${model.providerID}/${model.modelID}`}>
              <Box width={20}>
                <Text color={theme.text as Color} wrap="truncate-end">
                  {model.modelID}
                </Text>
              </Box>
              <Box width={10}>
                <Text color={theme.text as Color}>{model.requests}</Text>
              </Box>
              <Box width={12}>
                <Text color={theme.text as Color}>{formatTokens(model.tokens.input)}</Text>
              </Box>
              <Box width={12}>
                <Text color={theme.text as Color}>{formatTokens(model.tokens.output)}</Text>
              </Box>
              <Box width={10}>
                <Text color={theme.text as Color}>${model.cost.toFixed(4)}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )

  const renderGlobalTab = () => {
    if (globalStats.loading) {
      return (
        <Box padding={1}>
          <Text color={theme.textMuted as Color}>Loading global stats...</Text>
        </Box>
      )
    }

    const termWidth = terminalSize?.columns ?? 80
    const weeks = globalStats.dateRange === "7d" ? 1 : globalStats.dateRange === "30d" ? 4 : 12

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={4} paddingBottom={1}>
          <Box flexDirection="column">
            <Text color={theme.textMuted as Color}>Total Sessions</Text>
            <Text color={theme.text as Color} bold>
              {globalStats.totalSessions}
            </Text>
          </Box>
          <Box flexDirection="column">
            <Text color={theme.textMuted as Color}>Current Streak</Text>
            <Text color={theme.success as Color} bold>
              {globalStats.currentStreak} days
            </Text>
          </Box>
          <Box flexDirection="column">
            <Text color={theme.textMuted as Color}>Longest Streak</Text>
            <Text color={theme.primary as Color} bold>
              {globalStats.longestStreak} days
            </Text>
          </Box>
        </Box>

        <Box flexDirection="column" paddingBottom={1}>
          <Text color={theme.text as Color} bold>
            Activity Heatmap
          </Text>
          <Box paddingTop={1} paddingBottom={1}>
            <Heatmap dailyActivity={globalStats.dailyActivity} weeks={weeks} width={termWidth} />
          </Box>
          {globalStats.peakDay && (
            <Text color={theme.textMuted as Color}>
              Peak day: {globalStats.peakDay.date} ({globalStats.peakDay.count} sessions)
            </Text>
          )}
        </Box>

        {globalStats.totalTokens > 0 && (
          <Box flexDirection="column" paddingBottom={1} paddingTop={1}>
            <Text color={theme.text as Color} bold>
              Factoid
            </Text>
            <Text color={theme.info as Color}>💡 {factoid}</Text>
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Box paddingLeft={2} paddingRight={2} flexDirection="column" gap={1} paddingBottom={1}>
      <Box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <Box flexDirection="row" gap={2}>
          <Text color={tab === "session" ? (theme.primary as Color) : (theme.text as Color)} bold>
            Session Statistics
          </Text>
          <Text color={theme.textMuted as Color}>|</Text>
          <Text color={tab === "global" ? (theme.primary as Color) : (theme.text as Color)} bold>
            Global Statistics
          </Text>
        </Box>
        <Text color={theme.textMuted as Color}>tab cycle · esc close</Text>
      </Box>

      {tab === "session" ? renderSessionTab() : renderGlobalTab()}

      {tab === "global" && (
        <Box paddingTop={1}>
          <Text color={theme.textMuted as Color}>
            Range: <Text color={theme.primary as Color}>{dateRange}</Text> (Press 'r' to cycle)
          </Text>
        </Box>
      )}
    </Box>
  )
}
