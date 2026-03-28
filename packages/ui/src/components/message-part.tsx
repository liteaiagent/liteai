import type {
  AgentPart,
  AssistantMessage,
  FilePart,
  Message as MessageType,
  Part as PartType,
  TextPart,
  ToolPart,
  UserMessage,
} from "@liteai/sdk"
import { getFilename } from "@liteai/util/path"
import { type Component, createMemo, createSignal, For, Index, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { useData } from "../context"
import { useDialog } from "../context/dialog"
import { useI18n } from "../context/i18n"
import { Collapsible } from "./collapsible"
import { FileIcon } from "./file-icon"
import { IconButton } from "./icon-button"
import { ImagePreview } from "./image-preview"
import { attached, inline, kind } from "./message-file"
import { agentTitle, getDirectory } from "./message-utils"
import { TextShimmer } from "./text-shimmer"
import { AnimatedCountList } from "./tool-count-summary"
import { ToolStatusTitle } from "./tool-status-title"
import { Tooltip } from "./tooltip"

export interface MessageProps {
  message: MessageType
  parts: PartType[]
  actions?: UserActions
  showAssistantCopyPartID?: string | null
  showReasoningSummaries?: boolean
}

export type SessionAction = (input: { sessionID: string; messageID: string }) => Promise<void> | void

export type UserActions = {
  fork?: SessionAction
  revert?: SessionAction
}

export interface MessagePartProps {
  part: PartType
  message: MessageType
  hideDetails?: boolean
  defaultOpen?: boolean
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
}

export type PartComponent = Component<MessagePartProps>

import { CompactionPartDisplay } from "./message-parts/compaction"
import { ReasoningPartDisplay } from "./message-parts/reasoning"
import { TextPartDisplay } from "./message-parts/text"
import { ToolPartDisplay } from "./message-parts/tool"

export { MessageDivider } from "./message-parts/compaction"
export const PART_MAPPING: Record<string, PartComponent | undefined> = {}
PART_MAPPING.tool = ToolPartDisplay
PART_MAPPING.compaction = CompactionPartDisplay
PART_MAPPING.text = TextPartDisplay
PART_MAPPING.reasoning = ReasoningPartDisplay

import type { IconProps } from "./icon"

export type ToolInfo = {
  icon: IconProps["name"]
  title: string
  subtitle?: string
}

export function getToolInfo(tool: string, input: Record<string, unknown> = {}): ToolInfo {
  const i18n = useI18n()
  switch (tool) {
    case "read":
      return {
        icon: "glasses",
        title: i18n.t("ui.tool.read"),
        subtitle: typeof input.filePath === "string" ? getFilename(input.filePath) : undefined,
      }
    case "list":
      return {
        icon: "bullet-list",
        title: i18n.t("ui.tool.list"),
        subtitle: typeof input.path === "string" ? getFilename(input.path) : undefined,
      }
    case "glob":
      return {
        icon: "magnifying-glass-menu",
        title: i18n.t("ui.tool.glob"),
        subtitle: typeof input.pattern === "string" ? input.pattern : undefined,
      }
    case "grep":
      return {
        icon: "magnifying-glass-menu",
        title: i18n.t("ui.tool.grep"),
        subtitle: typeof input.pattern === "string" ? input.pattern : undefined,
      }
    case "webfetch":
      return {
        icon: "window-cursor",
        title: i18n.t("ui.tool.webfetch"),
        subtitle: typeof input.url === "string" ? input.url : undefined,
      }
    case "websearch":
      return {
        icon: "window-cursor",
        title: i18n.t("ui.tool.websearch"),
        subtitle: typeof input.query === "string" ? input.query : undefined,
      }
    case "codesearch":
      return {
        icon: "code",
        title: i18n.t("ui.tool.codesearch"),
        subtitle: typeof input.query === "string" ? input.query : undefined,
      }
    case "task": {
      const type =
        typeof input.subagent_type === "string" && input.subagent_type
          ? input.subagent_type[0]?.toUpperCase() + input.subagent_type.slice(1)
          : undefined
      return {
        icon: "task",
        title: agentTitle(i18n, type),
        subtitle: typeof input.description === "string" ? input.description : undefined,
      }
    }
    case "run_command":
      return {
        icon: "console",
        title: i18n.t("ui.tool.shell"),
        subtitle: typeof input.description === "string" ? input.description : undefined,
      }
    case "edit":
      return {
        icon: "code-lines",
        title: i18n.t("ui.messagePart.title.edit"),
        subtitle: typeof input.filePath === "string" ? getFilename(input.filePath) : undefined,
      }
    case "write":
      return {
        icon: "code-lines",
        title: i18n.t("ui.messagePart.title.write"),
        subtitle: typeof input.filePath === "string" ? getFilename(input.filePath) : undefined,
      }
    case "apply_patch":
      return {
        icon: "code-lines",
        title: i18n.t("ui.tool.patch"),
        subtitle:
          Array.isArray(input.files) && input.files.length > 0
            ? `${input.files.length} ${i18n.t(input.files.length > 1 ? "ui.common.file.other" : "ui.common.file.one")}`
            : undefined,
      }
    case "todowrite":
      return {
        icon: "checklist",
        title: i18n.t("ui.tool.todos"),
      }
    case "todoread":
      return {
        icon: "checklist",
        title: i18n.t("ui.tool.todos.read"),
      }
    case "question":
      return {
        icon: "bubble-5",
        title: i18n.t("ui.tool.questions"),
      }
    case "skill":
      return {
        icon: "brain",
        title: (typeof input.name === "string" ? input.name : "") || i18n.t("ui.tool.skill"),
      }
    default:
      return {
        icon: "mcp",
        title: tool,
      }
  }
}

const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
const HIDDEN_TOOLS = new Set(["todowrite", "todoread"])

function list<T>(value: T[] | undefined | null, fallback: T[]) {
  if (Array.isArray(value)) return value
  return fallback
}

function same<T>(a: readonly T[] | undefined, b: readonly T[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

type PartRef = {
  messageID: string
  partID: string
}

type PartGroup =
  | {
      key: string
      type: "part"
      ref: PartRef
    }
  | {
      key: string
      type: "context"
      refs: PartRef[]
    }

function sameRef(a: PartRef, b: PartRef) {
  return a.messageID === b.messageID && a.partID === b.partID
}

function sameGroup(a: PartGroup, b: PartGroup) {
  if (a === b) return true
  if (a.key !== b.key) return false
  if (a.type !== b.type) return false
  if (a.type === "part") {
    if (b.type !== "part") return false
    return sameRef(a.ref, b.ref)
  }
  if (b.type !== "context") return false
  if (a.refs.length !== b.refs.length) return false
  return a.refs.every((ref, i) => {
    const other = b.refs[i]
    return other ? sameRef(ref, other) : false
  })
}

function sameGroups(a: readonly PartGroup[] | undefined, b: readonly PartGroup[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((item, i) => {
    const other = b[i]
    return other ? sameGroup(item, other) : false
  })
}

function groupParts(parts: { messageID: string; part: PartType }[]) {
  const result: PartGroup[] = []
  let start = -1

  const flush = (end: number) => {
    if (start < 0) return
    const first = parts[start]
    const last = parts[end]
    if (!first || !last) {
      start = -1
      return
    }
    result.push({
      key: `context:${first.part.id}`,
      type: "context",
      refs: parts.slice(start, end + 1).map((item) => ({
        messageID: item.messageID,
        partID: item.part.id,
      })),
    })
    start = -1
  }

  parts.forEach((item, index) => {
    if (isContextGroupTool(item.part)) {
      if (start < 0) start = index
      return
    }

    flush(index - 1)
    result.push({
      key: `part:${item.messageID}:${item.part.id}`,
      type: "part",
      ref: {
        messageID: item.messageID,
        partID: item.part.id,
      },
    })
  })

  flush(parts.length - 1)
  return result
}

function index<T extends { id: string }>(items: readonly T[]) {
  return new Map(items.map((item) => [item.id, item] as const))
}

function renderable(part: PartType, showReasoningSummaries = true) {
  if (part.type === "tool") {
    if (HIDDEN_TOOLS.has(part.tool)) return false
    if (part.tool === "question") return part.state.status !== "pending" && part.state.status !== "running"
    return true
  }
  if (part.type === "text") return !!part.text?.trim()
  if (part.type === "reasoning") return showReasoningSummaries && !!part.text?.trim()
  return !!PART_MAPPING[part.type]
}

function toolDefaultOpen(tool: string, shell = false, edit = false) {
  if (tool === "run_command") return shell
  if (tool === "edit" || tool === "write" || tool === "apply_patch") return edit
}

function partDefaultOpen(part: PartType, shell = false, edit = false) {
  if (part.type !== "tool") return
  return toolDefaultOpen(part.tool, shell, edit)
}

export function AssistantParts(props: {
  messages: AssistantMessage[]
  showAssistantCopyPartID?: string | null
  turnDurationMs?: number
  working?: boolean
  showReasoningSummaries?: boolean
  shellToolDefaultOpen?: boolean
  editToolDefaultOpen?: boolean
}) {
  const data = useData()
  const emptyParts: PartType[] = []
  const emptyTools: ToolPart[] = []
  const msgs = createMemo(() => index(props.messages))
  const part = createMemo(
    () =>
      new Map(
        props.messages.map((message) => [message.id, index(list(data.store.part?.[message.id], emptyParts))] as const),
      ),
  )

  const grouped = createMemo(
    () =>
      groupParts(
        props.messages.flatMap((message) =>
          list(data.store.part?.[message.id], emptyParts)
            .filter((part) => renderable(part, props.showReasoningSummaries ?? true))
            .map((part) => ({
              messageID: message.id,
              part,
            })),
        ),
      ),
    [] as PartGroup[],
    { equals: sameGroups },
  )

  const last = createMemo(() => grouped().at(-1)?.key)

  return (
    <Index each={grouped()}>
      {(entryAccessor) => {
        const entryType = createMemo(() => entryAccessor().type)

        return (
          <Switch>
            <Match when={entryType() === "context"}>
              {(() => {
                const parts = createMemo(
                  () => {
                    const entry = entryAccessor()
                    if (entry.type !== "context") return emptyTools
                    return entry.refs
                      .map((ref) => part().get(ref.messageID)?.get(ref.partID))
                      .filter((part): part is ToolPart => !!part && isContextGroupTool(part))
                  },
                  emptyTools,
                  { equals: same },
                )
                const busy = createMemo(() => props.working && last() === entryAccessor().key)

                return (
                  <Show when={parts().length > 0}>
                    <ContextToolGroup parts={parts()} busy={busy()} />
                  </Show>
                )
              })()}
            </Match>
            <Match when={entryType() === "part"}>
              {(() => {
                const message = createMemo(() => {
                  const entry = entryAccessor()
                  if (entry.type !== "part") return
                  return msgs().get(entry.ref.messageID)
                })
                const item = createMemo(() => {
                  const entry = entryAccessor()
                  if (entry.type !== "part") return
                  return part().get(entry.ref.messageID)?.get(entry.ref.partID)
                })

                return (
                  <Show when={message()}>
                    <Show when={item()}>
                      <Part
                        part={item() as PartType}
                        message={message() as MessageType}
                        showAssistantCopyPartID={props.showAssistantCopyPartID}
                        turnDurationMs={props.turnDurationMs}
                        defaultOpen={partDefaultOpen(
                          item() as PartType,
                          props.shellToolDefaultOpen,
                          props.editToolDefaultOpen,
                        )}
                      />
                    </Show>
                  </Show>
                )
              })()}
            </Match>
          </Switch>
        )
      }}
    </Index>
  )
}

function isContextGroupTool(part: PartType): part is ToolPart {
  return part.type === "tool" && CONTEXT_GROUP_TOOLS.has(part.tool)
}

function contextToolDetail(part: ToolPart): string | undefined {
  const info = getToolInfo(part.tool, part.state.input ?? {})
  if (info.subtitle) return info.subtitle
  if (part.state.status === "error") return part.state.error
  if ((part.state.status === "running" || part.state.status === "completed") && part.state.title)
    return part.state.title
  const description = part.state.input?.description
  if (typeof description === "string") return description
  return undefined
}

function contextToolTrigger(part: ToolPart, i18n: ReturnType<typeof useI18n>) {
  const input = (part.state.input ?? {}) as Record<string, unknown>
  const path = typeof input.path === "string" ? input.path : "/"
  const filePath = typeof input.filePath === "string" ? input.filePath : undefined
  const pattern = typeof input.pattern === "string" ? input.pattern : undefined
  const include = typeof input.include === "string" ? input.include : undefined
  const offset = typeof input.offset === "number" ? input.offset : undefined
  const limit = typeof input.limit === "number" ? input.limit : undefined

  switch (part.tool) {
    case "read": {
      const args: string[] = []
      if (offset !== undefined) args.push(`offset=${offset}`)
      if (limit !== undefined) args.push(`limit=${limit}`)
      return {
        title: i18n.t("ui.tool.read"),
        subtitle: filePath ? getFilename(filePath) : "",
        args,
      }
    }
    case "list":
      return {
        title: i18n.t("ui.tool.list"),
        subtitle: getDirectory(path),
      }
    case "glob":
      return {
        title: i18n.t("ui.tool.glob"),
        subtitle: getDirectory(path),
        args: pattern ? [`pattern=${pattern}`] : [],
      }
    case "grep": {
      const args: string[] = []
      if (pattern) args.push(`pattern=${pattern}`)
      if (include) args.push(`include=${include}`)
      return {
        title: i18n.t("ui.tool.grep"),
        subtitle: getDirectory(path),
        args,
      }
    }
    default: {
      const info = getToolInfo(part.tool, input)
      return {
        title: info.title,
        subtitle: info.subtitle || contextToolDetail(part),
        args: [],
      }
    }
  }
}

function contextToolSummary(parts: ToolPart[]) {
  const read = parts.filter((part) => part.tool === "read").length
  const search = parts.filter((part) => part.tool === "glob" || part.tool === "grep").length
  const list = parts.filter((part) => part.tool === "list").length
  return { read, search, list }
}

export function registerPartComponent(type: string, component: PartComponent) {
  PART_MAPPING[type] = component
}

export function Message(props: MessageProps) {
  return (
    <Switch>
      <Match when={props.message.role === "user" && props.message}>
        {(userMessage) => (
          <UserMessageDisplay message={userMessage() as UserMessage} parts={props.parts} actions={props.actions} />
        )}
      </Match>
      <Match when={props.message.role === "assistant" && props.message}>
        {(assistantMessage) => (
          <AssistantMessageDisplay
            message={assistantMessage() as AssistantMessage}
            parts={props.parts}
            showAssistantCopyPartID={props.showAssistantCopyPartID}
            showReasoningSummaries={props.showReasoningSummaries}
          />
        )}
      </Match>
    </Switch>
  )
}

export function AssistantMessageDisplay(props: {
  message: AssistantMessage
  parts: PartType[]
  showAssistantCopyPartID?: string | null
  showReasoningSummaries?: boolean
}) {
  const emptyTools: ToolPart[] = []
  const part = createMemo(() => index(props.parts))
  const grouped = createMemo(
    () =>
      groupParts(
        props.parts
          .filter((part) => renderable(part, props.showReasoningSummaries ?? true))
          .map((part) => ({
            messageID: props.message.id,
            part,
          })),
      ),
    [] as PartGroup[],
    { equals: sameGroups },
  )

  return (
    <Index each={grouped()}>
      {(entryAccessor) => {
        const entryType = createMemo(() => entryAccessor().type)

        return (
          <Switch>
            <Match when={entryType() === "context"}>
              {(() => {
                const parts = createMemo(
                  () => {
                    const entry = entryAccessor()
                    if (entry.type !== "context") return emptyTools
                    return entry.refs
                      .map((ref) => part().get(ref.partID))
                      .filter((part): part is ToolPart => !!part && isContextGroupTool(part))
                  },
                  emptyTools,
                  { equals: same },
                )

                return (
                  <Show when={parts().length > 0}>
                    <ContextToolGroup parts={parts()} />
                  </Show>
                )
              })()}
            </Match>
            <Match when={entryType() === "part"}>
              {(() => {
                const item = createMemo(() => {
                  const entry = entryAccessor()
                  if (entry.type !== "part") return
                  return part().get(entry.ref.partID)
                })

                return (
                  <Show when={item()}>
                    <Part
                      part={item() as PartType}
                      message={props.message}
                      showAssistantCopyPartID={props.showAssistantCopyPartID}
                    />
                  </Show>
                )
              })()}
            </Match>
          </Switch>
        )
      }}
    </Index>
  )
}

function ContextToolGroup(props: { parts: ToolPart[]; busy?: boolean }) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  const pending = createMemo(
    () =>
      !!props.busy || props.parts.some((part) => part.state.status === "pending" || part.state.status === "running"),
  )
  const summary = createMemo(() => contextToolSummary(props.parts))

  return (
    <Collapsible open={open()} onOpenChange={setOpen} variant="ghost">
      <Collapsible.Trigger>
        <div data-component="context-tool-group-trigger">
          <span
            data-slot="context-tool-group-title"
            class="min-w-0 flex items-center gap-2 text-14-medium text-text-strong"
          >
            <span data-slot="context-tool-group-label" class="shrink-0">
              <ToolStatusTitle
                active={pending()}
                activeText={i18n.t("ui.sessionTurn.status.gatheringContext")}
                doneText={i18n.t("ui.sessionTurn.status.gatheredContext")}
                split={false}
              />
            </span>
            <span
              data-slot="context-tool-group-summary"
              class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-normal text-text-base"
            >
              <AnimatedCountList
                items={[
                  {
                    key: "read",
                    count: summary().read,
                    one: i18n.t("ui.messagePart.context.read.one"),
                    other: i18n.t("ui.messagePart.context.read.other"),
                  },
                  {
                    key: "search",
                    count: summary().search,
                    one: i18n.t("ui.messagePart.context.search.one"),
                    other: i18n.t("ui.messagePart.context.search.other"),
                  },
                  {
                    key: "list",
                    count: summary().list,
                    one: i18n.t("ui.messagePart.context.list.one"),
                    other: i18n.t("ui.messagePart.context.list.other"),
                  },
                ]}
                fallback=""
              />
            </span>
          </span>
          <Collapsible.Arrow />
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div data-component="context-tool-group-list">
          <Index each={props.parts}>
            {(partAccessor) => {
              const trigger = createMemo(() => contextToolTrigger(partAccessor(), i18n))
              const running = createMemo(
                () => partAccessor().state.status === "pending" || partAccessor().state.status === "running",
              )
              return (
                <div data-slot="context-tool-group-item">
                  <div data-component="tool-trigger">
                    <div data-slot="basic-tool-tool-trigger-content">
                      <div data-slot="basic-tool-tool-info">
                        <div data-slot="basic-tool-tool-info-structured">
                          <div data-slot="basic-tool-tool-info-main">
                            <span data-slot="basic-tool-tool-title">
                              <TextShimmer text={trigger().title} active={running()} />
                            </span>
                            <Show when={!running() && trigger().subtitle}>
                              <span data-slot="basic-tool-tool-subtitle">{trigger().subtitle}</span>
                            </Show>
                            <Show when={!running() && trigger().args?.length}>
                              <For each={trigger().args}>
                                {(arg) => <span data-slot="basic-tool-tool-arg">{arg}</span>}
                              </For>
                            </Show>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            }}
          </Index>
        </div>
      </Collapsible.Content>
    </Collapsible>
  )
}

export function UserMessageDisplay(props: { message: UserMessage; parts: PartType[]; actions?: UserActions }) {
  const data = useData()
  const dialog = useDialog()
  const i18n = useI18n()
  const [state, setState] = createStore({
    copied: false,
    busy: undefined as "fork" | "revert" | undefined,
  })
  const copied = () => state.copied
  const busy = () => state.busy

  const textPart = createMemo(
    () => props.parts?.find((p) => p.type === "text" && !(p as TextPart).synthetic) as TextPart | undefined,
  )

  const command = createMemo(() => textPart()?.metadata?.command as string | undefined)

  const text = createMemo(() => {
    if (command()) return (textPart()?.metadata?.arguments as string | undefined) || ""
    return textPart()?.text || ""
  })

  const files = createMemo(() => (props.parts?.filter((p) => p.type === "file") as FilePart[]) ?? [])

  const attachments = createMemo(() => files().filter(attached))

  const inlineFiles = createMemo(() => files().filter(inline))

  const agents = createMemo(() => (props.parts?.filter((p) => p.type === "agent") as AgentPart[]) ?? [])

  const model = createMemo(() => {
    const providerID = props.message.model?.providerID
    const modelID = props.message.model?.modelID
    if (!providerID || !modelID) return ""
    const match = data.store.provider?.all?.find((p) => p.id === providerID)
    return match?.models?.[modelID]?.name ?? modelID
  })
  const timefmt = createMemo(() => new Intl.DateTimeFormat(i18n.locale(), { timeStyle: "short" }))

  const stamp = createMemo(() => {
    const created = props.message.time?.created
    if (typeof created !== "number") return ""
    return timefmt().format(created)
  })

  const metaHead = createMemo(() => {
    const agent = props.message.agent
    const items = [agent ? agent[0]?.toUpperCase() + agent.slice(1) : "", model()]
    return items.filter((x) => !!x).join("\u00A0\u00B7\u00A0")
  })

  const metaTail = stamp

  const openImagePreview = (url: string, alt?: string) => {
    dialog.show(() => <ImagePreview src={url} alt={alt} />)
  }

  const handleCopy = async () => {
    const content = text()
    if (!content) return
    await navigator.clipboard.writeText(content)
    setState("copied", true)
    setTimeout(() => setState("copied", false), 2000)
  }

  const run = (kind: "fork" | "revert") => {
    const act = kind === "fork" ? props.actions?.fork : props.actions?.revert
    if (!act || busy()) return
    setState("busy", kind)
    void Promise.resolve()
      .then(() =>
        act({
          sessionID: props.message.sessionID,
          messageID: props.message.id,
        }),
      )
      .finally(() => {
        if (busy() === kind) setState("busy", undefined)
      })
  }

  return (
    <div data-component="user-message">
      <Show when={attachments().length > 0}>
        <div data-slot="user-message-attachments">
          <For each={attachments()}>
            {(file) => {
              const type = kind(file)
              const name = file.filename ?? i18n.t("ui.message.attachment.alt")

              return (
                <button
                  type="button"
                  data-slot="user-message-attachment"
                  data-type={type}
                  data-clickable={type === "image" ? "true" : undefined}
                  title={type === "file" ? name : undefined}
                  onClick={() => {
                    if (type === "image") openImagePreview(file.url, name)
                  }}
                >
                  <Show
                    when={type === "image"}
                    fallback={
                      <div data-slot="user-message-attachment-file">
                        <FileIcon node={{ path: name, type: "file" }} />
                        <span data-slot="user-message-attachment-name">{name}</span>
                      </div>
                    }
                  >
                    <img data-slot="user-message-attachment-image" src={file.url} alt={name} />
                  </Show>
                </button>
              )
            }}
          </For>
        </div>
      </Show>
      <Show when={text() || command()}>
        <div data-slot="user-message-body">
          <div data-slot="user-message-text">
            <Show when={command()}>
              <span class="font-medium text-text-strong">/{command()}</span>
              <Show when={text()}> </Show>
            </Show>
            <Show when={text()}>
              <HighlightedText text={text()} references={inlineFiles()} agents={agents()} />
            </Show>
          </div>
        </div>
        <div data-slot="user-message-copy-wrapper">
          <Show when={metaHead() || metaTail()}>
            <span data-slot="user-message-meta-wrap">
              <Show when={metaHead()}>
                <span data-slot="user-message-meta" class="text-12-regular text-text-weak cursor-default">
                  {metaHead()}
                </span>
              </Show>
              <Show when={metaHead() && metaTail()}>
                <span data-slot="user-message-meta-sep" class="text-12-regular text-text-weak cursor-default">
                  {"\u00A0\u00B7\u00A0"}
                </span>
              </Show>
              <Show when={metaTail()}>
                <span data-slot="user-message-meta-tail" class="text-12-regular text-text-weak cursor-default">
                  {metaTail()}
                </span>
              </Show>
            </span>
          </Show>
          <Show when={props.actions?.fork}>
            <Tooltip value={i18n.t("ui.message.forkMessage")} placement="top" gutter={4}>
              <IconButton
                icon="fork"
                size="normal"
                variant="ghost"
                disabled={!!busy()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation()
                  run("fork")
                }}
                aria-label={i18n.t("ui.message.forkMessage")}
              />
            </Tooltip>
          </Show>
          <Show when={props.actions?.revert}>
            <Tooltip value={i18n.t("ui.message.revertMessage")} placement="top" gutter={4}>
              <IconButton
                icon="reset"
                size="normal"
                variant="ghost"
                disabled={!!busy()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation()
                  run("revert")
                }}
                aria-label={i18n.t("ui.message.revertMessage")}
              />
            </Tooltip>
          </Show>
          <Tooltip
            value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
            placement="top"
            gutter={4}
          >
            <IconButton
              icon={copied() ? "check" : "copy"}
              size="normal"
              variant="ghost"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(event) => {
                event.stopPropagation()
                handleCopy()
              }}
              aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
            />
          </Tooltip>
        </div>
      </Show>
    </div>
  )
}

type HighlightSegment = { text: string; type?: "file" | "agent" }

function HighlightedText(props: { text: string; references: FilePart[]; agents: AgentPart[] }) {
  const segments = createMemo(() => {
    const text = props.text

    const allRefs: { start: number; end: number; type: "file" | "agent" }[] = [
      ...props.references
        .filter((r) => r.source?.text?.start !== undefined && r.source?.text?.end !== undefined)
        .map((r) => ({
          start: r.source?.text?.start ?? 0,
          end: r.source?.text?.end ?? 0,
          type: "file" as const,
        })),
      ...props.agents
        .filter((a) => a.source?.start !== undefined && a.source?.end !== undefined)
        .map((a) => ({
          start: a.source?.start ?? 0,
          end: a.source?.end ?? 0,
          type: "agent" as const,
        })),
    ].sort((a, b) => a.start - b.start)

    const result: HighlightSegment[] = []
    let lastIndex = 0

    for (const ref of allRefs) {
      if (ref.start < lastIndex) continue

      if (ref.start > lastIndex) {
        result.push({ text: text.slice(lastIndex, ref.start) })
      }

      result.push({ text: text.slice(ref.start, ref.end), type: ref.type })
      lastIndex = ref.end
    }

    if (lastIndex < text.length) {
      result.push({ text: text.slice(lastIndex) })
    }

    return result
  })

  return <For each={segments()}>{(segment) => <span data-highlight={segment.type}>{segment.text}</span>}</For>
}

export function Part(props: MessagePartProps) {
  const component = createMemo(() => PART_MAPPING[props.part.type])
  return (
    <Show when={component()}>
      <Dynamic
        component={component()}
        part={props.part}
        message={props.message}
        hideDetails={props.hideDetails}
        defaultOpen={props.defaultOpen}
        showAssistantCopyPartID={props.showAssistantCopyPartID}
        turnDurationMs={props.turnDurationMs}
      />
    </Show>
  )
}

import "./message-tools"
