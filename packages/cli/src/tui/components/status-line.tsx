import { Box, type Color, TerminalSizeContext, Text } from "@liteai/ink"
import { memo, useContext, useMemo, useSyncExternalStore } from "react"
import { useLocal } from "../context/local"
import { useStats } from "../context/stats"
import { useTheme } from "../context/theme"
import { type AppState, useAppState } from "../state"
import { SessionTabStore } from "../state/session-tab-store"
import { useExitState } from "./global-exit-handler"

/** sessionID is optional — StatusLine renders in both boot (undefined) and active states. */
type Props = { sessionID?: string }

// ─── Column definitions ────────────────────────────────────────────────────────

type FooterColumn = {
  id: string
  header: string
  value: string
  color: string
  /** Measured width: max(header.length, value.length). Used for fixed-width layout. */
  width: number
  /** If true, this column absorbs remaining horizontal space. */
  flexGrow?: boolean
}

/** Minimum gap (in chars) between adjacent columns. */
const COLUMN_GAP = 2

/**
 * Build all footer columns. Every column is always present — missing data shows "—".
 * All data values use theme.text (white). Only "—" placeholders and context % use
 * distinct colors to avoid visual confusion.
 */
function buildColumns(
  stats: ReturnType<typeof useStats>,
  local: ReturnType<typeof useLocal>,
  state: Pick<AppState, "sessions" | "config" | "path" | "vcs" | "session_diff" | "session_status">,
  theme: ReturnType<typeof useTheme>["theme"],
  sessionID: string | undefined,
): FooterColumn[] {
  const cols: FooterColumn[] = []
  const textColor = theme.text as string
  const mutedColor = theme.textMuted as string

  const col = (id: string, header: string, value: string, color: string, flexGrow?: boolean) => {
    cols.push({ id, header, value, color, width: Math.max(header.length, value.length), flexGrow })
  }

  // 1. Worktree — absorbs remaining space
  const dir = state.path.directory || state.path.worktree || process.cwd()
  const dirParts = dir.replace(/\\/g, "/").split("/")
  const cwdText = dirParts[dirParts.length - 1] || dir
  col("worktree", "worktree", cwdText, textColor, true)

  // 2. Model + badges
  const parsed = local.model.parsed()
  let modelText = parsed.model
  if (sessionID) {
    const session = state.sessions.find((s) => s.id === sessionID)
    if (session?.toolProfile === "Plan") modelText += " 📋"
    const effort = (state.config as Record<string, unknown>).effort as string | undefined
    if (effort && effort !== "medium") modelText += ` ⚡${effort}`
    const sessionStatus = state.session_status?.[sessionID]
    if (sessionStatus && sessionStatus.type !== "idle") {
      if (sessionStatus.type === "busy") modelText += " busy…"
      else if (sessionStatus.type === "retry") modelText += " retrying…"
      else modelText += ` ${sessionStatus.type}`
    }
  }
  col("model", "model", modelText, textColor)

  // 3. Provider
  const providerID = parsed.provider || "—"
  col("provider", "provider", providerID, providerID === "—" ? mutedColor : textColor)

  // 4. Context %
  let ctxColor = theme.success as string
  let ctxValue = "0% used"
  if (sessionID) {
    const pct = Math.round(stats.contextUtilization * 100)
    ctxValue = `${pct}% used`
    if (stats.contextUtilization >= 0.85) ctxColor = theme.error as string
    else if (stats.contextUtilization >= 0.6) ctxColor = theme.warning as string
  }
  col("context", "context", ctxValue, ctxColor)

  // 5. Cost
  const costValue = sessionID && stats.totalCost !== null ? `$${stats.totalCost.toFixed(3)}` : "—"
  col("cost", "cost", costValue, costValue === "—" ? mutedColor : textColor)

  // 6. Tokens
  let tokValue = "0"
  if (sessionID) {
    const totalToks =
      stats.totalTokens.input +
      stats.totalTokens.output +
      stats.totalTokens.reasoning +
      stats.totalTokens.cache.read +
      stats.totalTokens.cache.write
    if (totalToks >= 1_000_000) tokValue = `${(totalToks / 1_000_000).toFixed(1)}M`
    else if (totalToks >= 1_000) tokValue = `${(totalToks / 1_000).toFixed(1)}k`
    else tokValue = `${totalToks}`
  }
  col("tokens", "tokens", tokValue, textColor)

  // 7. Git
  const gitValue = state.vcs?.branch ? `⎇ ${state.vcs.branch}` : "—"
  col("git", "git", gitValue, gitValue === "—" ? mutedColor : textColor)

  // 8. Changes
  let changesValue = "—"
  let changesColor = mutedColor
  if (sessionID) {
    const diff = state.session_diff[sessionID]
    if (diff && diff.length > 0) {
      let additions = 0
      let deletions = 0
      for (const d of diff) {
        additions += d.additions
        deletions += d.deletions
      }
      changesValue = `+${additions} -${deletions}`
      changesColor = textColor
    }
  }
  col("changes", "changes", changesValue, changesColor)

  return cols
}

