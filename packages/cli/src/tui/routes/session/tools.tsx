import path from "node:path"
import { Global } from "@liteai/core/global/index"
import type { Tool } from "@liteai/core/tool/tool"
import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type { ToolPart } from "@liteai/sdk"
import { Fs as Filesystem } from "@liteai/util/fs"
import type React from "react"
import { useEffect, useMemo, useState } from "react"
import stripAnsi from "strip-ansi"
import { ShellOutput } from "../../components/shell-output"
import { StructuredDiff } from "../../components/structured-diff"
import { ToolStatusIndicator } from "../../components/tool-status-indicator"
import { COMPACT_DIFF_MAX_LINES } from "../../constants/compact-diff"
import { ToolDisplayStatus } from "../../constants/tool-status"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { useElapsedTime } from "../../hooks/use-elapsed-time"
import { useOutputFile } from "../../hooks/use-output-file"
import { selectMessages, useAppActions, useAppState } from "../../state"
import { shortenPath } from "../../util/output-file"
import { useSessionContext } from "./ctx"
import { formatInput, normalizePath } from "./utils"

// ---------------------------------------------------------------------------
// Per-tool input/metadata shape interfaces
//
// The SDK's ToolPart.state.input is typed as Record<string, unknown>.
// These interfaces document the expected shape for each tool and enable
// type-safe access via the `typed()` helper below.
// ---------------------------------------------------------------------------

interface RunCommandInput {
  command?: string
  cwd?: string
  description?: string
}
interface RunCommandMetadata {
  output?: string
}

interface WriteInput {
  filePath?: string
  content?: string
}
interface WriteMetadata {
  diagnostics?: Record<string, unknown[]>
}

interface EditInput {
  filePath?: string
  replaceAll?: boolean
}
interface EditMetadata {
  diff?: string
  diagnostics?: Record<string, unknown[]>
}

interface ReadInput {
  filePath?: string
}
interface ReadMetadata {
  loaded?: string[]
}

interface GlobInput {
  pattern?: string
  path?: string
}
interface GlobMetadata {
  count?: number
}

interface GrepInput {
  pattern?: string
  path?: string
}
interface GrepMetadata {
  matches?: number
}

interface ListInput {
  path?: string
}

interface WebFetchInput {
  url?: string
}

interface CodeSearchInput {
  query?: string
}
interface CodeSearchMetadata {
  results?: number
}

interface WebSearchInput {
  query?: string
}
interface WebSearchMetadata {
  numResults?: number
}

interface TaskInput {
  description?: string
}
interface TaskMetadata {
  sessionId?: string
}

interface QuestionInput {
  questions?: Array<{ question: string }>
}
interface QuestionMetadata {
  answers?: string[][]
}

interface SkillInput {
  name?: string
}

interface CommandStatusInput {
  CommandId?: string
}
interface CommandStatusMetadata {
  commandId?: string
  output?: string
  status?: string
}

interface SendCommandInputInput {
  CommandId?: string
  Terminate?: boolean
}
interface SendCommandInputMetadata {
  commandId?: string
  output?: string
}

interface ApplyPatchFile {
  type: string
  relativePath: string
  diff?: string
  deletions?: number
}
interface ApplyPatchMetadata {
  files?: ApplyPatchFile[]
}

interface TodoItem {
  status: string
  content: string
}
interface TodoWriteMetadata {
  todos?: TodoItem[]
}

/**
 * Single-point type assertion for tool input/metadata.
 * Isolates the unavoidable cast from Record<string, unknown> to a concrete
 * shape into one location, keeping all call sites type-safe.
 */
function typed<T>(obj: Record<string, unknown> | undefined): T {
  return (obj ?? {}) as T
}

function extractToolTiming(part?: ToolPart): { startTime?: number; endTime?: number } {
  if (!part) return {}
  if (part.state.status === "running") return { startTime: part.state.time.start }
  if (part.state.status === "completed" || part.state.status === "error")
    return { startTime: part.state.time.start, endTime: part.state.time.end }
  return {}
}

