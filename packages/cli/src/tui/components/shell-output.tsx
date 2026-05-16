/**
 * ShellOutput — bordered rendering for shell command execution.
 *
 * Provides a visually distinct bordered box for shell commands (run_command)
 * with a `$ command` header, windowed output during streaming, and an
 * exit code + duration footer after completion.
 *
 * Display modes:
 * - **Streaming**: Last N lines of output with `◌ Running...` indicator
 * - **Completed (success)**: Collapsed to last few lines + green border + exit code
 * - **Completed (error)**: More lines shown + red border + exit code
 *
 * @module components/shell-output
 */

import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { Locale } from "@liteai/util/locale"
import { useMemo } from "react"
import { useTheme } from "../context/theme"
import { Spinner } from "../ui/spinner"

/** Max visible lines during streaming. */
const STREAMING_WINDOW = 20
/** Max visible lines after successful completion. */
const SUCCESS_WINDOW = 5
/** Max visible lines after error completion — more context for debugging. */
const ERROR_WINDOW = 10

interface ShellOutputProps {
  /** The shell command that was executed. */
  command: string
  /** Working directory, already normalized/shortened. */
  cwd?: string
  /** Raw output text (already stripped of ANSI). */
  output: string
  /** Whether the command is currently running. */
  running: boolean
  /** Exit code (undefined while running). */
  exitCode?: number
  /** Duration in milliseconds (start to end). */
  durationMs?: number
  /** Click handler for expand/collapse behavior. */
  onClick?: () => void
  /** Whether expanded mode is active (show all output). */
  expanded?: boolean
  /** Error message from the tool state. */
  error?: string
}

export function ShellOutput({
  command,
  cwd,
  output,
  running,
  exitCode,
  durationMs,
  onClick,
  expanded,
  error,
}: ShellOutputProps) {
  const { theme } = useTheme()

  const isError = exitCode !== undefined && exitCode !== 0
  const borderColor = running ? (theme.accent as Color) : isError ? (theme.error as Color) : (theme.textMuted as Color)

  const lines = useMemo(() => output.split("\n"), [output])

  const windowSize = running ? STREAMING_WINDOW : isError ? ERROR_WINDOW : SUCCESS_WINDOW
  const overflow = lines.length > windowSize && !expanded
  const visibleOutput = useMemo(() => {
    if (expanded || lines.length <= windowSize) return output
    // Show last N lines for streaming/error; for success show last N lines
    return lines.slice(-windowSize).join("\n")
  }, [expanded, lines, windowSize, output])

  const headerText = cwd ? `$ ${command}  (${cwd})` : `$ ${command}`

  // Footer: exit code + duration after completion
  const footerText = useMemo(() => {
    if (running) return null
    const parts: string[] = []
    if (exitCode !== undefined) parts.push(`exit ${exitCode}`)
    if (durationMs !== undefined) parts.push(Locale.duration(durationMs))
    return parts.length > 0 ? parts.join(" ─── ") : null
  }, [running, exitCode, durationMs])

  return (
    <Box paddingLeft={3} marginTop={1} flexDirection="column">
      <Box borderStyle="round" borderColor={borderColor} flexDirection="column" paddingX={1} onClick={onClick}>
        {/* Header */}
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={1}>
            {running && <Spinner />}
            <Text bold color={theme.text as Color}>
              {headerText}
            </Text>
          </Box>
        </Box>

        {/* Output body */}
        {visibleOutput && (
          <Box flexDirection="column" marginTop={0}>
            {overflow && (
              <Text color={theme.textMuted as Color} italic>
                … ({lines.length - windowSize} lines above)
              </Text>
            )}
            <Text color={theme.text as Color}>{visibleOutput}</Text>
          </Box>
        )}

        {/* Running indicator */}
        {running && !output && (
          <Box marginTop={0}>
            <Text color={theme.textMuted as Color}>◌ Running...</Text>
          </Box>
        )}

        {/* Error display */}
        {error && (
          <Box marginTop={0}>
            <Text color={theme.error as Color}>{error}</Text>
          </Box>
        )}

        {/* Footer: exit code + duration */}
        {footerText && (
          <Box marginTop={0} flexDirection="row" justifyContent="flex-end">
            <Text color={isError ? (theme.error as Color) : (theme.textMuted as Color)}>{footerText}</Text>
          </Box>
        )}
      </Box>

      {/* Expand/collapse hint */}
      {overflow && onClick && (
        <Box paddingLeft={1}>
          <Text color={theme.textMuted as Color}>{expanded ? "Click to collapse" : "Click to expand"}</Text>
        </Box>
      )}
    </Box>
  )
}
