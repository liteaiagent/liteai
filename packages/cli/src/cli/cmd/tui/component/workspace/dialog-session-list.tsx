import { Locale } from "@liteai/core/util/locale"
import { DialogSessionRename } from "@tui/component/dialog-session-rename"
import { Spinner } from "@tui/component/spinner"
import { useKeybind } from "@tui/context/keybind"
import { useKV } from "@tui/context/kv"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { createMemo, createResource, createSignal, onMount } from "solid-js"
import { createDebouncedSignal } from "../../util/signal"

export function DialogSessionList(props: { workspaceID?: string; localOnly?: boolean } = {}) {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const sdk = useSDK()
  const _kv = useKV()
  const toast = useToast()
  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)

  const [listed, listedActions] = createResource(
    () => props.workspaceID,
    async (workspaceID) => {
      if (!workspaceID) return undefined
      const result = await sdk.client.project.session.list({ projectID: sdk.projectID, roots: true })
      return result.data ?? []
    },
  )

  const [searchResults] = createResource(search, async (query) => {
    if (!query || props.localOnly) return undefined
    const result = await sdk.client.project.session.list({
      projectID: sdk.projectID,
      search: query,
      limit: 30,
      ...(props.workspaceID ? { roots: true } : {}),
    })
    return result.data ?? []
  })

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const sessions = createMemo(() => {
    const found = searchResults()
    if (found) return found
    if (props.workspaceID) return listed() ?? []
    if (props.localOnly) return sync.data.session.filter((session) => !session.workspaceID)
    return sync.data.session
  })

  const options = createMemo(() => {
    const today = new Date().toDateString()
    return (
      sessions()
        // biome-ignore lint/suspicious/noExplicitAny: sync type mismatch
        .filter((x: any) => {
          if (x.parentID !== undefined) return false
          if (props.workspaceID && listed()) return true
          if (props.workspaceID) return x.workspaceID === props.workspaceID
          if (props.localOnly) return !x.workspaceID
          return true
        })
        // biome-ignore lint/suspicious/noExplicitAny: sync type mismatch
        .toSorted((a: any, b: any) => b.time.updated - a.time.updated)
        // biome-ignore lint/suspicious/noExplicitAny: sync type mismatch
        .map((x: any) => {
          const date = new Date(x.time.updated)
          let category = date.toDateString()
          if (category === today) {
            category = "Today"
          }
          const isDeleting = toDelete() === x.id
          const status = sync.data.session_status?.[x.id]
          const isWorking = status?.type === "busy"
          return {
            title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : x.title,
            bg: isDeleting ? theme.error : undefined,
            value: x.id,
            category,
            footer: Locale.time(x.time.updated),
            gutter: isWorking ? <Spinner /> : undefined,
          }
        })
    )
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title={props.workspaceID ? `Workspace Sessions` : props.localOnly ? "Local Sessions" : "Sessions"}
      options={options()}
      skipFilter={!props.localOnly}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              const deleted = await sdk.client.project.session
                .delete({
                  projectID: sdk.projectID,
                  sessionID: option.value,
                })
                .then(() => true)
                .catch(() => false)
              setToDelete(undefined)
              if (!deleted) {
                toast.show({
                  message: "Failed to delete session",
                  variant: "error",
                })
                return
              }
              if (props.workspaceID) {
                // biome-ignore lint/suspicious/noExplicitAny: sync type mismatch
                listedActions.mutate((sessions: any) =>
                  // biome-ignore lint/suspicious/noExplicitAny: sync type mismatch
                  sessions?.filter((session: any) => session.id !== option.value),
                )
                return
              }
              sync.set(
                "session",
                // biome-ignore lint/suspicious/noExplicitAny: sync type mismatch
                sync.data.session.filter((session: any) => session.id !== option.value),
              )
              return
            }
            setToDelete(option.value)
          },
        },
        {
          keybind: keybind.all.session_rename?.[0],
          title: "rename",
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
      ]}
    />
  )
}