// ---------------------------------------------------------------------------
// ViewParts — the output of every tool formatter function
// ---------------------------------------------------------------------------

/**
 * Unified output from every tool formatter. Consumed by DenseToolMessage.
 */
export interface ViewParts {
  /** Muted text after tool name (e.g., file path, command, query) */
  description?: React.ReactNode
  /** Result summary with → prefix (e.g., "→ 5 matches") */
  summary?: React.ReactNode
  /** Expandable content below the tool line (diff, shell output, Q&A) */
  payload?: React.ReactNode
}

// ---------------------------------------------------------------------------
// ToolProps — base props for all tool render components
// ---------------------------------------------------------------------------

export type ToolProps<T extends Tool.Info = Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission?: Record<string, unknown>
  tool: string
  output?: string
  part: ToolPart
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function Diagnostics({ diagnostics, filePath }: { diagnostics?: Record<string, unknown[]>; filePath: string }) {
  const { theme } = useTheme()
  const errors = useMemo(() => {
    const normalized = Filesystem.normalizePath(filePath)
    const arr = diagnostics?.[normalized] ?? []
    return arr
      .filter(
        (x): x is { severity: number; range: { start: { line: number; character: number } }; message: string } =>
          typeof x === "object" && x !== null && "severity" in x && (x as { severity: number }).severity === 1,
      )
      .slice(0, 3)
  }, [diagnostics, filePath])

  if (!errors.length) return null

  return (
    <Box flexDirection="column">
      {errors.map((diagnostic, i) => (
        <Text key={i} color={theme.error as Color}>
          Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}] {diagnostic.message}
        </Text>
      ))}
    </Box>
  )
}

function computeDiffStats(diff?: string) {
  if (!diff) return ""
  let added = 0
  let removed = 0
  const lines = diff.split("\n")
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++
    else if (line.startsWith("-") && !line.startsWith("---")) removed++
  }
  if (added === 0 && removed === 0) return ""
  return `+${added}/-${removed}`
}

function truncateDiff(diff: string, maxLines: number): string {
  const lines = diff.split("\n")
  if (lines.length <= maxLines) return diff
  return `${lines.slice(0, maxLines).join("\n")}\n… (${lines.length - maxLines} more lines)`
}

// ---------------------------------------------------------------------------
// DenseToolMessage — unified rendering for ALL tool calls
// ---------------------------------------------------------------------------

/**
 * Unified tool call renderer adapted from Gemini CLI's DenseToolMessage.
 *
 * Layout: [status indicator (2ch)] [bold name (max 25ch)] [muted description] → [result summary]
 * Optional: expandable payload beneath the tool line
 */
