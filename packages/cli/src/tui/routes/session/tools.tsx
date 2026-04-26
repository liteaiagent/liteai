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
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { Spinner } from "../../ui/spinner"
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
  const [expanded, setExpanded] = useState(false)
  const lines = useMemo(() => output.split("\n"), [output])
  const max = 3
  const overflow = lines.length > max
  const limited = useMemo(() => {
    if (expanded || !overflow) return output
    return [...lines.slice(0, max), "…"].join("\n")
  }, [expanded, overflow, output, lines])

  if (props.output && ctx.showGenericToolOutput) {
    return (
      <BlockTool
        title={`# ${props.tool} ${formatInput(props.input as Record<string, unknown>)}`}
        part={props.part}
        onClick={overflow ? () => setExpanded((prev) => !prev) : undefined}
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
    <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
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
}) {
  const { theme } = useTheme()
  const ctx = useSessionContext()
  const sync = useSync()
  const [hover, _setHover] = useState(false)

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
  const denied =
    error?.includes("rejected permission") || error?.includes("specified a rule") || error?.includes("user dismissed")

  return (
    <Box paddingLeft={3} flexDirection="column">
      <Box gap={1}>
        {props.spinner ? (
          <Box flexDirection="row" gap={1}>
            <Spinner />
            <Text color={fg as Color}>{props.children}</Text>
          </Box>
        ) : (
          <Text color={fg as Color}>
            {props.complete ? <Text color={(props.iconColor || fg) as Color}>{props.icon}</Text> : `~ ${props.pending}`}{" "}
            {props.children}
          </Text>
        )}
      </Box>
      {error && !denied && <Text color={theme.error as Color}>{error}</Text>}
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
}) {
  const { theme } = useTheme()
  const [_hover, _setHover] = useState(false)
  const error = props.part?.state.status === "error" ? props.part.state.error : undefined

  return (
    <ThemedBox borderStyle="single" paddingLeft={2} marginTop={1} flexDirection="column" gap={1}>
      {props.spinner ? (
        <Box flexDirection="row" gap={1}>
          <Spinner />
          <Text color={theme.textMuted as Color}>{props.title.replace(/^# /, "")}</Text>
        </Box>
      ) : (
        <Text color={theme.textMuted as Color}>{props.title}</Text>
      )}
      {props.children}
      {error && <Text color={theme.error as Color}>{error}</Text>}
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

export function RunCommand(props: ToolProps) {
  const { theme } = useTheme()
  const sync = useSync()
  const input = typed<RunCommandInput>(props.input as Record<string, unknown>)
  const metadata = typed<RunCommandMetadata>(props.metadata as Record<string, unknown>)
  const running = props.part.state.status === "running"
  const output = useMemo(() => stripAnsi(metadata.output?.trim() ?? ""), [metadata])
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
    return (
      <BlockTool
        title={title}
        part={props.part}
        spinner={running}
        onClick={overflow ? () => setExpanded((prev) => !prev) : undefined}
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
    <InlineTool icon="$" pending="Writing command..." complete={input.command} part={props.part}>
      {input.command}
    </InlineTool>
  )
}

export function Write(props: ToolProps) {
  const { theme } = useTheme()
  const input = typed<WriteInput>(props.input as Record<string, unknown>)
  const metadata = typed<WriteMetadata>(props.metadata as Record<string, unknown>)
  const code = input.content ?? ""

  if (metadata.diagnostics !== undefined) {
    return (
      <BlockTool title={`# Wrote ${normalizePath(input.filePath)}`} part={props.part}>
        <Box flexDirection="column">
          <Text color={theme.text as Color}>{code}</Text>
        </Box>
        <Diagnostics diagnostics={metadata.diagnostics} filePath={input.filePath ?? ""} />
      </BlockTool>
    )
  }

  return (
    <InlineTool icon="←" pending="Preparing write..." complete={input.filePath} part={props.part}>
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
      <InlineTool icon="→" pending="Reading file..." complete={input.filePath} spinner={running} part={props.part}>
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
  const input = typed<EditInput>(props.input as Record<string, unknown>)
  const metadata = typed<EditMetadata>(props.metadata as Record<string, unknown>)

  if (metadata.diff !== undefined) {
    return (
      <BlockTool title={`← Edit ${normalizePath(input.filePath)}`} part={props.part}>
        <Box paddingLeft={1}>
          <StructuredDiff key={props.part.id} modifiedContent={metadata.diff} />
        </Box>
        <Diagnostics diagnostics={metadata.diagnostics} filePath={input.filePath ?? ""} />
      </BlockTool>
    )
  }

  return (
    <InlineTool icon="←" pending="Preparing edit..." complete={input.filePath} part={props.part}>
      Edit {normalizePath(input.filePath)} {formatInput({ replaceAll: input.replaceAll } as Record<string, unknown>)}
    </InlineTool>
  )
}

export function Glob(props: ToolProps) {
  const input = typed<GlobInput>(props.input as Record<string, unknown>)
  const metadata = typed<GlobMetadata>(props.metadata as Record<string, unknown>)
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={input.pattern} part={props.part}>
      Glob "{input.pattern}" {input.path ? `in ${normalizePath(input.path)}` : ""}
      {metadata.count !== undefined && ` (${metadata.count} ${metadata.count === 1 ? "match" : "matches"})`}
    </InlineTool>
  )
}

export function Grep(props: ToolProps) {
  const input = typed<GrepInput>(props.input as Record<string, unknown>)
  const metadata = typed<GrepMetadata>(props.metadata as Record<string, unknown>)
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={input.pattern} part={props.part}>
      Grep "{input.pattern}" {input.path ? `in ${normalizePath(input.path)}` : ""}
      {metadata.matches !== undefined && ` (${metadata.matches} ${metadata.matches === 1 ? "match" : "matches"})`}
    </InlineTool>
  )
}

export function List(props: ToolProps) {
  const input = typed<ListInput>(props.input as Record<string, unknown>)
  const dir = input.path ? normalizePath(input.path) : ""
  return (
    <InlineTool icon="→" pending="Listing directory..." complete={input.path !== undefined} part={props.part}>
      List {dir}
    </InlineTool>
  )
}

export function WebFetch(props: ToolProps) {
  const input = typed<WebFetchInput>(props.input as Record<string, unknown>)
  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={input.url} part={props.part}>
      WebFetch {input.url}
    </InlineTool>
  )
}

export function CodeSearch(props: ToolProps) {
  const input = typed<CodeSearchInput>(props.input as Record<string, unknown>)
  const metadata = typed<CodeSearchMetadata>(props.metadata as Record<string, unknown>)
  return (
    <InlineTool icon="◇" pending="Searching code..." complete={input.query} part={props.part}>
      Code Search "{input.query}" {metadata.results !== undefined && `(${metadata.results} results)`}
    </InlineTool>
  )
}

export function WebSearch(props: ToolProps) {
  const input = typed<WebSearchInput>(props.input as Record<string, unknown>)
  const metadata = typed<WebSearchMetadata>(props.metadata as Record<string, unknown>)
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={input.query} part={props.part}>
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
    <InlineTool icon="│" spinner={running} complete={input.description} pending="Delegating..." part={props.part}>
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
      <BlockTool title="# Questions" part={props.part}>
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
    <InlineTool icon="→" pending="Asking questions..." complete={questions.length > 0} part={props.part}>
      Asked {questions.length} question{questions.length !== 1 ? "s" : ""}
    </InlineTool>
  )
}

export function Skill(props: ToolProps) {
  const input = typed<SkillInput>(props.input as Record<string, unknown>)
  return (
    <InlineTool icon="→" pending="Loading skill..." complete={input.name} part={props.part}>
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
  const [expanded, setExpanded] = useState(false)
  const lines = output.split("\n")
  const overflow = lines.length > 10
  const limited = expanded || !overflow ? output : [...lines.slice(0, 10), "…"].join("\n")

  if (metadata.output !== undefined || props.output) {
    return (
      <BlockTool
        title={`# Status: ${metadata.commandId || input.CommandId || "unknown"}`}
        part={props.part}
        spinner={running}
        onClick={overflow ? () => setExpanded((prev) => !prev) : undefined}
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
    <InlineTool icon="⚙" pending="Checking status..." complete={input.CommandId} part={props.part}>
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

  if (metadata.output !== undefined || props.output) {
    return (
      <BlockTool title={`# ${text}`} part={props.part} spinner={running}>
        <Box flexDirection="column" gap={1}>
          {output && <Text color={theme.text as Color}>{output}</Text>}
        </Box>
      </BlockTool>
    )
  }

  return (
    <InlineTool icon="⚙" pending="Sending input..." complete={input.CommandId} part={props.part}>
      {text}: {metadata.commandId || input.CommandId || "unknown"}
    </InlineTool>
  )
}

export function ApplyPatch(props: ToolProps) {
  const { theme } = useTheme()
  const metadata = typed<ApplyPatchMetadata>(props.metadata as Record<string, unknown>)
  const files = metadata.files ?? []

  if (files.length > 0) {
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
    <InlineTool icon="%" pending="Preparing patch..." complete={false} part={props.part}>
      Patch
    </InlineTool>
  )
}

export function TodoWrite(props: ToolProps) {
  const metadata = typed<TodoWriteMetadata>(props.metadata as Record<string, unknown>)
  const todos = metadata.todos ?? []
  if (todos.length > 0) {
    return (
      <BlockTool title="# Todos" part={props.part}>
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
    <InlineTool icon="⚙" pending="Updating todos..." complete={false} part={props.part}>
      Updating todos...
    </InlineTool>
  )
}
