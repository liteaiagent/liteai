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
import ThemedBox from "../../components/design-system/ThemedBox"
import { StructuredDiff } from "../../components/structured-diff"
import { COMPACT_DIFF_MAX_LINES } from "../../constants/compact-diff"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { useElapsedTime } from "../../hooks/use-elapsed-time"
import { useOutputFile } from "../../hooks/use-output-file"
import { Spinner } from "../../ui/spinner"
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

export function GenericTool(props: ToolProps) {
  const { theme } = useTheme()
  const ctx = useSessionContext()
  const output = useMemo(() => props.output?.trim() ?? "", [props.output])
  const { savedPath } = useOutputFile({
    output,
    sessionID: ctx.sessionID,
    callID: props.part.callID,
  })
  const [expanded, setExpanded] = useState(false)
  const lines = useMemo(() => output.split("\n"), [output])
  const max = 3
  const overflow = lines.length > max
  const limited = useMemo(() => {
    if (expanded || !overflow) return output
    return [...lines.slice(0, max), "…"].join("\n")
  }, [expanded, overflow, output, lines])

  if (props.output && ctx.showGenericToolOutput) {
    if (savedPath) {
      const preview = lines.slice(0, 50).join("\n")
      return (
        <BlockTool
          title={`# ${props.tool} ${formatInput(props.input as Record<string, unknown>)}`}
          part={props.part}
          {...extractToolTiming(props.part)}
        >
          <Box gap={1} flexDirection="column">
            {preview && <Text color={theme.text as Color}>{preview}</Text>}
            <Text color={theme.textMuted as Color}>
              ── Full output ({output.length.toLocaleString()} chars): {shortenPath(savedPath)}
            </Text>
          </Box>
        </BlockTool>
      )
    }

    return (
      <BlockTool
        title={`# ${props.tool} ${formatInput(props.input as Record<string, unknown>)}`}
        part={props.part}
        onClick={overflow ? () => setExpanded((prev) => !prev) : undefined}
        {...extractToolTiming(props.part)}
      >
        <Box gap={1} flexDirection="column">
          <Text color={theme.text as Color}>{limited}</Text>
          {overflow && (
            <Text color={theme.textMuted as Color}>{expanded ? "Click to collapse" : "Click to expand"}</Text>
          )}
        </Box>
      </BlockTool>
    )
  }

  return (
    <InlineTool
      icon="⚙"
      pending="Writing command..."
      complete={true}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      {props.tool} {formatInput(props.input as Record<string, unknown>)}
    </InlineTool>
  )
}

function InlineTool(props: {
  icon: string
  iconColor?: Color
  complete: unknown
  pending: string
  spinner?: boolean
  children: React.ReactNode
  part: ToolPart
  onClick?: () => void
  startTime?: number
  endTime?: number
}) {
  const { theme } = useTheme()
  const ctx = useSessionContext()
  const sync = useSync()
  const [hover, _setHover] = useState(false)

  const timing = useElapsedTime({ startTime: props.startTime ?? null, endTime: props.endTime })
  const timingSuffix = timing.formatted ? ` (${timing.formatted})` : ""

  const permission = useMemo(() => {
    const permissions = sync.permission[ctx.sessionID] ?? []
    return permissions.some((x) => x.tool?.callID === props.part.callID)
  }, [sync.permission, ctx.sessionID, props.part.callID])

  const fg = useMemo(() => {
    if (permission) return theme.warning
    if (hover && props.onClick) return theme.text
    if (props.complete) return theme.textMuted
    return theme.text
  }, [permission, hover, props.onClick, props.complete, theme])

  const error = props.part.state.status === "error" ? props.part.state.error : undefined
  const config = useTuiConfig()
  const displayError = error && config.errorVerbosity === "low" ? error.split("\n")[0] : error
  const denied =
    error?.includes("rejected permission") || error?.includes("specified a rule") || error?.includes("user dismissed")

  return (
    <Box paddingLeft={3} flexDirection="column">
      <Box gap={1}>
        {props.spinner ? (
          <Box flexDirection="row" gap={1}>
            <Spinner />
            <Text color={fg as Color}>
              {props.children}
              {timingSuffix}
            </Text>
          </Box>
        ) : (
          <Text color={fg as Color}>
            {props.complete ? <Text color={(props.iconColor || fg) as Color}>{props.icon}</Text> : `~ ${props.pending}`}{" "}
            {props.children}
            {timingSuffix}
          </Text>
        )}
      </Box>
      {displayError && !denied && <Text color={theme.error as Color}>{displayError}</Text>}
    </Box>
  )
}

