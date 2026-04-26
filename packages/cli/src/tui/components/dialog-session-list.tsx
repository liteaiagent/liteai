import { Locale } from "@liteai/util/locale"
import { useEffect, useMemo, useState } from "react"
import { useDialog } from "../context/dialog"
import { useKeybind } from "../context/keybind"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { DialogSelect } from "../ui/dialog-select"
import { Spinner } from "../ui/spinner"
import { DialogSessionRename } from "./dialog-session-rename"

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)
    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])
  return debouncedValue
}

export function DialogSessionList(props: { localOnly?: boolean; workspaceID?: string }) {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const sdk = useSDK()

  const [toDelete, setToDelete] = useState<string | undefined>()
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounce(search, 150)

  const [searchResults, setSearchResults] = useState<import("@liteai/sdk").Session[] | undefined>()

  useEffect(() => {
    if (!debouncedSearch) {
      setSearchResults(undefined)
      return
    }
    let active = true
    sdk.client.project.session
      .list({ projectID: sdk.projectID, search: debouncedSearch, limit: 30 })
      .then((result) => {
        if (active) setSearchResults(result.data ?? [])
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [debouncedSearch, sdk])

  const currentSessionID = useMemo(
    () => (route.data.type === "session" ? route.data.sessionID : undefined),
    [route.data],
  )

  const sessions = useMemo(() => {
    const list = searchResults ?? sync.sessions
    if (props.localOnly) {
      return list.filter((x) => !x.workspaceID && !x.parentID)
    }
    if (props.workspaceID) {
      return list.filter((x) => x.workspaceID === props.workspaceID)
    }
    return list
  }, [searchResults, sync.sessions, props.localOnly, props.workspaceID])

  const options = useMemo(() => {
    const today = new Date().toDateString()
    return sessions
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((x) => {
        const date = new Date(x.time.updated)
        let category = date.toDateString()
        if (category === today) {
          category = "Today"
        }
        const isDeleting = toDelete === x.id
        const status = sync.session_status?.[x.id]
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
  }, [sessions, toDelete, sync.session_status, keybind, theme.error])

  useEffect(() => {
    dialog.setSize("large")
  }, [dialog])

  return (
    <DialogSelect
      title="Sessions"
      options={options}
      skipFilter={true}
      current={currentSessionID}
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
            if (toDelete === option.value) {
              sdk.client.project.session.delete({
                projectID: sdk.projectID,
                sessionID: option.value,
              })
              setToDelete(undefined)
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
