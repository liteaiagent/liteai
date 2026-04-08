import path from "node:path"
import { Global } from "@liteai/core/global/index"
import type { ApplyPatchTool } from "@liteai/core/tool/apply_patch"
import type { EditTool } from "@liteai/core/tool/edit"
import type { GlobTool } from "@liteai/core/tool/glob"
import type { GrepTool } from "@liteai/core/tool/grep"
import type { ListTool } from "@liteai/core/tool/ls"
import type { QuestionTool } from "@liteai/core/tool/question"
import type { ReadTool } from "@liteai/core/tool/read"
import type { RunCommandTool } from "@liteai/core/tool/run_command"
import type { SkillTool } from "@liteai/core/tool/skill"
import type { TaskTool } from "@liteai/core/tool/task"
import type { TodoWriteTool } from "@liteai/core/tool/todo"
import type { Tool } from "@liteai/core/tool/tool"
import type { WebFetchTool } from "@liteai/core/tool/webfetch"
import type { WriteTool } from "@liteai/core/tool/write"
import { Filesystem } from "@liteai/core/util/filesystem"
import { Locale } from "@liteai/core/util/locale"
import type { ToolPart } from "@liteai/sdk"
import { type BoxRenderable, type RGBA, TextAttributes } from "@opentui/core"
import { type JSX, useRenderer } from "@opentui/solid"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { TodoItem } from "@tui/component/todo-item"
import { useKeybind } from "@tui/context/keybind"
import { useLocal } from "@tui/context/local"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import stripAnsi from "strip-ansi"
import { use } from "./ctx"
import { filetype, formatInput, normalizePath } from "./utils"

export type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission: Record<string, unknown>
  tool: string
  output?: string
  part: ToolPart
}

export function GenericTool(props: ToolProps<Tool.Info>) {
  const { theme } = useTheme()
  const ctx = use()
  const output = createMemo(() => props.output?.trim() ?? "")
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const max = 3
  const overflow = createMemo(() => lines().length > max)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, max), "…"].join("\n")
  })

  return (
    <Show
      when={props.output && ctx.showGenericToolOutput()}
      fallback={
        <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
          {props.tool} {formatInput(props.input)}
        </InlineTool>
      }
    >
      <BlockTool
        title={`# ${props.tool} ${formatInput(props.input)}`}
        part={props.part}
        onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
      >
        <box gap={1}>
          <text fg={theme.text}>{limited()}</text>
          <Show when={overflow()}>
            <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
          </Show>
        </box>
      </BlockTool>
    </Show>
  )
}

