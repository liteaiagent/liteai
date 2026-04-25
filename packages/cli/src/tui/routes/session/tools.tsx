import path from "node:path"
import { Global } from "@liteai/core/global/index"
import type { Tool } from "@liteai/core/tool/tool"
import { Filesystem } from "@liteai/core/util/filesystem"
import { Locale } from "@liteai/core/util/locale"
import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type { ToolPart } from "@liteai/sdk"
import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import stripAnsi from "strip-ansi"
import ThemedBox from "../../components/design-system/ThemedBox"
import ThemedText from "../../components/design-system/ThemedText"
import { Markdown } from "../../components/markdown"
import { StructuredDiff } from "../../components/structured-diff"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { Spinner } from "../../ui/spinner"
import { useSessionContext } from "./ctx"
import { filetype, formatInput, normalizePath } from "./utils"

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

  if (props.output && ctx.showGenericToolOutput()) {
    return (
      <BlockTool
        title={`# ${props.tool} ${formatInput(props.input as any)}`}
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
      {props.tool} {formatInput(props.input as any)}
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
  const [hover, setHover] = useState(false)

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
  const [hover, setHover] = useState(false)
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

function Diagnostics({ diagnostics, filePath }: { diagnostics?: Record<string, any[]>; filePath: string }) {
  const { theme } = useTheme()
  const errors = useMemo(() => {
    const normalized = Filesystem.normalizePath(filePath)
    const arr = diagnostics?.[normalized] ?? []
    return arr.filter((x) => x.severity === 1).slice(0, 3)
  }, [diagnostics, filePath])

  if (!errors.length) return null

  return (
    <Box flexDirection="column">
      {errors.map((diagnostic, i) => (
        // @ts-expect-error: key prop
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
  const running = props.part.state.status === "running"
  const output = useMemo(() => stripAnsi((props.metadata as any).output?.trim() ?? ""), [props.metadata])
  const [expanded, setExpanded] = useState(false)
  const lines = useMemo(() => output.split("\n"), [output])
  const overflow = lines.length > 10
  const limited = useMemo(() => {
    if (expanded || !overflow) return output
    return [...lines.slice(0, 10), "…"].join("\n")
  }, [expanded, overflow, output, lines])

  const dir = useMemo(() => {
    const workdir = (props.input as any).cwd
    if (!workdir || workdir === ".") return undefined
    const base = sync.path.directory
    if (!base) return undefined
    const absolute = path.resolve(base, workdir as string)
    if (absolute === base) return undefined
    const home = Global.Path.home
    if (!home) return absolute
    const match = absolute === home || absolute.startsWith(home + path.sep)
    return match ? absolute.replace(home, "~") : absolute
  }, [(props.input as any).cwd, sync.path.directory])

  const title = useMemo(() => {
    const desc = (props.input as any).description ?? "Shell"
    const wd = dir
    if (!wd) return `# ${desc}`
    return `# ${desc} in ${wd}`
  }, [props.input, dir])

  if ((props.metadata as any).output !== undefined) {
    return (
      <BlockTool
        title={title}
        part={props.part}
        spinner={running}
        onClick={overflow ? () => setExpanded((prev) => !prev) : undefined}
      >
        <Box flexDirection="column" gap={1}>
          <Text color={theme.text as Color}>$ {(props.input as any).command}</Text>
          {output && <Text color={theme.text as Color}>{limited}</Text>}
          {overflow && (
            <Text color={theme.textMuted as Color}>{expanded ? "Click to collapse" : "Click to expand"}</Text>
          )}
        </Box>
      </BlockTool>
    )
  }

  return (
    <InlineTool icon="$" pending="Writing command..." complete={(props.input as any).command} part={props.part}>
      {(props.input as any).command}
    </InlineTool>
  )
}

export function Write(props: ToolProps) {
  const { theme } = useTheme()
  const code = (props.input as any).content ?? ""

  if ((props.metadata as any).diagnostics !== undefined) {
    return (
      <BlockTool title={`# Wrote ${normalizePath((props.input as any).filePath)}`} part={props.part}>
        <Box flexDirection="column">
          <Text color={theme.text as Color}>{code}</Text>
        </Box>
        <Diagnostics diagnostics={(props.metadata as any).diagnostics} filePath={(props.input as any).filePath ?? ""} />
      </BlockTool>
    )
  }

  return (
    <InlineTool icon="←" pending="Preparing write..." complete={(props.input as any).filePath} part={props.part}>
      Write {normalizePath((props.input as any).filePath)}
    </InlineTool>
  )
}

export function Read(props: ToolProps) {
  const { theme } = useTheme()
  const running = props.part.state.status === "running"
  const loaded = useMemo(() => {
    if (props.part.state.status !== "completed") return []
    const value = (props.metadata as any).loaded
    if (!value || !Array.isArray(value)) return []
    return value.filter((p): p is string => typeof p === "string")
  }, [props.part.state.status, props.metadata])

  return (
    <Box flexDirection="column">
      <InlineTool
        icon="→"
        pending="Reading file..."
        complete={(props.input as any).filePath}
        spinner={running}
        part={props.part}
      >
        Read {normalizePath((props.input as any).filePath)} {formatInput(props.input as any, ["filePath"])}
      </InlineTool>
      {loaded.map((filepath, i) => (
        // @ts-expect-error: key prop
        <Box key={i} paddingLeft={6}>
          <Text color={theme.textMuted as Color}>↳ Loaded {normalizePath(filepath)}</Text>
        </Box>
      ))}
    </Box>
  )
}

export function Edit(props: ToolProps) {
  const { theme } = useTheme()

  if ((props.metadata as any).diff !== undefined) {
    return (
      <BlockTool title={`← Edit ${normalizePath((props.input as any).filePath)}`} part={props.part}>
        <Box paddingLeft={1}>
          {/* @ts-expect-error: key prop handled by React */}
          <StructuredDiff key={props.part.id} modifiedContent={(props.metadata as any).diff} />
        </Box>
        <Diagnostics diagnostics={(props.metadata as any).diagnostics} filePath={(props.input as any).filePath ?? ""} />
      </BlockTool>
    )
  }

  return (
    <InlineTool icon="←" pending="Preparing edit..." complete={(props.input as any).filePath} part={props.part}>
      Edit {normalizePath((props.input as any).filePath)}{" "}
      {formatInput({ replaceAll: (props.input as any).replaceAll } as any)}
    </InlineTool>
  )
}

export function Glob(props: ToolProps) {
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={(props.input as any).pattern} part={props.part}>
      Glob "{(props.input as any).pattern}"{" "}
      {(props.input as any).path ? `in ${normalizePath((props.input as any).path)}` : ""}
      {(props.metadata as any).count !== undefined &&
        ` (${(props.metadata as any).count} ${(props.metadata as any).count === 1 ? "match" : "matches"})`}
    </InlineTool>
  )
}

export function Grep(props: ToolProps) {
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={(props.input as any).pattern} part={props.part}>
      Grep "{(props.input as any).pattern}"{" "}
      {(props.input as any).path ? `in ${normalizePath((props.input as any).path)}` : ""}
      {(props.metadata as any).matches !== undefined &&
        ` (${(props.metadata as any).matches} ${(props.metadata as any).matches === 1 ? "match" : "matches"})`}
    </InlineTool>
  )
}

export function List(props: ToolProps) {
  const dir = (props.input as any).path ? normalizePath((props.input as any).path) : ""
  return (
    <InlineTool
      icon="→"
      pending="Listing directory..."
      complete={(props.input as any).path !== undefined}
      part={props.part}
    >
      List {dir}
    </InlineTool>
  )
}

export function WebFetch(props: ToolProps) {
  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={(props.input as any).url} part={props.part}>
      WebFetch {(props.input as any).url}
    </InlineTool>
  )
}

export function CodeSearch(props: ToolProps) {
  const inp = props.input as any
  const meta = props.metadata as any
  return (
    <InlineTool icon="◇" pending="Searching code..." complete={inp.query} part={props.part}>
      Code Search "{inp.query}" {meta.results !== undefined && `(${meta.results} results)`}
    </InlineTool>
  )
}

export function WebSearch(props: ToolProps) {
  const inp = props.input as any
  const meta = props.metadata as any
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={inp.query} part={props.part}>
      Web Search "{inp.query}" {meta.numResults !== undefined && `(${meta.numResults} results)`}
    </InlineTool>
  )
}

export function Task(props: ToolProps) {
  const sync = useSync()
  const running = props.part.state.status === "running"
  const sessionID = (props.metadata as any).sessionId

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
      complete={(props.input as any).description}
      pending="Delegating..."
      part={props.part}
    >
      Task {(props.input as any).description} {toolCount > 0 && `(${toolCount} toolcalls)`}
    </InlineTool>
  )
}

export function Question(props: ToolProps) {
  const { theme } = useTheme()
  const questions = (props.input as any).questions ?? []
  const answers = (props.metadata as any).answers

  if (answers) {
    return (
      <BlockTool title="# Questions" part={props.part}>
        <Box flexDirection="column" gap={1}>
          {questions.map((q: any, i: number) => (
            // @ts-expect-error: key prop
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
  return (
    <InlineTool icon="→" pending="Loading skill..." complete={(props.input as any).name} part={props.part}>
      Skill "{(props.input as any).name}"
    </InlineTool>
  )
}

export function CommandStatus(props: ToolProps) {
  const { theme } = useTheme()
  const metadata = props.metadata as any
  const running = props.part.state.status === "running"
  const output = stripAnsi((props.output || metadata.output || "") as string)
  const [expanded, setExpanded] = useState(false)
  const lines = output.split("\n")
  const overflow = lines.length > 10
  const limited = expanded || !overflow ? output : [...lines.slice(0, 10), "…"].join("\n")

  if (metadata.output !== undefined || props.output) {
    return (
      <BlockTool
        title={`# Status: ${metadata.commandId || (props.input as any).CommandId || "unknown"}`}
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
    <InlineTool icon="⚙" pending="Checking status..." complete={(props.input as any).CommandId} part={props.part}>
      Status: {metadata.commandId || (props.input as any).CommandId || "unknown"}
    </InlineTool>
  )
}

export function SendCommandInput(props: ToolProps) {
  const { theme } = useTheme()
  const metadata = props.metadata as any
  const running = props.part.state.status === "running"
  const output = stripAnsi((props.output || metadata.output || "") as string)

  const text = (props.input as any).Terminate ? "Sending terminate signal" : "Sending input"

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
    <InlineTool icon="⚙" pending="Sending input..." complete={(props.input as any).CommandId} part={props.part}>
      {text}: {metadata.commandId || (props.input as any).CommandId || "unknown"}
    </InlineTool>
  )
}

export function ApplyPatch(props: ToolProps) {
  const { theme } = useTheme()
  const files = (props.metadata as any).files ?? []

  if (files.length > 0) {
    return (
      <Box flexDirection="column">
        {files.map((file: any, i: number) => (
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
              <StructuredDiff modifiedContent={file.diff} />
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
  const todos = (props.metadata as any).todos ?? []
  if (todos.length > 0) {
    return (
      <BlockTool title="# Todos" part={props.part}>
        <Box flexDirection="column">
          {todos.map((todo: any, i: number) => (
            // @ts-expect-error: key prop
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
