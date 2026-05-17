import { Box, type Color, stringWidth, TerminalSizeContext, Text } from "@liteai/ink"
import { memo, useContext, useMemo, useSyncExternalStore } from "react"
import { useLocal } from "../context/local"
import { useStats } from "../context/stats"
import { useTheme } from "../context/theme"
import { type AppState, useAppState } from "../state"
import { SessionTabStore } from "../state/session-tab-store"

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
  /** If > 0, this column is allowed to shrink when space is tight. */
  flexShrink?: number
  /** How to wrap/truncate the text. Defaults to 'truncate-end'. */
  wrap?: "truncate-middle" | "truncate-start" | "truncate-end"
}

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

  const col = (
    id: string,
    header: string,
    value: string,
    color: string,
    flexShrink = 0,
    wrap: FooterColumn["wrap"] = "truncate-end",
  ) => {
    cols.push({ id, header, value, color, width: Math.max(stringWidth(header), stringWidth(value)), flexShrink, wrap })
  }

  // 1. Workspace
  const dir = state.path.directory || state.path.worktree || process.cwd()
  let displayPath = dir.replace(/\\/g, "/")
  const home = state.path.home ? state.path.home.replace(/\\/g, "/") : ""
  if (home && displayPath.startsWith(home)) {
    displayPath = `~${displayPath.slice(home.length)}`
  }
  col("workspace", "workspace (/directory)", displayPath, textColor, 1, "truncate-middle")

  // 2. Branch
  const branchValue = state.vcs?.branch || "—"
  col("branch", "branch", branchValue, branchValue === "—" ? mutedColor : textColor)

  // 3. Model + badges
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

  // 4. Provider
  const providerID = parsed.provider || "—"
  col("provider", "provider", providerID, providerID === "—" ? mutedColor : textColor)

  // 5. Context %
  let ctxColor = theme.success as string
  let ctxValue = "0% used"
  if (sessionID) {
    const pct = Math.round(stats.contextUtilization * 100)
    ctxValue = `${pct}% used`
    if (stats.contextUtilization >= 0.85) ctxColor = theme.error as string
    else if (stats.contextUtilization >= 0.6) ctxColor = theme.warning as string
  }
  col("context", "context", ctxValue, ctxColor)

  // 6. Cost
  const costValue = sessionID && stats.totalCost !== null ? `$${stats.totalCost.toFixed(3)}` : "—"
  col("cost", "cost", costValue, costValue === "—" ? mutedColor : textColor)

  // 7. Tokens
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

type Segment = { id: string; text: string; color: string }

function buildCompactSegments(columns: FooterColumn[]): Segment[] {
  return columns.filter((c) => c.value !== "—").map((c) => ({ id: c.id, text: c.value, color: c.color }))
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

  const termWidth = terminalSize?.columns ?? 80
  const isWideMode = termWidth >= WIDE_MODE_MIN_COLS

  const { tabs, activeTabId } = useSyncExternalStore(SessionTabStore.subscribe, SessionTabStore.getSnapshot)

  const allColumns = useMemo(
    () => buildColumns(stats, local, { sessions, config, path, vcs, session_diff, session_status }, theme, sessionID),
    [stats, local, sessions, config, path, vcs, session_diff, session_status, theme, sessionID],
  )

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
    return (
      <Box flexDirection="column" width="100%" flexShrink={0} marginTop={1}>
        {tabBar}
        <Box flexDirection="row" flexWrap="nowrap" justifyContent="space-between" paddingX={1} width="100%">
          {allColumns.map((col) => (
            <Box key={col.id} flexDirection="column" width={col.width} flexShrink={col.flexShrink ?? 0}>
              <Text color={theme.textMuted as Color}>{col.header}</Text>
              <Text color={col.color as Color} bold={col.id === "model"} wrap={col.wrap || "truncate-end"}>
                {col.value}
              </Text>
            </Box>
          ))}
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
          <Box flexDirection="row" key={seg.id} flexShrink={0}>
            {i > 0 && <Text color={theme.textMuted as Color}>{" │ "}</Text>}
            <Text color={seg.color as Color}>{seg.text}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export const StatusLine = memo(StatusLineInner)