function InlineTool(props: {
  icon: string
  iconColor?: RGBA
  complete: unknown
  pending: string
  spinner?: boolean
  children: JSX.Element
  part: ToolPart
  onClick?: () => void
}) {
  const [margin, setMargin] = createSignal(0)
  const { theme } = useTheme()
  const ctx = use()
  const sync = useSync()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)

  const permission = createMemo(() => {
    const callID = sync.data.permission[ctx.sessionID]?.at(0)?.tool?.callID
    if (!callID) return false
    return callID === props.part.callID
  })

  const fg = createMemo(() => {
    if (permission()) return theme.warning
    if (hover() && props.onClick) return theme.text
    if (props.complete) return theme.textMuted
    return theme.text
  })

  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error : undefined))

  const denied = createMemo(
    () =>
      error()?.includes("rejected permission") ||
      error()?.includes("specified a rule") ||
      error()?.includes("user dismissed"),
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: TUI element, not HTML
    // biome-ignore lint/a11y/useKeyWithMouseEvents: TUI element, not HTML
    <box
      marginTop={margin()}
      paddingLeft={3}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
      renderBefore={function () {
        const el = this as BoxRenderable
        const parent = el.parent
        if (!parent) {
          return
        }
        if (el.height > 1) {
          setMargin(1)
          return
        }
        const children = parent.getChildren()
        const index = children.indexOf(el)
        const previous = children[index - 1]
        if (!previous) {
          setMargin(0)
          return
        }
        if (previous.height > 1 || previous.id.startsWith("text-")) {
          setMargin(1)
          return
        }
      }}
    >
      <Switch>
        <Match when={props.spinner}>
          <Spinner color={fg()} children={props.children} />
        </Match>
        <Match when={true}>
          <text paddingLeft={3} fg={fg()} attributes={denied() ? TextAttributes.STRIKETHROUGH : undefined}>
            <Show fallback={<>~ {props.pending}</>} when={props.complete}>
              <span style={{ fg: props.iconColor }}>{props.icon}</span> {props.children}
            </Show>
          </text>
        </Match>
      </Switch>
      <Show when={error() && !denied()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function BlockTool(props: {
  title: string
  children: JSX.Element
  onClick?: () => void
  part?: ToolPart
  spinner?: boolean
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error : undefined))
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: TUI element, not HTML
    // biome-ignore lint/a11y/useKeyWithMouseEvents: TUI element, not HTML
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundPanel}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <Show
        when={props.spinner}
        fallback={
          <text paddingLeft={3} fg={theme.textMuted}>
            {props.title}
          </text>
        }
      >
        <Spinner color={theme.textMuted}>{props.title.replace(/^# /, "")}</Spinner>
      </Show>
      {props.children}
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function Diagnostics(props: { diagnostics?: Record<string, Record<string, unknown>[]>; filePath: string }) {
  const { theme } = useTheme()
  const errors = createMemo(() => {
    const normalized = Filesystem.normalizePath(props.filePath)
    const arr = props.diagnostics?.[normalized] ?? []
    return arr.filter((x) => x.severity === 1).slice(0, 3)
  })

  return (
    <Show when={errors().length}>
      <box>
        <For each={errors()}>
          {(diagnostic) => (
            <text fg={theme.error}>
              Error [{(diagnostic.range as Record<string, Record<string, number>>).start.line + 1}:
              {(diagnostic.range as Record<string, Record<string, number>>).start.character + 1}]{" "}
              {diagnostic.message as string}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

export function RunCommand(props: ToolProps<typeof RunCommandTool>) {
  const { theme } = useTheme()
  const sync = useSync()
  const running = createMemo(() => props.part.state.status === "running")
  const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const overflow = createMemo(() => lines().length > 10)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, 10), "…"].join("\n")
  })

  const dir = createMemo(() => {
    const workdir = props.input.cwd
    if (!workdir || workdir === ".") return undefined

    const base = sync.data.path.directory
    if (!base) return undefined

    const absolute = path.resolve(base, workdir)
    if (absolute === base) return undefined

    const home = Global.Path.home
    if (!home) return absolute

    const match = absolute === home || absolute.startsWith(home + path.sep)
    return match ? absolute.replace(home, "~") : absolute
  })

  const title = createMemo(() => {
    const desc = props.input.description ?? "Shell"
    const wd = dir()
    if (!wd) return `# ${desc}`
    if (desc.includes(wd)) return `# ${desc}`
    return `# ${desc} in ${wd}`
  })

  return (
    <Switch>
      <Match when={props.metadata.output !== undefined}>
        <BlockTool
          title={title()}
          part={props.part}
          spinner={running()}
          onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            <text fg={theme.text}>$ {props.input.command}</text>
            <Show when={output()}>
              <text fg={theme.text}>{limited()}</text>
            </Show>
            <Show when={overflow()}>
              <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="$" pending="Writing command..." complete={props.input.command} part={props.part}>
          {props.input.command}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Write(props: ToolProps<typeof WriteTool>) {
  const { theme, syntax } = useTheme()
  const code = createMemo(() => {
    if (!props.input.content) return ""
    return props.input.content
  })

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool title={`# Wrote ${normalizePath(props.input.filePath)}`} part={props.part}>
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text}
              filetype={filetype(props.input.filePath)}
              syntaxStyle={syntax()}
              content={code()}
            />
          </line_number>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing write..." complete={props.input.filePath} part={props.part}>
          Write {normalizePath(props.input.filePath)}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Glob(props: ToolProps<typeof GlobTool>) {
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={props.input.pattern} part={props.part}>
      Glob "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.count}>
        ({props.metadata.count} {props.metadata.count === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

export function Read(props: ToolProps<typeof ReadTool>) {
  const { theme } = useTheme()
  const running = createMemo(() => props.part.state.status === "running")
  const loaded = createMemo(() => {
    if (props.part.state.status !== "completed") return []
    if (props.part.state.time.compacted) return []
    const value = props.metadata.loaded
    if (!value || !Array.isArray(value)) return []
    return value.filter((p): p is string => typeof p === "string")
  })
  return (
    <>
      <InlineTool
        icon="→"
        pending="Reading file..."
        complete={props.input.filePath}
        spinner={running()}
        part={props.part}
      >
        Read {normalizePath(props.input.filePath)} {formatInput(props.input, ["filePath"])}
      </InlineTool>
      <For each={loaded()}>
        {(filepath) => (
          <box paddingLeft={3}>
            <text paddingLeft={3} fg={theme.textMuted}>
              ↳ Loaded {normalizePath(filepath)}
            </text>
          </box>
        )}
      </For>
    </>
  )
}

export function Grep(props: ToolProps<typeof GrepTool>) {
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={props.input.pattern} part={props.part}>
      Grep "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.matches}>
        ({props.metadata.matches} {props.metadata.matches === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

export function List(props: ToolProps<typeof ListTool>) {
  const dir = createMemo(() => {
    if (props.input.path) {
      return normalizePath(props.input.path)
    }
    return ""
  })
  return (
    <InlineTool icon="→" pending="Listing directory..." complete={props.input.path !== undefined} part={props.part}>
      List {dir()}
    </InlineTool>
  )
}

export function WebFetch(props: ToolProps<typeof WebFetchTool>) {
  return (
    <InlineTool
      icon="%"
      pending="Fetching from the web..."
      complete={(props.input as Record<string, unknown>).url}
      part={props.part}
    >
      WebFetch {(props.input as Record<string, unknown>).url as string}
    </InlineTool>
  )
}

export function CodeSearch(props: ToolProps<Tool.Info>) {
  const inp = props.input as Record<string, unknown>
  const meta = props.metadata as Record<string, unknown>
  return (
    <InlineTool icon="◇" pending="Searching code..." complete={inp.query} part={props.part}>
      Exa Code Search "{inp.query as string}" <Show when={meta.results}>({meta.results as number} results)</Show>
    </InlineTool>
  )
}

export function WebSearch(props: ToolProps<Tool.Info>) {
  const inp = props.input as Record<string, unknown>
  const meta = props.metadata as Record<string, unknown>
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={inp.query} part={props.part}>
      Exa Web Search "{inp.query as string}" <Show when={meta.numResults}>({meta.numResults as number} results)</Show>
    </InlineTool>
  )
}

export function Task(props: ToolProps<typeof TaskTool>) {
  useTheme()
  const _keybind = useKeybind()
  const { navigate } = useRoute()
  const _local = useLocal()
  const sync = useSync()

  onMount(() => {
    if (props.metadata.sessionId && !sync.data.message[props.metadata.sessionId]?.length)
      sync.session.sync(props.metadata.sessionId)
  })

  const messages = createMemo(() => sync.data.message[props.metadata.sessionId ?? ""] ?? [])

  const tools = createMemo(() => {
    return messages().flatMap((msg) =>
      (sync.data.part[msg.id] ?? [])
        .filter((part): part is ToolPart => part.type === "tool")
        .map((part) => ({ tool: part.tool, state: part.state })),
    )
  })

  const current = createMemo(
    () => tools().findLast((x) => (x.state as Record<string, unknown>).title) as Record<string, unknown> | undefined,
  )

  const running = createMemo(() => props.part.state.status === "running")

  const duration = createMemo(() => {
    const first = messages().find((x) => x.role === "user")?.time.created
    const assistant = messages().findLast((x) => x.role === "assistant")?.time.completed
    if (!first || !assistant) return 0
    return assistant - first
  })

  const content = createMemo(() => {
    if (!props.input.description) return ""
    const lines = [`Task ${props.input.description}`]

    if (running() && tools().length > 0) {
      if (current())
        lines.push(
          `↳ ${Locale.titlecase(((current() as Record<string, unknown>).tool as string) ?? "")} ${(current() as Record<string, unknown>).title}`,
        )
      else lines.push(`↳ ${tools().length} toolcalls`)
    }

    if (props.part.state.status === "completed") {
      lines.push(`└ ${tools().length} toolcalls · ${Locale.duration(duration())}`)
    }

    return lines.join("\n")
  })

  return (
    <InlineTool
      icon="│"
      spinner={running()}
      complete={props.input.description}
      pending="Delegating..."
      part={props.part}
      onClick={() => {
        if (props.metadata.sessionId) {
          navigate({ type: "session", sessionID: props.metadata.sessionId })
        }
      }}
    >
      {content()}
    </InlineTool>
  )
}

export function Edit(props: ToolProps<typeof EditTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()

  const view = createMemo(() => {
    const style = ctx.tui.diff_style
    if (style === "stacked") return "unified"
    return ctx.width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype(props.input.filePath))

  const diff = createMemo(() => props.metadata.diff)

  return (
    <Switch>
      <Match when={props.metadata.diff !== undefined}>
        <BlockTool title={`← Edit ${normalizePath(props.input.filePath)}`} part={props.part}>
          <box paddingLeft={1}>
            <diff
              diff={diff()}
              view={view()}
              filetype={ft()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={ctx.diffWrapMode()}
              fg={theme.text}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              contextBg={theme.diffContextBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              lineNumberBg={theme.diffContextBg}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing edit..." complete={props.input.filePath} part={props.part}>
          Edit {normalizePath(props.input.filePath)} {formatInput({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function ApplyPatch(props: ToolProps<typeof ApplyPatchTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()

  const files = createMemo(() => props.metadata.files ?? [])

  const view = createMemo(() => {
    const style = ctx.tui.diff_style
    if (style === "stacked") return "unified"
    return ctx.width > 120 ? "split" : "unified"
  })

  function Diff(p: { diff: string; filePath: string }) {
    return (
      <box paddingLeft={1}>
        <diff
          diff={p.diff}
          view={view()}
          filetype={filetype(p.filePath)}
          syntaxStyle={syntax()}
          showLineNumbers={true}
          width="100%"
          wrapMode={ctx.diffWrapMode()}
          fg={theme.text}
          addedBg={theme.diffAddedBg}
          removedBg={theme.diffRemovedBg}
          contextBg={theme.diffContextBg}
          addedSignColor={theme.diffHighlightAdded}
          removedSignColor={theme.diffHighlightRemoved}
          lineNumberFg={theme.diffLineNumber}
          lineNumberBg={theme.diffContextBg}
          addedLineNumberBg={theme.diffAddedLineNumberBg}
          removedLineNumberBg={theme.diffRemovedLineNumberBg}
        />
      </box>
    )
  }

  function title(file: { type: string; relativePath: string; filePath: string; deletions: number }) {
    if (file.type === "delete") return `# Deleted ${file.relativePath}`
    if (file.type === "add") return `# Created ${file.relativePath}`
    if (file.type === "move") return `# Moved ${normalizePath(file.filePath)} → ${file.relativePath}`
    return `← Patched ${file.relativePath}`
  }

  return (
    <Switch>
      <Match when={files().length > 0}>
        <For each={files()}>
          {(file) => (
            <BlockTool title={title(file)} part={props.part}>
              <Show
                when={file.type !== "delete"}
                fallback={
                  <text fg={theme.diffRemoved}>
                    -{file.deletions} line{file.deletions !== 1 ? "s" : ""}
                  </text>
                }
              >
                <Diff diff={file.diff} filePath={file.filePath} />
                <Diagnostics diagnostics={props.metadata.diagnostics} filePath={file.movePath ?? file.filePath} />
              </Show>
            </BlockTool>
          )}
        </For>
      </Match>
      <Match when={true}>
        <InlineTool icon="%" pending="Preparing patch..." complete={false} part={props.part}>
          Patch
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function TodoWrite(props: ToolProps<typeof TodoWriteTool>) {
  return (
    <Switch>
      <Match when={props.metadata.todos?.length}>
        <BlockTool title="# Todos" part={props.part}>
          <box>
            <For each={props.input.todos ?? []}>
              {(todo) => <TodoItem status={todo.status} content={todo.content} />}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⚙" pending="Updating todos..." complete={false} part={props.part}>
          Updating todos...
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Question(props: ToolProps<typeof QuestionTool>) {
  const { theme } = useTheme()
  const count = createMemo(() => props.input.questions?.length ?? 0)

  function format(answer?: string[]) {
    if (!answer?.length) return "(no answer)"
    return answer.join(", ")
  }

  return (
    <Switch>
      <Match when={props.metadata.answers}>
        <BlockTool title="# Questions" part={props.part}>
          <box gap={1}>
            <For each={props.input.questions ?? []}>
              {(q, i) => (
                <box flexDirection="column">
                  <text fg={theme.textMuted}>{q.question}</text>
                  <text fg={theme.text}>{format(props.metadata.answers?.[i()])}</text>
                </box>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="→" pending="Asking questions..." complete={count()} part={props.part}>
          Asked {count()} question{count() !== 1 ? "s" : ""}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function Skill(props: ToolProps<typeof SkillTool>) {
  return (
    <InlineTool icon="→" pending="Loading skill..." complete={props.input.name} part={props.part}>
      Skill "{props.input.name}"
    </InlineTool>
  )
}

export function CommandStatus(props: ToolProps<Tool.Info>) {
  const { theme } = useTheme()
  const input = props.input as Record<string, unknown>
  const metadata = props.metadata as Record<string, unknown>
  const running = createMemo(() => props.part.state.status === "running")
  const output = createMemo(() => {
    let out = props.output || metadata.output || ""
    if (typeof out === "object") out = JSON.stringify(out, null, 2)
    return stripAnsi(out as string)
  })
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const overflow = createMemo(() => lines().length > 10)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, 10), "…"].join("\n")
  })

  return (
    <Switch>
      <Match when={metadata.output !== undefined || props.output}>
        <BlockTool
          title={`# Status: ${metadata.commandId || input.CommandId || ""}`}
          part={props.part}
          spinner={running()}
          onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            <text fg={theme.text}>{metadata.status === "running" ? "Running" : "Completed"}</text>
            <Show when={output()}>
              <text fg={theme.text}>{limited()}</text>
            </Show>
            <Show when={overflow()}>
              <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⚙" pending="Checking status..." complete={input.CommandId} part={props.part}>
          Status: {input.CommandId as string}
        </InlineTool>
      </Match>
    </Switch>
  )
}

export function SendCommandInput(props: ToolProps<Tool.Info>) {
  const { theme } = useTheme()
  const input = props.input as Record<string, unknown>
  const metadata = props.metadata as Record<string, unknown>
  const running = createMemo(() => props.part.state.status === "running")
  const output = createMemo(() => {
    let out = props.output || metadata.output || ""
    if (typeof out === "object") out = JSON.stringify(out, null, 2)
    return stripAnsi(out as string)
  })

  const text = createMemo(() => {
    if (input.Terminate) return "Sending terminate signal"
    return `Sending input`
  })

  return (
    <Switch>
      <Match when={metadata.output !== undefined || props.output}>
        <BlockTool title={`# ${text()}`} part={props.part} spinner={running()}>
          <box gap={1}>
            <Show when={output()}>
              <text fg={theme.text}>{output()}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⚙" pending="Sending input..." complete={input.CommandId} part={props.part}>
          {text()}: {input.CommandId as string}
        </InlineTool>
      </Match>
    </Switch>
  )
}
