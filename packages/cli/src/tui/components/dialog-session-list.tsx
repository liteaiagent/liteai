import { Box, type Color, Text } from "@liteai/ink"
import { Locale } from "@liteai/util/locale"
import { useEffect, useMemo, useState } from "react"
import { useDialog } from "../context/dialog"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useKeybindings } from "../keybindings/use-keybinding"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { Spinner } from "../ui/spinner"
import { DialogSessionRename } from "./dialog-session-rename"
import { DialogTag } from "./dialog-tag"

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
  const { theme } = useTheme()
  const sdk = useSDK()

  const [toDelete, setToDelete] = useState<string | undefined>()
  const [search, setSearch] = useState("")
  const [activeTag, setActiveTag] = useState<string | undefined>()
  const [tags, setTags] = useState<string[]>([])
  const [selectedOption, setSelectedOption] = useState<DialogSelectOption<string> | undefined>()
  const debouncedSearch = useDebounce(search, 150)

  useEffect(() => {
    sdk.client.project.session.tags({ projectID: sdk.projectID }).then((res) => {
      if (res.data) setTags(res.data)
    })
  }, [sdk])

  const [searchResults, setSearchResults] = useState<import("@liteai/sdk").Session[] | undefined>()
  const [ftsResults, setFtsResults] = useState<
    Array<{ sessionID: string; snippet: string; [key: string]: unknown }> | undefined
  >()

  useEffect(() => {
    if (!debouncedSearch) {
      setSearchResults(undefined)
      setFtsResults(undefined)
      return
    }
    let active = true
    sdk.client.project.session
      .list({ projectID: sdk.projectID, search: debouncedSearch, limit: 30, tag: activeTag })
      .then((result) => {
        if (active) setSearchResults(result.data ?? [])
      })
      .catch(() => {})

    sdk
      .fetch(`${sdk.url}/session/search?q=${encodeURIComponent(debouncedSearch)}`)
      .then((r) => r.json())
      .then((data) => {
        if (active && Array.isArray(data)) setFtsResults(data)
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          // FTS search is best-effort; log but don't block title-based filtering
          console.warn("[dialog-session-list] FTS search failed:", err.message)
        }
      })

    return () => {
      active = false
    }
  }, [debouncedSearch, activeTag, sdk])

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
    const opts = sessions
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
        const sessionExt = x as import("@liteai/sdk").Session & { tags?: string[]; description?: string }
        const hasParent = !!x.parentID
        return {
          title: isDeleting ? `Press ctrl+d again to confirm` : x.title,
          description:
            (sessionExt.tags?.length ? `${sessionExt.tags.map((t: string) => `#${t}`).join(" ")} ` : "") +
            (sessionExt.description ?? ""),
          bg: isDeleting ? theme.error : undefined,
          value: x.id,
          category,
          footer: Locale.time(x.time.updated),
          gutter: isWorking ? <Spinner /> : hasParent ? <Text color={theme.info as Color}>⑂</Text> : undefined,
        }
      })

    if (ftsResults && ftsResults.length > 0) {
      const ftsOptions = ftsResults.map((r) => {
        const session = sync.sessions.find((s) => s.id === r.sessionID)
        return {
          title: session?.title ?? "Unknown Session",
          description: r.snippet.replace(/<mark>/g, "").replace(/<\/mark>/g, ""),
          value: r.sessionID,
          category: "Message Matches",
        }
      })
      // Dedup by session ID so we only show one match per session
      const seen = new Set()
      const dedupedFts = ftsOptions.filter((o) => {
        if (seen.has(o.value)) return false
        seen.add(o.value)
        return true
      })
      return [...opts, ...dedupedFts]
    }

    return opts
  }, [sessions, toDelete, sync.session_status, theme.error, ftsResults, sync.sessions])

  useKeybindings(
    {
      "select:delete": () => {
        if (!selectedOption) return
        if (toDelete === selectedOption.value) {
          sdk.client.project.session.delete({
            projectID: sdk.projectID,
            sessionID: selectedOption.value,
          })
          setToDelete(undefined)
          return
        }
        setToDelete(selectedOption.value)
      },
      "select:rename": () => {
        if (!selectedOption) return
        dialog.replace(() => <DialogSessionRename session={selectedOption.value} />)
      },
      "select:update": () => {
        if (!selectedOption) return
        const session = sessions.find((s) => s.id === selectedOption.value)
        if (!session) return
        void sdk.client.project.session.update({
          sessionID: selectedOption.value,
          projectID: sdk.projectID,
          time: { archived: session.time.archived ? 0 : Date.now() },
        })
      },
      "select:tag": () => {
        if (!selectedOption) return
        const session = sessions.find((s) => s.id === selectedOption.value)
        if (!session) return
        const sessionExt = session as import("@liteai/sdk").Session & { tags?: string[] }
        const existingTags = sessionExt.tags || []
        dialog.replace(() => <DialogTag sessionID={selectedOption.value} existingTags={existingTags} allTags={tags} />)
      },
      "select:nextTag": () => {
        const t = ["", ...tags]
        const currentIdx = t.indexOf(activeTag ?? "")
        const nextIdx = (currentIdx + 1) % t.length
        setActiveTag(t[nextIdx] || undefined)
      },
    },
    { context: "Select" },
  )

  useEffect(() => {
    dialog.setSize("large")
  }, [dialog])

  return (
    <DialogSelect
      title={`Sessions (${sessions.length})`}
      options={options}
      skipFilter={true}
      current={currentSessionID}
      onFilter={setSearch}
      onMove={(option) => {
        setToDelete(undefined)
        setSelectedOption(option)
      }}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      header={
        tags.length > 0 ? (
          <Box flexDirection="row" gap={1}>
            <Text color={!activeTag ? (theme.primary as Color) : (theme.textMuted as Color)}>All</Text>
            {tags.map((tag) => (
              <Text key={tag} color={activeTag === tag ? (theme.primary as Color) : (theme.textMuted as Color)}>
                #{tag}
              </Text>
            ))}
          </Box>
        ) : undefined
      }
      footerContent={
        <Text color={theme.textMuted as Color}>
          ↑↓ navigate · Enter select · ctrl+d del · ctrl+r rename · ctrl+a archive · ctrl+t tag · tab filter
        </Text>
      }
    />
  )
}
