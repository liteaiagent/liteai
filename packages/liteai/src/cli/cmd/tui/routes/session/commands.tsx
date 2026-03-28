import path from "node:path"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useCommandDialog } from "@tui/component/dialog-command"
import type { PromptRef } from "@tui/component/prompt"
import { useLocal } from "@tui/context/local"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import type { DialogContext } from "@tui/ui/dialog"
import type { Accessor, Setter } from "solid-js"
import { batch } from "solid-js"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import type { PromptInfo } from "../../component/prompt/history"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { useToast } from "../../ui/toast"
import { Clipboard } from "../../util/clipboard"
import { Editor } from "../../util/editor"
import { formatTranscript } from "../../util/transcript"
import { DialogForkFromTimeline } from "./dialog-fork-from-timeline"
import { DialogTimeline } from "./dialog-timeline"

type SessionData = ReturnType<ReturnType<typeof useSync>["session"]["get"]>
type MessageData = NonNullable<ReturnType<typeof useSync>["data"]["message"][string]>

// kv.signal returns (next: Setter<T>) => void, not Setter<T> itself
type KVSetter<T> = (next: Setter<T>) => void

export type CommandDeps = {
  session: Accessor<SessionData>
  messages: Accessor<MessageData>
  children: Accessor<{ id: string; parentID?: string }[]>
  sidebarVisible: Accessor<boolean>
  conceal: Accessor<boolean>
  showThinking: Accessor<boolean>
  showTimestamps: Accessor<boolean>
  showDetails: Accessor<boolean>
  showAssistantMetadata: Accessor<boolean>
  showScrollbar: Accessor<boolean>
  showHeader: Accessor<boolean>
  showGenericToolOutput: Accessor<boolean>
  setSidebar: KVSetter<"auto" | "hide">
  setSidebarOpen: Setter<boolean>
  setConceal: Setter<boolean>
  setShowThinking: KVSetter<boolean>
  setTimestamps: KVSetter<"hide" | "show">
  setShowDetails: KVSetter<boolean>
  setShowScrollbar: KVSetter<boolean>
  setShowHeader: KVSetter<boolean>
  setShowGenericToolOutput: KVSetter<boolean>
  scroll: () => ScrollBoxRenderable
  prompt: () => PromptRef
  toBottom: () => void
}