// ─── Compact fallback (narrow terminals) ───────────────────────────────────────

type Segment = { text: string; color: string }

function buildCompactSegments(columns: FooterColumn[]): Segment[] {
  return columns.filter((c) => c.value !== "—").map((c) => ({ text: c.value, color: c.color }))
}

// ─── Component ─────────────────────────────────────────────────────────────────

/** Minimum width for two-row columnar mode. Below this, falls back to compact. */
const WIDE_MODE_MIN_COLS = 100

function StatusLineInner({ sessionID }: Props) {
  const { theme } = useTheme()
  const sessions = useAppState((s) => s.sessions)
  const config = useAppState((s) => s.config)
  const path = useAppState((s) => s.path)
  const vcs = useAppState((s) => s.vcs)
  const session_diff = useAppState((s) => s.session_diff)
  const session_status = useAppState((s) => s.session_status)

  const local = useLocal()
  const stats = useStats()
  const terminalSize = useContext(TerminalSizeContext)
  const exitState = useExitState()

  const termWidth = terminalSize?.columns ?? 80
  const isWideMode = termWidth >= WIDE_MODE_MIN_COLS

  const { tabs, activeTabId } = useSyncExternalStore(SessionTabStore.subscribe, SessionTabStore.getSnapshot)

  const allColumns = useMemo(
    () => buildColumns(stats, local, { sessions, config, path, vcs, session_diff, session_status }, theme, sessionID),
    [stats, local, sessions, config, path, vcs, session_diff, session_status, theme, sessionID],
  )

  // Exit pending: replace the entire status line with the exit prompt
  if (exitState.pending) {
    return (
      <Box flexDirection="row" flexWrap="nowrap" gap={0} paddingX={1} width="100%" marginTop={1}>
        <Text dim italic>
          Press {exitState.keyName} again to exit
        </Text>
      </Box>
    )
  }

  // ── Tab bar (multi-session) ──────────────────────────────────────────────
  const tabBar =
    tabs.length > 1 ? (
      <Box flexDirection="row" gap={2} paddingX={1} width="100%" marginBottom={0}>
        {tabs.slice(0, 9).map((tab, idx) => {
          const isActive = tab === activeTabId
          const sessionTitle = sessions.find((s) => s.id === tab)?.title ?? tab.slice(0, 8)
          const truncatedTitle = sessionTitle.length > 15 ? `${sessionTitle.slice(0, 12)}...` : sessionTitle
          return (
            <Box key={tab} flexDirection="row" gap={0}>
              <Text color={theme.textMuted as Color}>alt+{idx + 1} </Text>
              <Text color={isActive ? (theme.primary as Color) : (theme.text as Color)} bold={isActive}>
                {truncatedTitle}
              </Text>
            </Box>
          )
        })}
      </Box>
    ) : null

  // ── Wide mode: two-row columnar layout ───────────────────────────────────
  if (isWideMode) {
    // Calculate available width for the flex-grow (worktree) column.
    // Fixed columns get their measured width; gaps get COLUMN_GAP each.
    const fixedWidth = allColumns.filter((c) => !c.flexGrow).reduce((sum, c) => sum + c.width, 0)
    const gapCount = allColumns.length - 1
    const padding = 2 // paddingX={1}
    const worktreeWidth = Math.max(8, termWidth - padding - fixedWidth - gapCount * COLUMN_GAP)

    return (
      <Box flexDirection="column" width="100%" flexShrink={0} marginTop={1}>
        {tabBar}
        <Box flexDirection="row" flexWrap="nowrap" paddingX={1} width="100%">
          {allColumns.map((col, idx) => {
            const colWidth = col.flexGrow ? worktreeWidth : col.width
            return (
              <Box key={col.id} flexDirection="row" flexShrink={0}>
                {idx > 0 && <Box width={COLUMN_GAP} />}
                <Box flexDirection="column" width={colWidth}>
                  <Text color={theme.textMuted as Color}>{col.header}</Text>
                  <Text color={col.color as Color} bold={col.id === "model"} wrap="truncate-end">
                    {col.value}
                  </Text>
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  }

  // ── Compact mode: single-row pipe-separated ──────────────────────────────
  const compactSegments = buildCompactSegments(allColumns)

  return (
    <Box flexDirection="column" width="100%" flexShrink={0} marginTop={1}>
      {tabBar}
      <Box flexDirection="row" flexWrap="nowrap" gap={0} paddingX={1} width="100%">
        {compactSegments.map((seg, i) => (
          <Box flexDirection="row" key={i} flexShrink={0}>
            {i > 0 && <Text color={theme.textMuted as Color}>{" │ "}</Text>}
            <Text color={seg.color as Color}>{seg.text}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export const StatusLine = memo(StatusLineInner)