function BlockTool(props: {
  title: string
  children: React.ReactNode
  onClick?: () => void
  part?: ToolPart
  key?: React.Key
  spinner?: boolean
  startTime?: number
  endTime?: number
}) {
  const { theme } = useTheme()
  const config = useTuiConfig()
  const [_hover, _setHover] = useState(false)
  const error = props.part?.state.status === "error" ? props.part.state.error : undefined
  const displayError = error && config.errorVerbosity === "low" ? error.split("\n")[0] : error

  const timing = useElapsedTime({ startTime: props.startTime ?? null, endTime: props.endTime })
  const suffix = timing.formatted ? ` (${props.spinner ? "running… " : ""}${timing.formatted})` : ""

  return (
    <ThemedBox borderStyle="single" paddingLeft={2} marginTop={1} flexDirection="column" gap={1}>
      {props.spinner ? (
        <Box flexDirection="row" gap={1}>
          <Spinner />
          <Text color={theme.textMuted as Color}>
            {props.title.replace(/^# /, "")}
            {suffix}
          </Text>
        </Box>
      ) : (
        <Text color={theme.textMuted as Color}>
          {props.title}
          {suffix}
        </Text>
      )}
      {props.children}
      {displayError && <Text color={theme.error as Color}>{displayError}</Text>}
    </ThemedBox>
  )
}

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
  return ` +${added}/-${removed}`
}

function truncateDiff(diff: string, maxLines: number): string {
  const lines = diff.split("\n")
  if (lines.length <= maxLines) return diff
  return `${lines.slice(0, maxLines).join("\n")}\n… (${lines.length - maxLines} more lines)`
}

export function RunCommand(props: ToolProps) {
  const { theme } = useTheme()
  const sync = useSync()
  const ctx = useSessionContext()
  const input = typed<RunCommandInput>(props.input as Record<string, unknown>)
  const metadata = typed<RunCommandMetadata>(props.metadata as Record<string, unknown>)
  const running = props.part.state.status === "running"
  const output = useMemo(() => stripAnsi(metadata.output?.trim() ?? ""), [metadata])
  const { savedPath } = useOutputFile({
    output,
    sessionID: ctx.sessionID,
    callID: props.part.callID,
  })
  const [expanded, setExpanded] = useState(false)
  const lines = useMemo(() => output.split("\n"), [output])
  const overflow = lines.length > 10
  const limited = useMemo(() => {
    if (expanded || !overflow) return output
    return [...lines.slice(0, 10), "…"].join("\n")
  }, [expanded, overflow, output, lines])

  const dir = useMemo(() => {
    const workdir = input.cwd
    if (!workdir || workdir === ".") return undefined
    const base = sync.path.directory
    if (!base) return undefined
    const absolute = path.resolve(base, workdir)
    if (absolute === base) return undefined
    const home = Global.Path.home
    if (!home) return absolute
    const match = absolute === home || absolute.startsWith(home + path.sep)
    return match ? absolute.replace(home, "~") : absolute
  }, [input.cwd, sync.path.directory])

  const title = useMemo(() => {
    const desc = input.description ?? "Shell"
    const wd = dir
    if (!wd) return `# ${desc}`
    return `# ${desc} in ${wd}`
  }, [input, dir])

  if (metadata.output !== undefined) {
    if (ctx?.isToolCompact(props.tool)) {
      if (savedPath) {
        return (
          <InlineTool icon="$" pending="" complete={input.command} part={props.part} {...extractToolTiming(props.part)}>
            Ran {input.command} (output: {shortenPath(savedPath)})
          </InlineTool>
        )
      }
      return (
        <InlineTool icon="$" pending="" complete={input.command} part={props.part} {...extractToolTiming(props.part)}>
          Ran {input.command}
        </InlineTool>
      )
    }

    if (savedPath) {
      const preview = lines.slice(0, 50).join("\n")
      return (
        <BlockTool title={title} part={props.part} spinner={running} {...extractToolTiming(props.part)}>
          <Box flexDirection="column" gap={1}>
            <Text color={theme.text as Color}>$ {input.command}</Text>
            {preview && <Text color={theme.text as Color}>{preview}</Text>}
            <Text color={theme.textMuted as Color}>
              ── Full output ({output.length.toLocaleString()} chars): {shortenPath(savedPath)}
            </Text>
          </Box>
        </BlockTool>
      )
    }

    return (
      <BlockTool
        title={title}
        part={props.part}
        spinner={running}
        onClick={overflow ? () => setExpanded((prev) => !prev) : undefined}
        {...extractToolTiming(props.part)}
      >
        <Box flexDirection="column" gap={1}>
          <Text color={theme.text as Color}>$ {input.command}</Text>
          {output && <Text color={theme.text as Color}>{limited}</Text>}
          {overflow && (
            <Text color={theme.textMuted as Color}>{expanded ? "Click to collapse" : "Click to expand"}</Text>
          )}
        </Box>
      </BlockTool>
    )
  }

  return (
    <InlineTool
      icon="$"
      pending="Writing command..."
      complete={input.command}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      {input.command}
    </InlineTool>
  )
}

export function Write(props: ToolProps) {
  const { theme } = useTheme()
  const ctx = useSessionContext()
  const input = typed<WriteInput>(props.input as Record<string, unknown>)
  const metadata = typed<WriteMetadata>(props.metadata as Record<string, unknown>)
  const code = input.content ?? ""

  if (metadata.diagnostics !== undefined) {
    if (ctx?.isToolCompact(props.tool)) {
      return (
        <Box flexDirection="column">
          <InlineTool
            icon="←"
            pending=""
            complete={input.filePath}
            part={props.part}
            {...extractToolTiming(props.part)}
          >
            Wrote {normalizePath(input.filePath)}
          </InlineTool>
          {code && code.split("\n").length <= COMPACT_DIFF_MAX_LINES && (
            <Box paddingLeft={6} marginTop={0}>
              <StructuredDiff modifiedContent={truncateDiff(code, COMPACT_DIFF_MAX_LINES)} />
            </Box>
          )}
        </Box>
      )
    }

    return (
      <BlockTool
        title={`# Wrote ${normalizePath(input.filePath)}`}
        part={props.part}
        {...extractToolTiming(props.part)}
      >
        <Box flexDirection="column">
          <Text color={theme.text as Color}>{code}</Text>
        </Box>
        <Diagnostics diagnostics={metadata.diagnostics} filePath={input.filePath ?? ""} />
      </BlockTool>
    )
  }

  return (
    <InlineTool
      icon="←"
      pending="Preparing write..."
      complete={input.filePath}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      Write {normalizePath(input.filePath)}
    </InlineTool>
  )
}

export function Read(props: ToolProps) {
  const { theme } = useTheme()
  const input = typed<ReadInput>(props.input as Record<string, unknown>)
  const metadata = typed<ReadMetadata>(props.metadata as Record<string, unknown>)
  const running = props.part.state.status === "running"
  const loaded = useMemo(() => {
    if (props.part.state.status !== "completed") return []
    const value = metadata.loaded
    if (!value || !Array.isArray(value)) return []
    return value.filter((p): p is string => typeof p === "string")
  }, [props.part.state.status, metadata])

  return (
    <Box flexDirection="column">
      <InlineTool
        icon="→"
        pending="Reading file..."
        complete={input.filePath}
        spinner={running}
        part={props.part}
        {...extractToolTiming(props.part)}
      >
        Read {normalizePath(input.filePath)} {formatInput({ ...props.input } as Record<string, unknown>, ["filePath"])}
      </InlineTool>
      {loaded.map((filepath, i) => (
        <Box key={i} paddingLeft={6}>
          <Text color={theme.textMuted as Color}>↳ Loaded {normalizePath(filepath)}</Text>
        </Box>
      ))}
    </Box>
  )
}

export function Edit(props: ToolProps) {
  const ctx = useSessionContext()
  const input = typed<EditInput>(props.input as Record<string, unknown>)
  const metadata = typed<EditMetadata>(props.metadata as Record<string, unknown>)

  if (metadata.diff !== undefined) {
    if (ctx?.isToolCompact(props.tool)) {
      const stats = computeDiffStats(metadata.diff)
      return (
        <Box flexDirection="column">
          <InlineTool
            icon="←"
            pending=""
            complete={input.filePath}
            part={props.part}
            {...extractToolTiming(props.part)}
          >
            Edit {normalizePath(input.filePath)}
            {stats}
          </InlineTool>
          {metadata.diff && (
            <Box paddingLeft={6} marginTop={0}>
              <StructuredDiff modifiedContent={truncateDiff(metadata.diff, COMPACT_DIFF_MAX_LINES)} />
            </Box>
          )}
        </Box>
      )
    }

    return (
      <BlockTool title={`← Edit ${normalizePath(input.filePath)}`} part={props.part} {...extractToolTiming(props.part)}>
        <Box paddingLeft={1}>
          <StructuredDiff key={props.part.id} modifiedContent={metadata.diff} />
        </Box>
        <Diagnostics diagnostics={metadata.diagnostics} filePath={input.filePath ?? ""} />
      </BlockTool>
    )
  }

  return (
    <InlineTool
      icon="←"
      pending="Preparing edit..."
      complete={input.filePath}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      Edit {normalizePath(input.filePath)} {formatInput({ replaceAll: input.replaceAll } as Record<string, unknown>)}
    </InlineTool>
  )
}

export function Glob(props: ToolProps) {
  const input = typed<GlobInput>(props.input as Record<string, unknown>)
  const metadata = typed<GlobMetadata>(props.metadata as Record<string, unknown>)
  return (
    <InlineTool
      icon="✱"
      pending="Finding files..."
      complete={input.pattern}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      Glob "{input.pattern}" {input.path ? `in ${normalizePath(input.path)}` : ""}
      {metadata.count !== undefined && ` (${metadata.count} ${metadata.count === 1 ? "match" : "matches"})`}
    </InlineTool>
  )
}

export function Grep(props: ToolProps) {
  const input = typed<GrepInput>(props.input as Record<string, unknown>)
  const metadata = typed<GrepMetadata>(props.metadata as Record<string, unknown>)
  return (
    <InlineTool
      icon="✱"
      pending="Searching content..."
      complete={input.pattern}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      Grep "{input.pattern}" {input.path ? `in ${normalizePath(input.path)}` : ""}
      {metadata.matches !== undefined && ` (${metadata.matches} ${metadata.matches === 1 ? "match" : "matches"})`}
    </InlineTool>
  )
}

export function List(props: ToolProps) {
  const input = typed<ListInput>(props.input as Record<string, unknown>)
  const dir = input.path ? normalizePath(input.path) : ""
  return (
    <InlineTool
      icon="→"
      pending="Listing directory..."
      complete={input.path !== undefined}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      List {dir}
    </InlineTool>
  )
}

export function WebFetch(props: ToolProps) {
  const input = typed<WebFetchInput>(props.input as Record<string, unknown>)
  return (
    <InlineTool
      icon="%"
      pending="Fetching from the web..."
      complete={input.url}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      WebFetch {input.url}
    </InlineTool>
  )
}

export function CodeSearch(props: ToolProps) {
  const input = typed<CodeSearchInput>(props.input as Record<string, unknown>)
  const metadata = typed<CodeSearchMetadata>(props.metadata as Record<string, unknown>)
  return (
    <InlineTool
      icon="◇"
      pending="Searching code..."
      complete={input.query}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      Code Search "{input.query}" {metadata.results !== undefined && `(${metadata.results} results)`}
    </InlineTool>
  )
}

export function WebSearch(props: ToolProps) {
  const input = typed<WebSearchInput>(props.input as Record<string, unknown>)
  const metadata = typed<WebSearchMetadata>(props.metadata as Record<string, unknown>)
  return (
    <InlineTool
      icon="◈"
      pending="Searching web..."
      complete={input.query}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      Web Search "{input.query}" {metadata.numResults !== undefined && `(${metadata.numResults} results)`}
    </InlineTool>
  )
}

export function Task(props: ToolProps) {
  const sync = useSync()
  const input = typed<TaskInput>(props.input as Record<string, unknown>)
  const metadata = typed<TaskMetadata>(props.metadata as Record<string, unknown>)
  const running = props.part.state.status === "running"
  const sessionID = metadata.sessionId

  useEffect(() => {
    if (sessionID && !sync.message[sessionID]?.length) {
      sync.session.sync(sessionID)
    }
  }, [sessionID, sync])

  const messages = useMemo(() => sync.message[sessionID ?? ""] ?? [], [sync.message, sessionID])
  const toolCount = useMemo(() => {
    return messages.flatMap((msg) => (sync.part[msg.id] ?? []).filter((p) => p.type === "tool")).length
  }, [messages, sync.part])

  return (
    <InlineTool
      icon="│"
      spinner={running}
      complete={input.description}
      pending="Delegating..."
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      Task {input.description} {toolCount > 0 && `(${toolCount} toolcalls)`}
    </InlineTool>
  )
}

export function Question(props: ToolProps) {
  const { theme } = useTheme()
  const input = typed<QuestionInput>(props.input as Record<string, unknown>)
  const metadata = typed<QuestionMetadata>(props.metadata as Record<string, unknown>)
  const questions = input.questions ?? []
  const answers = metadata.answers

  if (answers) {
    return (
      <BlockTool title="# Questions" part={props.part} {...extractToolTiming(props.part)}>
        <Box flexDirection="column" gap={1}>
          {questions.map((q, i) => (
            <Box key={i} flexDirection="column">
              <Text color={theme.textMuted as Color}>{q.question}</Text>
              <Text color={theme.text as Color}>{answers[i]?.join(", ") || "(no answer)"}</Text>
            </Box>
          ))}
        </Box>
      </BlockTool>
    )
  }

  return (
    <InlineTool
      icon="→"
      pending="Asking questions..."
      complete={questions.length > 0}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      Asked {questions.length} question{questions.length !== 1 ? "s" : ""}
    </InlineTool>
  )
}

export function Skill(props: ToolProps) {
  const input = typed<SkillInput>(props.input as Record<string, unknown>)
  return (
    <InlineTool
      icon="→"
      pending="Loading skill..."
      complete={input.name}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      Skill "{input.name}"
    </InlineTool>
  )
}

export function CommandStatus(props: ToolProps) {
  const { theme } = useTheme()
  const input = typed<CommandStatusInput>(props.input as Record<string, unknown>)
  const metadata = typed<CommandStatusMetadata>(props.metadata as Record<string, unknown>)
  const running = props.part.state.status === "running"
  const output = stripAnsi((props.output || metadata.output || "") as string)
  const ctx = useSessionContext()
  const { savedPath } = useOutputFile({
    output,
    sessionID: ctx.sessionID,
    callID: props.part.callID,
  })
  const [expanded, setExpanded] = useState(false)
  const lines = output.split("\n")
  const overflow = lines.length > 10
  const limited = expanded || !overflow ? output : [...lines.slice(0, 10), "…"].join("\n")

  if (metadata.output !== undefined || props.output) {
    if (ctx?.isToolCompact(props.tool)) {
      return (
        <InlineTool icon="⚙" pending="" complete={true} part={props.part} {...extractToolTiming(props.part)}>
          Status: {metadata.commandId || input.CommandId || "unknown"}
        </InlineTool>
      )
    }

    if (savedPath) {
      const preview = lines.slice(0, 50).join("\n")
      return (
        <BlockTool
          title={`# Status: ${metadata.commandId || input.CommandId || "unknown"}`}
          part={props.part}
          spinner={running}
          {...extractToolTiming(props.part)}
        >
          <Box flexDirection="column" gap={1}>
            <Text color={theme.text as Color}>{metadata.status === "running" ? "Running" : "Completed"}</Text>
            {preview && <Text color={theme.text as Color}>{preview}</Text>}
            <Text color={theme.textMuted as Color}>
              ── Full output ({output.length.toLocaleString()} chars): {shortenPath(savedPath)}
            </Text>
          </Box>
        </BlockTool>
      )
    }

    return (
      <BlockTool
        title={`# Status: ${metadata.commandId || input.CommandId || "unknown"}`}
        part={props.part}
        spinner={running}
        onClick={overflow ? () => setExpanded((prev) => !prev) : undefined}
        {...extractToolTiming(props.part)}
      >
        <Box flexDirection="column" gap={1}>
          <Text color={theme.text as Color}>{metadata.status === "running" ? "Running" : "Completed"}</Text>
          {output && <Text color={theme.text as Color}>{limited}</Text>}
          {overflow && (
            <Text color={theme.textMuted as Color}>{expanded ? "Click to collapse" : "Click to expand"}</Text>
          )}
        </Box>
      </BlockTool>
    )
  }

  return (
    <InlineTool
      icon="⚙"
      pending="Checking status..."
      complete={input.CommandId}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      Status: {metadata.commandId || input.CommandId || "unknown"}
    </InlineTool>
  )
}

export function SendCommandInput(props: ToolProps) {
  const { theme } = useTheme()
  const input = typed<SendCommandInputInput>(props.input as Record<string, unknown>)
  const metadata = typed<SendCommandInputMetadata>(props.metadata as Record<string, unknown>)
  const running = props.part.state.status === "running"
  const output = stripAnsi((props.output || metadata.output || "") as string)

  const text = input.Terminate ? "Sending terminate signal" : "Sending input"
  const ctx = useSessionContext()

  if (metadata.output !== undefined || props.output) {
    if (ctx?.isToolCompact(props.tool)) {
      return (
        <InlineTool icon="⚙" pending="" complete={true} part={props.part} {...extractToolTiming(props.part)}>
          {text}: {metadata.commandId || input.CommandId || "unknown"}
        </InlineTool>
      )
    }

    return (
      <BlockTool title={`# ${text}`} part={props.part} spinner={running} {...extractToolTiming(props.part)}>
        <Box flexDirection="column" gap={1}>
          {output && <Text color={theme.text as Color}>{output}</Text>}
        </Box>
      </BlockTool>
    )
  }

  return (
    <InlineTool
      icon="⚙"
      pending="Sending input..."
      complete={input.CommandId}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      {text}: {metadata.commandId || input.CommandId || "unknown"}
    </InlineTool>
  )
}

export function ApplyPatch(props: ToolProps) {
  const { theme } = useTheme()
  const ctx = useSessionContext()
  const metadata = typed<ApplyPatchMetadata>(props.metadata as Record<string, unknown>)
  const files = metadata.files ?? []

  if (files.length > 0) {
    if (ctx?.isToolCompact(props.tool)) {
      const fileNames = files.map((f) => path.basename(f.relativePath)).join(", ")
      return (
        <Box flexDirection="column">
          <InlineTool icon="←" pending="" complete={true} part={props.part} {...extractToolTiming(props.part)}>
            Patch {files.length} file{files.length === 1 ? "" : "s"}: {fileNames}
          </InlineTool>
          <Box paddingLeft={6} marginTop={0} flexDirection="column">
            {files.map((f, i) => {
              if (!f.diff) return null
              // Naive budget per file: 15 lines total, divided among files with diffs
              const budget = Math.max(3, Math.floor(COMPACT_DIFF_MAX_LINES / files.length))
              return (
                <Box key={i} flexDirection="column">
                  <StructuredDiff modifiedContent={truncateDiff(f.diff, budget)} />
                </Box>
              )
            })}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {files.map((file, i) => (
          <BlockTool
            key={i}
            title={
              file.type === "delete"
                ? `# Deleted ${file.relativePath}`
                : file.type === "add"
                  ? `# Created ${file.relativePath}`
                  : `← Patched ${file.relativePath}`
            }
            part={props.part}
            {...extractToolTiming(props.part)}
          >
            {file.type !== "delete" ? (
              <StructuredDiff modifiedContent={file.diff ?? ""} />
            ) : (
              <Text color={theme.error as Color}>-{file.deletions} lines</Text>
            )}
          </BlockTool>
        ))}
      </Box>
    )
  }

  return (
    <InlineTool
      icon="%"
      pending="Preparing patch..."
      complete={false}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      Patch
    </InlineTool>
  )
}

export function TodoWrite(props: ToolProps) {
  const metadata = typed<TodoWriteMetadata>(props.metadata as Record<string, unknown>)
  const todos = metadata.todos ?? []
  if (todos.length > 0) {
    return (
      <BlockTool title="# Todos" part={props.part} {...extractToolTiming(props.part)}>
        <Box flexDirection="column">
          {todos.map((todo, i) => (
            <Box key={i} gap={1}>
              <Text>[{todo.status === "done" ? "x" : " "}]</Text>
              <Text>{todo.content}</Text>
            </Box>
          ))}
        </Box>
      </BlockTool>
    )
  }
  return (
    <InlineTool
      icon="⚙"
      pending="Updating todos..."
      complete={false}
      part={props.part}
      {...extractToolTiming(props.part)}
    >
      Updating todos...
    </InlineTool>
  )
}