export function DenseToolMessage({
  status,
  toolName,
  viewParts,
  part,
  strikethrough,
}: {
  status: ToolDisplayStatus
  toolName: string
  viewParts: ViewParts
  part: ToolPart
  strikethrough?: boolean
}) {
  const { theme } = useTheme()
  const config = useTuiConfig()
  const timing = useElapsedTime({
    startTime: extractToolTiming(part).startTime ?? null,
    endTime: extractToolTiming(part).endTime,
  })
  const timingSuffix = timing.formatted ? ` (${timing.formatted})` : ""

  const error = part.state.status === "error" ? part.state.error : undefined
  const displayError = error && config.errorVerbosity === "low" ? error.split("\n")[0] : error

  // Don't show error text for cancelled tools (already indicated by status icon + strikethrough)
  const isCancelled = status === ToolDisplayStatus.Cancelled
  const showError = displayError && !isCancelled

  // Truncate tool name to 25 characters
  const displayName = toolName.length > 25 ? `${toolName.slice(0, 24)}…` : toolName

  return (
    <Box paddingLeft={3} flexDirection="column">
      <Box gap={1}>
        <ToolStatusIndicator status={status} />
        <Text>
          <Text bold color={strikethrough ? (theme.textMuted as Color) : undefined} strikethrough={strikethrough}>
            {displayName}
          </Text>
          {viewParts.description && <Text color={theme.textMuted as Color}> {viewParts.description}</Text>}
          {viewParts.summary && <Text color={theme.textMuted as Color}> → {viewParts.summary}</Text>}
          {timingSuffix && <Text color={theme.textMuted as Color}>{timingSuffix}</Text>}
        </Text>
      </Box>
      {showError && <Text color={theme.error as Color}>{displayError}</Text>}
      {viewParts.payload && (
        <Box paddingLeft={3} marginTop={0}>
          {viewParts.payload}
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Per-tool formatter functions — each returns ViewParts
// ---------------------------------------------------------------------------

function getReadViewParts(
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
  _output: string | undefined,
  part: ToolPart,
): ViewParts {
  const inp = typed<ReadInput>(input)
  const meta = typed<ReadMetadata>(metadata)
  const loaded =
    part.state.status === "completed" && Array.isArray(meta.loaded)
      ? meta.loaded.filter((p): p is string => typeof p === "string")
      : []

  return {
    description: normalizePath(inp.filePath),
    summary: loaded.length > 1 ? `${loaded.length} files loaded` : undefined,
  }
}

function getWriteViewParts(
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
  _output: string | undefined,
  _part: ToolPart,
): ViewParts {
  const inp = typed<WriteInput>(input)
  const meta = typed<WriteMetadata>(metadata)
  const isComplete = meta.diagnostics !== undefined

  const viewParts: ViewParts = {
    description: normalizePath(inp.filePath),
  }

  if (isComplete) {
    viewParts.summary = "Accepted"
    // Show code content as payload for compact view
    if (inp.content && inp.content.split("\n").length <= COMPACT_DIFF_MAX_LINES) {
      viewParts.payload = (
        <Box flexDirection="column">
          <StructuredDiff modifiedContent={truncateDiff(inp.content, COMPACT_DIFF_MAX_LINES)} />
          <Diagnostics diagnostics={meta.diagnostics} filePath={inp.filePath ?? ""} />
        </Box>
      )
    }
  }

  return viewParts
}

function getEditViewParts(input: Record<string, unknown>, metadata: Record<string, unknown>): ViewParts {
  const inp = typed<EditInput>(input)
  const meta = typed<EditMetadata>(metadata)
  const hasDiff = meta.diff !== undefined

  const viewParts: ViewParts = {
    description: normalizePath(inp.filePath),
  }

  if (hasDiff) {
    const stats = computeDiffStats(meta.diff)
    viewParts.summary = `Accepted${stats ? ` (${stats})` : ""}`
    if (meta.diff) {
      viewParts.payload = (
        <Box flexDirection="column">
          <StructuredDiff modifiedContent={truncateDiff(meta.diff, COMPACT_DIFF_MAX_LINES)} />
          <Diagnostics diagnostics={meta.diagnostics} filePath={inp.filePath ?? ""} />
        </Box>
      )
    }
  }

  return viewParts
}

function getGlobViewParts(input: Record<string, unknown>, metadata: Record<string, unknown>): ViewParts {
  const inp = typed<GlobInput>(input)
  const meta = typed<GlobMetadata>(metadata)
  return {
    description: <>{`"${inp.pattern ?? ""}"${inp.path ? ` in ${normalizePath(inp.path)}` : ""}`}</>,
    summary: meta.count !== undefined ? `${meta.count} ${meta.count === 1 ? "match" : "matches"}` : undefined,
  }
}

function getGrepViewParts(input: Record<string, unknown>, metadata: Record<string, unknown>): ViewParts {
  const inp = typed<GrepInput>(input)
  const meta = typed<GrepMetadata>(metadata)
  return {
    description: <>{`"${inp.pattern ?? ""}"${inp.path ? ` in ${normalizePath(inp.path)}` : ""}`}</>,
    summary: meta.matches !== undefined ? `${meta.matches} ${meta.matches === 1 ? "match" : "matches"}` : undefined,
  }
}

function getListViewParts(input: Record<string, unknown>): ViewParts {
  const inp = typed<ListInput>(input)
  return { description: normalizePath(inp.path) }
}

function getWebFetchViewParts(input: Record<string, unknown>): ViewParts {
  const inp = typed<WebFetchInput>(input)
  return { description: inp.url }
}

function getCodeSearchViewParts(input: Record<string, unknown>, metadata: Record<string, unknown>): ViewParts {
  const inp = typed<CodeSearchInput>(input)
  const meta = typed<CodeSearchMetadata>(metadata)
  return {
    description: `"${inp.query ?? ""}"`,
    summary: meta.results !== undefined ? `${meta.results} results` : undefined,
  }
}

function getWebSearchViewParts(input: Record<string, unknown>, metadata: Record<string, unknown>): ViewParts {
  const inp = typed<WebSearchInput>(input)
  const meta = typed<WebSearchMetadata>(metadata)
  return {
    description: `"${inp.query ?? ""}"`,
    summary: meta.numResults !== undefined ? `${meta.numResults} results` : undefined,
  }
}

function getSkillViewParts(input: Record<string, unknown>): ViewParts {
  const inp = typed<SkillInput>(input)
  return { description: `"${inp.name ?? ""}"` }
}

function getPlanEnterViewParts(): ViewParts {
  return { description: "Entering plan mode" }
}

function getPlanExitViewParts(): ViewParts {
  return { description: "Exiting plan mode" }
}

function getGenericViewParts(
  input: Record<string, unknown>,
  _metadata: Record<string, unknown>,
  output: string | undefined,
): ViewParts {
  const viewParts: ViewParts = {
    description: formatInput(input),
  }
  if (output) {
    const trimmed = output.trim()
    const lines = trimmed.split("\n")
    if (lines.length <= 3) {
      viewParts.summary = trimmed
    } else {
      viewParts.summary = `${lines.length} lines`
    }
  }
  return viewParts
}

// ---------------------------------------------------------------------------
// Special tool components — need hooks / state, so they render as components
// ---------------------------------------------------------------------------

/**
 * RunCommand — retains its specialized ShellOutput sub-view as payload.
 * The header row uses the unified DenseToolMessage pattern.
 */
export function RunCommandView({ toolprops, status }: { toolprops: ToolProps; status: ToolDisplayStatus }) {
  const { theme } = useTheme()
  const directory = useAppState((s) => s.path.directory)
  const ctx = useSessionContext()
  const input = typed<RunCommandInput>(toolprops.input as Record<string, unknown>)
  const metadata = typed<RunCommandMetadata>(toolprops.metadata as Record<string, unknown>)
  const running = toolprops.part.state.status === "running"
  const output = useMemo(() => stripAnsi(metadata.output?.trim() ?? ""), [metadata])
  const { savedPath } = useOutputFile({
    output,
    sessionID: ctx.sessionID,
    callID: toolprops.part.callID,
  })
  const [expanded, setExpanded] = useState(false)
  const lines = useMemo(() => output.split("\n"), [output])

  const dir = useMemo(() => {
    const workdir = input.cwd
    if (!workdir || workdir === ".") return undefined
    const base = directory
    if (!base) return undefined
    const absolute = path.resolve(base, workdir)
    if (absolute === base) return undefined
    const home = Global.Path.home
    if (!home) return absolute
    const match = absolute === home || absolute.startsWith(home + path.sep)
    return match ? absolute.replace(home, "~") : absolute
  }, [input.cwd, directory])

  const exitCode = useMemo(() => {
    if (running) return undefined
    if (toolprops.part.state.status === "error") return 1
    const raw = toolprops.output ?? ""
    const match = raw.match(/"?exit_?[Cc]ode"?\s*:\s*(\d+)/)
    return match ? parseInt(match[1], 10) : toolprops.part.state.status === "completed" ? 0 : undefined
  }, [running, toolprops.part.state.status, toolprops.output])

  const durationMs = useMemo(() => {
    const timing = extractToolTiming(toolprops.part)
    if (timing.startTime && timing.endTime) return timing.endTime - timing.startTime
    return undefined
  }, [toolprops.part])

  const toolError = toolprops.part.state.status === "error" ? toolprops.part.state.error : undefined

  const cmdDisplay = input.command ?? ""
  const cwdSuffix = dir ? ` in ${dir}` : ""

  // If we have output, show ShellOutput as the payload
  if (metadata.output !== undefined) {
    // Compact mode: inline summary
    if (ctx?.isToolCompact(toolprops.tool)) {
      return (
        <DenseToolMessage
          status={status}
          toolName="run_command"
          viewParts={{
            description: cmdDisplay,
            summary: savedPath ? `output: ${shortenPath(savedPath)}` : "completed",
          }}
          part={toolprops.part}
        />
      )
    }

    // Large output saved to file — show preview
    if (savedPath) {
      const preview = lines.slice(0, 50).join("\n")
      return (
        <DenseToolMessage
          status={status}
          toolName="run_command"
          viewParts={{
            description: `${cmdDisplay}${cwdSuffix}`,
            summary: `${output.length.toLocaleString()} chars`,
            payload: (
              <Box flexDirection="column" gap={1}>
                <Text color={theme.text as Color}>$ {cmdDisplay}</Text>
                {preview && <Text color={theme.text as Color}>{preview}</Text>}
                <Text color={theme.textMuted as Color}>── Full output: {shortenPath(savedPath)}</Text>
              </Box>
            ),
          }}
          part={toolprops.part}
        />
      )
    }

    // Standard shell output — use ShellOutput sub-view as payload
    return (
      <ShellOutput
        command={cmdDisplay}
        cwd={dir}
        output={output}
        running={running}
        exitCode={exitCode}
        durationMs={durationMs}
        onClick={lines.length > 5 ? () => setExpanded((prev) => !prev) : undefined}
        expanded={expanded}
        error={toolError}
      />
    )
  }

  // Pending state — no output yet
  return (
    <DenseToolMessage
      status={status}
      toolName="run_command"
      viewParts={{ description: cmdDisplay }}
      part={toolprops.part}
    />
  )
}

/**
 * TaskView — needs hooks for session sync and tool count.
 */
export function TaskView({ toolprops, status }: { toolprops: ToolProps; status: ToolDisplayStatus }) {
  const {
    session: { sync: syncSession },
  } = useAppActions()
  const partsMap = useAppState((s) => s.part)
  const input = typed<TaskInput>(toolprops.input as Record<string, unknown>)
  const metadata = typed<TaskMetadata>(toolprops.metadata as Record<string, unknown>)
  const sessionID = metadata.sessionId

  const messages = useAppState(selectMessages(sessionID ?? ""))

  useEffect(() => {
    if (sessionID && !messages?.length) {
      syncSession(sessionID)
    }
  }, [sessionID, messages?.length, syncSession])

  const toolCount = useMemo(() => {
    return messages.flatMap((msg) => (partsMap[msg.id] ?? []).filter((p) => p.type === "tool")).length
  }, [messages, partsMap])

  return (
    <DenseToolMessage
      status={status}
      toolName="task"
      viewParts={{
        description: input.description,
        summary: toolCount > 0 ? `${toolCount} toolcalls` : undefined,
      }}
      part={toolprops.part}
    />
  )
}

/**
 * QuestionView — FR-015: completed questions hide description, show answer.
 */
export function QuestionView({ toolprops, status }: { toolprops: ToolProps; status: ToolDisplayStatus }) {
  const input = typed<QuestionInput>(toolprops.input as Record<string, unknown>)
  const metadata = typed<QuestionMetadata>(toolprops.metadata as Record<string, unknown>)
  const questions = input.questions ?? []
  const answers = metadata.answers

  if (answers) {
    // Completed: hide description, show answer as summary (FR-015)
    const answerText = answers.map((a) => a.join(", ")).join("; ")
    return (
      <DenseToolMessage
        status={status}
        toolName="ask_user"
        viewParts={{
          summary: answerText || "(no answer)",
        }}
        part={toolprops.part}
      />
    )
  }

  // Pending: show question text as description
  return (
    <DenseToolMessage
      status={status}
      toolName="ask_user"
      viewParts={{
        description:
          questions.length > 0 ? `${questions.length} question${questions.length !== 1 ? "s" : ""}` : undefined,
      }}
      part={toolprops.part}
    />
  )
}

/**
 * TodoWriteView — FR-016: render checklist items as payload.
 */
function TodoWriteView({ toolprops, status }: { toolprops: ToolProps; status: ToolDisplayStatus }) {
  const metadata = typed<TodoWriteMetadata>(toolprops.metadata as Record<string, unknown>)
  const todos = metadata.todos ?? []

  return (
    <DenseToolMessage
      status={status}
      toolName="todowrite"
      viewParts={{
        description: "Todos",
        summary: todos.length > 0 ? `${todos.length} items` : "No todos",
        payload:
          todos.length > 0 ? (
            <Box flexDirection="column">
              {todos.map((todo, i) => (
                <Box key={i} gap={1}>
                  <Text>[{todo.status === "done" ? "x" : " "}]</Text>
                  <Text>{todo.content}</Text>
                </Box>
              ))}
            </Box>
          ) : undefined,
      }}
      part={toolprops.part}
    />
  )
}

/**
 * CommandStatusView — needs output file hook.
 */
function CommandStatusView({ toolprops, status }: { toolprops: ToolProps; status: ToolDisplayStatus }) {
  const { theme } = useTheme()
  const input = typed<CommandStatusInput>(toolprops.input as Record<string, unknown>)
  const metadata = typed<CommandStatusMetadata>(toolprops.metadata as Record<string, unknown>)
  const output = stripAnsi((toolprops.output || metadata.output || "") as string)
  const ctx = useSessionContext()
  const { savedPath } = useOutputFile({
    output,
    sessionID: ctx.sessionID,
    callID: toolprops.part.callID,
  })
  // expanded state is read-only — Ink Text lacks onClick, so the expand/collapse hint is visual-only
  const [expanded, _setExpanded] = useState(false)
  const lines = output.split("\n")
  const overflow = lines.length > 10
  const limited = expanded || !overflow ? output : [...lines.slice(0, 10), "…"].join("\n")
  const cmdId = metadata.commandId || input.CommandId || "unknown"

  if (metadata.output !== undefined || toolprops.output) {
    if (ctx?.isToolCompact(toolprops.tool)) {
      return (
        <DenseToolMessage
          status={status}
          toolName="command_status"
          viewParts={{ description: cmdId }}
          part={toolprops.part}
        />
      )
    }

    if (savedPath) {
      const preview = lines.slice(0, 50).join("\n")
      return (
        <DenseToolMessage
          status={status}
          toolName="command_status"
          viewParts={{
            description: cmdId,
            summary: `${output.length.toLocaleString()} chars`,
            payload: (
              <Box flexDirection="column" gap={1}>
                <Text color={theme.text as Color}>{metadata.status === "running" ? "Running" : "Completed"}</Text>
                {preview && <Text color={theme.text as Color}>{preview}</Text>}
                <Text color={theme.textMuted as Color}>── Full output: {shortenPath(savedPath)}</Text>
              </Box>
            ),
          }}
          part={toolprops.part}
        />
      )
    }

    return (
      <DenseToolMessage
        status={status}
        toolName="command_status"
        viewParts={{
          description: cmdId,
          payload: output ? (
            <Box flexDirection="column" gap={1}>
              <Text color={theme.text as Color}>{metadata.status === "running" ? "Running" : "Completed"}</Text>
              {output && <Text color={theme.text as Color}>{limited}</Text>}
              {overflow && (
                <Text color={theme.textMuted as Color}>{expanded ? "Click to collapse" : "Click to expand"}</Text>
              )}
            </Box>
          ) : undefined,
        }}
        part={toolprops.part}
      />
    )
  }

  return (
    <DenseToolMessage
      status={status}
      toolName="command_status"
      viewParts={{ description: cmdId }}
      part={toolprops.part}
    />
  )
}

/**
 * SendCommandInputView — needs output file hook.
 */
function SendCommandInputView({ toolprops, status }: { toolprops: ToolProps; status: ToolDisplayStatus }) {
  const { theme } = useTheme()
  const input = typed<SendCommandInputInput>(toolprops.input as Record<string, unknown>)
  const metadata = typed<SendCommandInputMetadata>(toolprops.metadata as Record<string, unknown>)
  const output = stripAnsi((toolprops.output || metadata.output || "") as string)
  const text = input.Terminate ? "Sending terminate signal" : "Sending input"
  const cmdId = metadata.commandId || input.CommandId || "unknown"

  if (metadata.output !== undefined || toolprops.output) {
    return (
      <DenseToolMessage
        status={status}
        toolName="send_command_input"
        viewParts={{
          description: `${text}: ${cmdId}`,
          payload: output ? (
            <Box flexDirection="column" gap={1}>
              <Text color={theme.text as Color}>{output}</Text>
            </Box>
          ) : undefined,
        }}
        part={toolprops.part}
      />
    )
  }

  return (
    <DenseToolMessage
      status={status}
      toolName="send_command_input"
      viewParts={{ description: `${text}: ${cmdId}` }}
      part={toolprops.part}
    />
  )
}

/**
 * ApplyPatchView — needs compact diff rendering.
 */
function ApplyPatchView({ toolprops, status }: { toolprops: ToolProps; status: ToolDisplayStatus }) {
  const { theme } = useTheme()
  const metadata = typed<ApplyPatchMetadata>(toolprops.metadata as Record<string, unknown>)
  const files = metadata.files ?? []

  if (files.length > 0) {
    const fileNames = files.map((f) => path.basename(f.relativePath)).join(", ")
    const budget = Math.max(3, Math.floor(COMPACT_DIFF_MAX_LINES / files.length))

    return (
      <DenseToolMessage
        status={status}
        toolName="apply_patch"
        viewParts={{
          description: `${files.length} file${files.length === 1 ? "" : "s"}: ${fileNames}`,
          payload: (
            <Box flexDirection="column">
              {files.map((f, i) => {
                if (f.type === "delete") {
                  return (
                    <Text key={i} color={theme.error as Color}>
                      Deleted {f.relativePath} (-{f.deletions} lines)
                    </Text>
                  )
                }
                if (!f.diff) return null
                return (
                  <Box key={i} flexDirection="column">
                    <Text color={theme.textMuted as Color}>
                      {f.type === "add" ? "Created" : "Patched"} {f.relativePath}
                    </Text>
                    <StructuredDiff modifiedContent={truncateDiff(f.diff, budget)} />
                  </Box>
                )
              })}
            </Box>
          ),
        }}
        part={toolprops.part}
      />
    )
  }

  return (
    <DenseToolMessage
      status={status}
      toolName="apply_patch"
      viewParts={{ description: "Preparing patch…" }}
      part={toolprops.part}
    />
  )
}

/**
 * GenericToolView — fallback with output file support.
 */
function GenericToolView({ toolprops, status }: { toolprops: ToolProps; status: ToolDisplayStatus }) {
  const { theme } = useTheme()
  const ctx = useSessionContext()
  const output = useMemo(() => toolprops.output?.trim() ?? "", [toolprops.output])
  const { savedPath } = useOutputFile({
    output,
    sessionID: ctx.sessionID,
    callID: toolprops.part.callID,
  })
  const lines = useMemo(() => output.split("\n"), [output])

  if (output && ctx.showGenericToolOutput) {
    if (savedPath) {
      const preview = lines.slice(0, 50).join("\n")
      return (
        <DenseToolMessage
          status={status}
          toolName={toolprops.tool}
          viewParts={{
            description: formatInput(toolprops.input as Record<string, unknown>),
            summary: `${output.length.toLocaleString()} chars`,
            payload: (
              <Box gap={1} flexDirection="column">
                {preview && <Text color={theme.text as Color}>{preview}</Text>}
                <Text color={theme.textMuted as Color}>── Full output: {shortenPath(savedPath)}</Text>
              </Box>
            ),
          }}
          part={toolprops.part}
        />
      )
    }

    const max = 3
    const overflow = lines.length > max
    const limited = overflow ? [...lines.slice(0, max), "…"].join("\n") : output
    return (
      <DenseToolMessage
        status={status}
        toolName={toolprops.tool}
        viewParts={{
          description: formatInput(toolprops.input as Record<string, unknown>),
          payload: (
            <Box gap={1} flexDirection="column">
              <Text color={theme.text as Color}>{limited}</Text>
            </Box>
          ),
        }}
        part={toolprops.part}
      />
    )
  }

  return (
    <DenseToolMessage
      status={status}
      toolName={toolprops.tool}
      viewParts={getGenericViewParts(
        toolprops.input as Record<string, unknown>,
        toolprops.metadata as Record<string, unknown>,
        toolprops.output,
      )}
      part={toolprops.part}
    />
  )
}

// ---------------------------------------------------------------------------
// Unified tool dispatcher — replaces the old switch statement in parts.tsx
// ---------------------------------------------------------------------------

/**
 * Renders any tool call through the unified DenseToolMessage pattern.
 * Stateless tools use pure formatter functions; stateful tools use dedicated components.
 */
export function UnifiedToolView({ toolprops, status }: { toolprops: ToolProps; status: ToolDisplayStatus }) {
  const strikethrough = status === ToolDisplayStatus.Cancelled

  // Special tools that need React hooks / state — render as components
  switch (toolprops.tool) {
    case "run_command":
      return <RunCommandView toolprops={toolprops} status={status} />
    case "task":
      return <TaskView toolprops={toolprops} status={status} />
    case "ask_user":
      return <QuestionView toolprops={toolprops} status={status} />
    case "todowrite":
      return <TodoWriteView toolprops={toolprops} status={status} />
    case "command_status":
      return <CommandStatusView toolprops={toolprops} status={status} />
    case "send_command_input":
      return <SendCommandInputView toolprops={toolprops} status={status} />
    case "apply_patch":
      return <ApplyPatchView toolprops={toolprops} status={status} />
  }

  // Pure formatter tools — use formatter functions + DenseToolMessage
  const input = toolprops.input as Record<string, unknown>
  const metadata = toolprops.metadata as Record<string, unknown>
  const output = toolprops.output

  let viewParts: ViewParts

  switch (toolprops.tool) {
    case "read":
      viewParts = getReadViewParts(input, metadata, output, toolprops.part)
      break
    case "write":
      viewParts = getWriteViewParts(input, metadata, output, toolprops.part)
      break
    case "edit":
      viewParts = getEditViewParts(input, metadata)
      break
    case "glob":
      viewParts = getGlobViewParts(input, metadata)
      break
    case "grep":
      viewParts = getGrepViewParts(input, metadata)
      break
    case "list":
      viewParts = getListViewParts(input)
      break
    case "webfetch":
      viewParts = getWebFetchViewParts(input)
      break
    case "codesearch":
      viewParts = getCodeSearchViewParts(input, metadata)
      break
    case "websearch":
      viewParts = getWebSearchViewParts(input, metadata)
      break
    case "skill":
      viewParts = getSkillViewParts(input)
      break
    case "plan_enter":
      viewParts = getPlanEnterViewParts()
      break
    case "plan_exit":
      viewParts = getPlanExitViewParts()
      break
    default:
      // Fall through to GenericToolView for unknown tools (needs hooks)
      return <GenericToolView toolprops={toolprops} status={status} />
  }

  return (
    <DenseToolMessage
      status={status}
      toolName={toolprops.tool}
      viewParts={viewParts}
      part={toolprops.part}
      strikethrough={strikethrough}
    />
  )
}
