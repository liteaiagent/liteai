import { useDialog } from "@liteai/ui/context/dialog"
import { ChatPromptInput } from "@liteai/ui/panes"
import { type Component, createMemo } from "solid-js"
import { DialogManageModels } from "@/components/dialog-manage-models"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { createPromptSubmit, type FollowupDraft } from "@/components/prompt-input/submit"
import { useCommand } from "@/context/command"
import { useComments } from "@/context/comments"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import { type ContextItem, type ImageAttachmentPart, type Prompt, usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

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
  const sdk = useSDK()
  const prompt = usePrompt()
  const local = useLocal()
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
    dialog.show((() => <DialogManageModels model={local.model} />) as never)
  }

  const handleConnectProvider = () => {
    dialog.show((() => <DialogSelectProvider />) as never)
  }

  // Persist session config changes (sessionMode, toolProfile, forkEnabled) via the API
  const handleSessionConfigChange = async (
    sessionID: string,
    config: {
      sessionMode?: "Normal" | "Coordinator" | "Swarm"
      toolProfile?: "Plan" | "Fast"
      forkEnabled?: boolean
    },
  ) => {
    await sdk.client.project.session.update({
      sessionID,
      projectID: sdk.projectID,
      ...config,
    })
  }

  // Workaround since ChatPromptCommands is slightly structurally different than what useCommand() returns in terms of typing,
  // but matches at runtime. We assert its type via any.
  // biome-ignore lint/suspicious/noExplicitAny: Workaround
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
      commentActions={comments as never}
      onOpenComment={props.onOpenComment as never}
      newSessionWorktree={props.newSessionWorktree}
      onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
      edit={props.edit as never}
      onEditLoaded={props.onEditLoaded}
      shouldQueue={props.shouldQueue}
      onQueue={props.onQueue as never}
      onAbort={props.onAbort}
      onSessionConfigChange={handleSessionConfigChange}
    />
  )
}