export function useCommands(deps: CommandDeps) {
  const command = useCommandDialog()
  const sdk = useSDK()
  const toast = useToast()
  const sync = useSync()
  const renderer = useRenderer()
  const local = useLocal()
  const route = useRouteData("session")
  const { navigate } = useRoute()

  const findNext = (direction: "next" | "prev"): string | null => {
    const scroll = deps.scroll()
    const children = scroll.getChildren()
    const list = deps.messages()
    const top = scroll.y

    const visible = children
      .filter((c) => {
        if (!c.id) return false
        const message = list.find((m) => m.id === c.id)
        if (!message) return false
        const parts = sync.data.part[message.id]
        if (!parts || !Array.isArray(parts)) return false
        return parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)
      })
      .sort((a, b) => a.y - b.y)

    if (visible.length === 0) return null

    if (direction === "next") {
      return visible.find((c) => c.y > top + 10)?.id ?? null
    }
    return [...visible].reverse().find((c) => c.y < top - 10)?.id ?? null
  }

  const scrollToMsg = (direction: "next" | "prev", dialog: DialogContext) => {
    const scroll = deps.scroll()
    const id = findNext(direction)
    if (!id) {
      scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
      dialog.clear()
      return
    }
    const child = scroll.getChildren().find((c) => c.id === id)
    if (child) scroll.scrollBy(child.y - scroll.y - 1)
    dialog.clear()
  }

  function moveFirst() {
    if (deps.children().length === 1) return
    const next = deps.children().find((x) => !!x.parentID)
    if (next) navigate({ type: "session", sessionID: next.id })
  }

  function moveChild(direction: number) {
    if (deps.children().length === 1) return
    const sessions = deps.children().filter((x) => !!x.parentID)
    let next = sessions.findIndex((x) => x.id === deps.session()?.id) + direction
    if (next >= sessions.length) next = 0
    if (next < 0) next = sessions.length - 1
    if (sessions[next]) navigate({ type: "session", sessionID: sessions[next].id })
  }

  function guard(func: (dialog: DialogContext) => void) {
    return (dialog: DialogContext) => {
      if (!deps.session()?.parentID || dialog.stack.length > 0) return
      func(dialog)
    }
  }

  command.register(() => [
    {
      title: deps.session()?.share?.url ? "Copy share link" : "Share session",
      value: "session.share",
      suggested: route.type === "session",
      keybind: "session_share",
      category: "Session",
      enabled: sync.data.config.share !== "disabled",
      slash: { name: "share" },
      onSelect: async (dialog: DialogContext) => {
        const copy = (url: string) =>
          Clipboard.copy(url)
            .then(() => toast.show({ message: "Share URL copied to clipboard!", variant: "success" }))
            .catch(() => toast.show({ message: "Failed to copy URL to clipboard", variant: "error" }))
        const url = deps.session()?.share?.url
        if (url) {
          await copy(url)
          dialog.clear()
          return
        }
        await sdk.client.project.session
          .share({ projectID: sdk.projectID, sessionID: route.sessionID })
          .then((res) => {
            if (res.data?.share?.url) return copy(res.data.share.url)
          })
          .catch((error) => {
            toast.show({
              message: error instanceof Error ? error.message : "Failed to share session",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
    {
      title: "Rename session",
      value: "session.rename",
      keybind: "session_rename",
      category: "Session",
      slash: { name: "rename" },
      onSelect: (dialog: DialogContext) => {
        dialog.replace(() => <DialogSessionRename session={route.sessionID} />)
      },
    },
    {
      title: "Jump to message",
      value: "session.timeline",
      keybind: "session_timeline",
      category: "Session",
      slash: { name: "timeline" },
      onSelect: (dialog: DialogContext) => {
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              const scroll = deps.scroll()
              const child = scroll.getChildren().find((c) => c.id === messageID)
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
            setPrompt={(info: PromptInfo) => deps.prompt().set(info)}
          />
        ))
      },
    },
    {
      title: "Fork from message",
      value: "session.fork",
      keybind: "session_fork",
      category: "Session",
      slash: { name: "fork" },
      onSelect: (dialog: DialogContext) => {
        dialog.replace(() => (
          <DialogForkFromTimeline
            onMove={(messageID) => {
              const scroll = deps.scroll()
              const child = scroll.getChildren().find((c) => c.id === messageID)
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
          />
        ))
      },
    },
    {
      title: "Compact session",
      value: "session.compact",
      keybind: "session_compact",
      category: "Session",
      slash: { name: "compact", aliases: ["summarize"] },
      onSelect: (dialog: DialogContext) => {
        const selected = local.model.current()
        if (!selected) {
          toast.show({ variant: "warning", message: "Connect a provider to summarize this session", duration: 3000 })
          return
        }
        sdk.client.project.session.summarize({
          projectID: sdk.projectID,
          sessionID: route.sessionID,
          modelID: selected.modelID,
          providerID: selected.providerID,
        })
        dialog.clear()
      },
    },
    {
      title: "Unshare session",
      value: "session.unshare",
      keybind: "session_unshare",
      category: "Session",
      enabled: !!deps.session()?.share?.url,
      slash: { name: "unshare" },
      onSelect: async (dialog: DialogContext) => {
        await sdk.client.project.session
          .unshare({ projectID: sdk.projectID, sessionID: route.sessionID })
          .then(() => toast.show({ message: "Session unshared successfully", variant: "success" }))
          .catch((error) => {
            toast.show({
              message: error instanceof Error ? error.message : "Failed to unshare session",
              variant: "error",
            })
          })
        dialog.clear()
      },
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      keybind: "messages_undo",
      category: "Session",
      slash: { name: "undo" },
      onSelect: async (dialog: DialogContext) => {
        const status = sync.data.session_status?.[route.sessionID]
        if (status?.type !== "idle") await sdk.client.project.session.abort({ projectID: sdk.projectID, sessionID: route.sessionID }).catch(() => {})
        const revert = deps.session()?.revert?.messageID
        const message = deps.messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
        if (!message) return
        sdk.client.project.session.revert({ projectID: sdk.projectID, sessionID: route.sessionID, messageID: message.id }).then(() => deps.toBottom())
        const parts = sync.data.part[message.id]
        deps.prompt().set(
          parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += part.text
              }
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          ),
        )
        dialog.clear()
      },
    },
    {
      title: "Redo",
      value: "session.redo",
      keybind: "messages_redo",
      category: "Session",
      enabled: !!deps.session()?.revert?.messageID,
      slash: { name: "redo" },
      onSelect: (dialog: DialogContext) => {
        dialog.clear()
        const messageID = deps.session()?.revert?.messageID
        if (!messageID) return
        const message = deps.messages().find((x) => x.role === "user" && x.id > messageID)
        if (!message) {
          sdk.client.project.session.unrevert({ projectID: sdk.projectID, sessionID: route.sessionID })
          deps.prompt().set({ input: "", parts: [] })
          return
        }
        sdk.client.project.session.revert({ projectID: sdk.projectID, sessionID: route.sessionID, messageID: message.id })
      },
    },
    {
      title: deps.sidebarVisible() ? "Hide sidebar" : "Show sidebar",
      value: "session.sidebar.toggle",
      keybind: "sidebar_toggle",
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        batch(() => {
          const visible = deps.sidebarVisible()
          deps.setSidebar(() => (visible ? "hide" : "auto"))
          deps.setSidebarOpen(!visible)
        })
        dialog.clear()
      },
    },
    {
      title: deps.conceal() ? "Disable code concealment" : "Enable code concealment",
      value: "session.toggle.conceal",
      keybind: "messages_toggle_conceal" as string,
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        deps.setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: deps.showTimestamps() ? "Hide timestamps" : "Show timestamps",
      value: "session.toggle.timestamps",
      category: "Session",
      slash: { name: "timestamps", aliases: ["toggle-timestamps"] },
      onSelect: (dialog: DialogContext) => {
        deps.setTimestamps((prev) => (prev === "show" ? "hide" : "show"))
        dialog.clear()
      },
    },
    {
      title: deps.showThinking() ? "Hide thinking" : "Show thinking",
      value: "session.toggle.thinking",
      keybind: "display_thinking",
      category: "Session",
      slash: { name: "thinking", aliases: ["toggle-thinking"] },
      onSelect: (dialog: DialogContext) => {
        deps.setShowThinking((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: deps.showDetails() ? "Hide tool details" : "Show tool details",
      value: "session.toggle.actions",
      keybind: "tool_details",
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        deps.setShowDetails((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Toggle session scrollbar",
      value: "session.toggle.scrollbar",
      keybind: "scrollbar_toggle",
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        deps.setShowScrollbar((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: deps.showHeader() ? "Hide header" : "Show header",
      value: "session.toggle.header",
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        deps.setShowHeader((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: deps.showGenericToolOutput() ? "Hide generic tool output" : "Show generic tool output",
      value: "session.toggle.generic_tool_output",
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        deps.setShowGenericToolOutput((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Page up",
      value: "session.page.up",
      keybind: "messages_page_up",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        deps.scroll().scrollBy(-deps.scroll().height / 2)
        dialog.clear()
      },
    },
    {
      title: "Page down",
      value: "session.page.down",
      keybind: "messages_page_down",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        deps.scroll().scrollBy(deps.scroll().height / 2)
        dialog.clear()
      },
    },
    {
      title: "Line up",
      value: "session.line.up",
      keybind: "messages_line_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog: DialogContext) => {
        deps.scroll().scrollBy(-1)
        dialog.clear()
      },
    },
    {
      title: "Line down",
      value: "session.line.down",
      keybind: "messages_line_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog: DialogContext) => {
        deps.scroll().scrollBy(1)
        dialog.clear()
      },
    },
    {
      title: "Half page up",
      value: "session.half.page.up",
      keybind: "messages_half_page_up",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        deps.scroll().scrollBy(-deps.scroll().height / 4)
        dialog.clear()
      },
    },
    {
      title: "Half page down",
      value: "session.half.page.down",
      keybind: "messages_half_page_down",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        deps.scroll().scrollBy(deps.scroll().height / 4)
        dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      keybind: "messages_first",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        deps.scroll().scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      keybind: "messages_last",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        deps.scroll().scrollTo(deps.scroll().scrollHeight)
        dialog.clear()
      },
    },
    {
      title: "Jump to last user message",
      value: "session.messages_last_user",
      keybind: "messages_last_user",
      category: "Session",
      hidden: true,
      onSelect: () => {
        const list = sync.data.message[route.sessionID]
        if (!list || !list.length) return

        for (let i = list.length - 1; i >= 0; i--) {
          const message = list[i]
          if (!message || message.role !== "user") continue

          const parts = sync.data.part[message.id]
          if (!parts || !Array.isArray(parts)) continue

          const valid = parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)

          if (valid) {
            const scroll = deps.scroll()
            const child = scroll.getChildren().find((c) => c.id === message.id)
            if (child) scroll.scrollBy(child.y - scroll.y - 1)
            break
          }
        }
      },
    },
    {
      title: "Next message",
      value: "session.message.next",
      keybind: "messages_next",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => scrollToMsg("next", dialog),
    },
    {
      title: "Previous message",
      value: "session.message.previous",
      keybind: "messages_previous",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => scrollToMsg("prev", dialog),
    },
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      keybind: "messages_copy",
      category: "Session",
      onSelect: (dialog: DialogContext) => {
        const revertID = deps.session()?.revert?.messageID
        const last = deps.messages().findLast((msg) => msg.role === "assistant" && (!revertID || msg.id < revertID))
        if (!last) {
          toast.show({ message: "No assistant messages found", variant: "error" })
          dialog.clear()
          return
        }

        const parts = sync.data.part[last.id] ?? []
        const texts = parts.filter((part) => part.type === "text")
        if (texts.length === 0) {
          toast.show({ message: "No text parts found in last assistant message", variant: "error" })
          dialog.clear()
          return
        }

        const text = texts
          .map((part) => part.text)
          .join("\n")
          .trim()
        if (!text) {
          toast.show({ message: "No text content found in last assistant message", variant: "error" })
          dialog.clear()
          return
        }

        Clipboard.copy(text)
          .then(() => toast.show({ message: "Message copied to clipboard!", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Copy session transcript",
      value: "session.copy",
      category: "Session",
      slash: { name: "copy" },
      onSelect: async (dialog: DialogContext) => {
        try {
          const data = deps.session()
          if (!data) return
          const list = deps.messages()
          const transcript = formatTranscript(
            data,
            list.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            {
              thinking: deps.showThinking(),
              toolDetails: deps.showDetails(),
              assistantMetadata: deps.showAssistantMetadata(),
            },
          )
          await Clipboard.copy(transcript)
          toast.show({ message: "Session transcript copied to clipboard!", variant: "success" })
        } catch (_error) {
          toast.show({ message: "Failed to copy session transcript", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Export session transcript",
      value: "session.export",
      keybind: "session_export",
      category: "Session",
      slash: { name: "export" },
      onSelect: async (dialog: DialogContext) => {
        try {
          const data = deps.session()
          if (!data) return
          const list = deps.messages()

          const filename = `session-${data.id.slice(0, 8)}.md`

          const options = await DialogExportOptions.show(
            dialog,
            filename,
            deps.showThinking(),
            deps.showDetails(),
            deps.showAssistantMetadata(),
            false,
          )

          if (options === null) return

          const transcript = formatTranscript(
            data,
            list.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            {
              thinking: options.thinking,
              toolDetails: options.toolDetails,
              assistantMetadata: options.assistantMetadata,
            },
          )

          if (options.openWithoutSaving) {
            await Editor.open({ value: transcript, renderer })
          } else {
            const dir = process.cwd()
            const name = options.filename.trim()
            const filepath = path.join(dir, name)

            await Bun.write(filepath, transcript)

            const result = await Editor.open({ value: transcript, renderer })
            if (result !== undefined) {
              await Bun.write(filepath, result)
            }

            toast.show({ message: `Session exported to ${name}`, variant: "success" })
          }
        } catch (_error) {
          toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Go to child session",
      value: "session.child.first",
      keybind: "session_child_first",
      category: "Session",
      hidden: true,
      onSelect: (dialog: DialogContext) => {
        moveFirst()
        dialog.clear()
      },
    },
    {
      title: "Go to parent session",
      value: "session.parent",
      keybind: "session_parent",
      category: "Session",
      hidden: true,
      enabled: !!deps.session()?.parentID,
      onSelect: guard((dialog) => {
        const parentID = deps.session()?.parentID
        if (parentID) navigate({ type: "session", sessionID: parentID })
        dialog.clear()
      }),
    },
    {
      title: "Next child session",
      value: "session.child.next",
      keybind: "session_child_cycle",
      category: "Session",
      hidden: true,
      enabled: !!deps.session()?.parentID,
      onSelect: guard((dialog) => {
        moveChild(1)
        dialog.clear()
      }),
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      keybind: "session_child_cycle_reverse",
      category: "Session",
      hidden: true,
      enabled: !!deps.session()?.parentID,
      onSelect: guard((dialog) => {
        moveChild(-1)
        dialog.clear()
      }),
    },
  ])
}
