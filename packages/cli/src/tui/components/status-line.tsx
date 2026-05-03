import { Box, type Color, TerminalSizeContext, Text } from "@liteai/ink"
import { memo, useContext, useMemo } from "react"
import { useLocal } from "../context/local"
import { useStats } from "../context/stats"
import { useTheme } from "../context/theme"
import { useSessionContext } from "../routes/session/ctx"
import { type AppState, useAppState } from "../state"
import { useExitState } from "./global-exit-handler"

type Props = { sessionID: string }

type Segment = { priority: number; text: string; color: string }

function buildSegments(
  stats: ReturnType<typeof useStats>,
  local: ReturnType<typeof useLocal>,
  state: Pick<AppState, "sessions" | "config" | "path" | "vcs" | "session_diff">,
  theme: ReturnType<typeof useTheme>["theme"],
  sessionID: string,
  displayMode: "compact" | "transcript",
): Segment[] {
  const segments: Segment[] = []

  // 1. Model
  const parsed = local.model.parsed()
  segments.push({ priority: 1, text: parsed.model, color: theme.text as string })

  // 1.5. Mode Indicator
  if (displayMode === "transcript") {
    segments.push({ priority: 1.5, text: "Transcript (ctrl+o)", color: theme.success as string })
  } else {
    segments.push({ priority: 1.5, text: "Compact (ctrl+o)", color: theme.textMuted as string })
  }

  const session = state.sessions.find((s) => s.id === sessionID)
  if (session?.toolProfile === "Plan") {
    segments.push({ priority: 1.6, text: "📋 Plan", color: theme.warning as string })
  }

  // effort is a server-side config field not yet reflected in the SDK Config type
  const effort = (state.config as Record<string, unknown>).effort as string | undefined
  if (effort && effort !== "medium") {
    segments.push({ priority: 1.7, text: `⚡${effort}`, color: theme.textMuted as string })
  }

  // 2. Context %
  let ctxColor = theme.success
  if (stats.contextUtilization >= 0.85) ctxColor = theme.error
  else if (stats.contextUtilization >= 0.6) ctxColor = theme.warning
  segments.push({
    priority: 2,
    text: `${Math.round(stats.contextUtilization * 100)}% ctx`,
    color: ctxColor as string,
  })

  // 3. Cost (optional)
  if (stats.totalCost !== null) {
    segments.push({ priority: 3, text: `$${stats.totalCost.toFixed(3)}`, color: theme.text as string })
  }

  // 4. Tokens
  const totalToks =
    stats.totalTokens.input +
    stats.totalTokens.output +
    stats.totalTokens.reasoning +
    stats.totalTokens.cache.read +
    stats.totalTokens.cache.write

  let tokText = `${totalToks} tok`
  if (totalToks >= 1_000_000) tokText = `${(totalToks / 1_000_000).toFixed(1)}M tok`
  else if (totalToks >= 1_000) tokText = `${(totalToks / 1_000).toFixed(1)}k tok`
  segments.push({ priority: 4, text: tokText, color: theme.textMuted as string })

  // 5. CWD
  const dir = state.path.directory || state.path.worktree || process.cwd()
  const parts = dir.replace(/\\/g, "/").split("/")
  const cwdText = parts[parts.length - 1] || dir
  segments.push({ priority: 5, text: cwdText, color: theme.textMuted as string })

  // 6. Git Branch (optional)
  if (state.vcs?.branch) {
    segments.push({ priority: 6, text: `⎇ ${state.vcs.branch}`, color: theme.textMuted as string })
  }

  // 7. Code Changes (optional)
  const diff = state.session_diff[sessionID]
  if (diff && diff.length > 0) {
    let additions = 0
    let deletions = 0
    for (const d of diff) {
      additions += d.additions
      deletions += d.deletions
    }
    // Instead of multi-color in one segment string, we render it as text,
    // but the StatusLine component will just use theme.textMuted for this generic text for simplicity.
    // To support complex spans, we'd need a richer Segment type. For now, text is enough.
    segments.push({ priority: 7, text: `+${additions} -${deletions}`, color: theme.textMuted as string })
  }

  // 8. Session ID
  segments.push({ priority: 8, text: sessionID.slice(0, 8), color: theme.textMuted as string })

  // Sort by priority ascending (1 is highest priority)
  segments.sort((a, b) => a.priority - b.priority)

  return segments
}

function fitSegments(segments: Segment[], budget: number): { visible: Segment[]; truncated: boolean } {
  const SEPARATOR_WIDTH = 3 // " │ "
  let used = 0
  const visible: Segment[] = []

  for (const seg of segments) {
    const needed = seg.text.length + (visible.length > 0 ? SEPARATOR_WIDTH : 0)
    // Always admit the first segment (model) even if it blows the budget
    if (used + needed > budget && visible.length > 0) break
    visible.push(seg)
    used += needed
  }

  // Sort back to display order (which is priority order here, conveniently)
  return { visible, truncated: visible.length < segments.length }
}

function StatusLineInner({ sessionID }: Props) {
  const { theme } = useTheme()
  const sessions = useAppState((s) => s.sessions)
  const config = useAppState((s) => s.config)
  const path = useAppState((s) => s.path)
  const vcs = useAppState((s) => s.vcs)
  const session_diff = useAppState((s) => s.session_diff)
  const local = useLocal()
  const stats = useStats()
  const terminalSize = useContext(TerminalSizeContext)
  const exitState = useExitState()

  const columns = terminalSize?.columns ?? 80
  const budget = columns - 2 // paddingX={1} means 1 on each side
  const ctx = useSessionContext()

  const allSegments = useMemo(
    () =>
      buildSegments(
        stats,
        local,
        { sessions, config, path, vcs, session_diff },
        theme,
        sessionID,
        ctx?.displayMode ?? "compact",
      ),
    [stats, local, sessions, config, path, vcs, session_diff, theme, sessionID, ctx?.displayMode],
  )

  const { visible, truncated } = useMemo(() => fitSegments(allSegments, budget), [allSegments, budget])

  // Exit pending: replace the entire status line with the exit prompt
  if (exitState.pending) {
    return (
      <Box flexDirection="row" flexWrap="nowrap" gap={0} paddingX={1} width="100%">
        <Text dim italic>
          Press {exitState.keyName} again to exit
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="row" flexWrap="nowrap" gap={0} paddingX={1} width="100%">
      {visible.map((seg, i) => (
        <Box flexDirection="row" key={seg.priority} flexShrink={0}>
          {i > 0 && <Text color={theme.textMuted as Color}>{" │ "}</Text>}
          <Text color={seg.color as Color}>{seg.priority === 1 ? <Text bold>{seg.text}</Text> : seg.text}</Text>
        </Box>
      ))}
      {truncated && (
        <Box flexShrink={0}>
          <Text color={theme.textMuted as Color}>…</Text>
        </Box>
      )}
    </Box>
  )
}

export const StatusLine = memo(StatusLineInner)
