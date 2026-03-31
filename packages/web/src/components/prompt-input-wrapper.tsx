import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { DialogSelectModelUnpaid } from "@/components/dialog-select-model-unpaid"
import { createPromptSubmit, type FollowupDraft } from "@/components/prompt-input/submit"
import { useCommand } from "@/context/command"
import { useComments } from "@/context/comments"
import { usePermission } from "@/context/permission"
import { type ContextItem, type ImageAttachmentPart, type Prompt, usePrompt } from "@/context/prompt"
import { useSync } from "@/context/sync"
import { useDialog } from "@liteai/ui/context/dialog"
import { ChatPromptInput } from "@liteai/ui/panes"
import { type Component, createMemo } from "solid-js"

export interface PromptInputWrapperProps {
  class?: string
  ref?: (el: HTMLDivElement) => void
  sessionID?: string
  newSessionWorktree?: string
  onNewSessionWorktreeReset?: () => void
  edit?: { id: string; prompt: Prompt; context: ContextItem[] }
  onEditLoaded?: () => void
  shouldQueue?: () => boolean
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
  searchFiles?: (query: string) => Promise<string[]>
  recentFiles?: () => string[]
  onOpenComment?: (item: { path: string; commentID?: string; commentOrigin?: string }) => void
}

export const PromptInputWrapper: Component<PromptInputWrapperProps> = (props) => {
  const sync = useSync()
  const prompt = usePrompt()
  const permission = usePermission()
  const command = useCommand()
  const comments = useComments()
  const dialog = useDialog()

  const info = createMemo(() => {
    const id = props.sessionID
    return id ? sync.session.get(id) : undefined
  })

  const status = createMemo(() => {
    const id = props.sessionID
    return sync.data.session_status[id ?? ""] ?? { type: "idle" }
  })
  const working = createMemo(() => status()?.type !== "idle")

  const imageAttachments = createMemo(() =>
    prompt.current().filter((part): part is ImageAttachmentPart => part.type === "image"),
  )

  const commentCount = createMemo(() => {
    return prompt.context.items().filter((item) => !!item.comment?.trim()).length
  })

  // The web monolithic submit abstraction
  const submitHandler = createPromptSubmit({
    info,
    imageAttachments,
    commentCount,
    autoAccept: () => permission.isAutoAccepting(props.sessionID ?? ""),
    working,
    newSessionWorktree: () => props.newSessionWorktree,
    onNewSessionWorktreeReset: props.onNewSessionWorktreeReset,
    shouldQueue: props.shouldQueue,
    onQueue: props.onQueue,
    onAbort: props.onAbort,
    onSubmit: props.onSubmit,
  })

  // Manage models flow from the old web PromptInput (using dialogs)
  const handleManageModels = () => {
    dialog.show((() => <DialogSelectModelUnpaid />) as any)
  }

  const handleConnectProvider = () => {
    dialog.show((() => <ModelSelectorPopover />) as any)
  }

  // Workaround since ChatPromptCommands is slightly structurally different than what useCommand() returns in terms of typing, 
  // but matches at runtime. We assert its type via any.
  const commandsAsProps: any = command

  return (
    <ChatPromptInput
      class={props.class}
      ref={props.ref}
      sessionID={props.sessionID}
      handler={{ submit: submitHandler.handleSubmit, abort: submitHandler.abort }}
      onSubmit={props.onSubmit}
      searchFiles={props.searchFiles}
      recentFiles={props.recentFiles}
      onManageModels={handleManageModels}
      onConnectProvider={handleConnectProvider}
      keybind={command.keybind}
      commands={commandsAsProps}
      commentActions={comments as any}
      onOpenComment={props.onOpenComment as any}
      newSessionWorktree={props.newSessionWorktree}
      onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
      edit={props.edit as any}
      onEditLoaded={props.onEditLoaded}
      shouldQueue={props.shouldQueue}
      onQueue={props.onQueue as any}
      onAbort={props.onAbort}
    />
  )
}
