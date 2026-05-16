import { Box, type Color, Text } from "@liteai/ink"
import { Locale } from "@liteai/util/locale"
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { useKeybindings } from "../keybindings/use-keybinding"
import type { SelectItem } from "../primitives/types"
import { selectSessions, useAppState } from "../state"
import { SessionTabStore } from "../state/session-tab-store"
import { SelectPane } from "../ui/select-pane"
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

export function DialogSessionList(props: { localOnly?: boolean; workspaceID?: string; onClose?: () => void }) {
  const route = useRoute()
  const sessionsList = useAppState(selectSessions())
  const sessionStatusMap = useAppState((s) => s.session_status)
  const { theme } = useTheme()
  const sdk = useSDK()
  const toast = useToast()

  const [showArchived, setShowArchived] = useState(false)
  const { tabs } = useSyncExternalStore(SessionTabStore.subscribe, SessionTabStore.getSnapshot)

  const [toDelete, setToDelete] = useState<string | undefined>()
  const [search, setSearch] = useState("")
  const [activeTag, setActiveTag] = useState<string | undefined>()
  const [tags, setTags] = useState<string[]>([])
  const [selectedOption, setSelectedOption] = useState<SelectItem<string> | undefined>()
  const debouncedSearch = useDebounce(search, 150)

  type ViewState =
    | { type: "list" }
    | { type: "rename"; sessionID: string }
    | { type: "tag"; sessionID: string; existingTags: string[]; allTags: string[] }

  const [view, setView] = useState<ViewState>({ type: "list" })

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
    const list = searchResults ?? sessionsList
    let filtered = list
    if (props.localOnly) {
      filtered = filtered.filter((x) => !x.workspaceID && !x.parentID)
    }
    if (props.workspaceID) {
      filtered = filtered.filter((x) => x.workspaceID === props.workspaceID)
    }
    return filtered.filter((x) => (showArchived ? !!x.time.archived : !x.time.archived))
  }, [searchResults, sessionsList, props.localOnly, props.workspaceID, showArchived])

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
        const status = sessionStatusMap?.[x.id]
        const isWorking = status?.type === "busy"
        const sessionExt = x as import("@liteai/sdk").Session & { tags?: string[]; description?: string }
        const hasParent = !!x.parentID
        const isArchived = !!x.time.archived
        return {
          key: x.id,
          label: isDeleting ? `Press ctrl+d again to confirm` : isArchived ? `📦 ${x.title}` : x.title,
          description:
            (sessionExt.tags?.length ? `${sessionExt.tags.map((t: string) => `#${t}`).join(" ")} ` : "") +
            (sessionExt.description ?? ""),
          value: x.id,
          category,
          footer: isArchived ? <Text dim>{Locale.time(x.time.updated)}</Text> : Locale.time(x.time.updated),
          gutter: isWorking ? (
            <Spinner />
          ) : tabs.includes(x.id) ? (
            <Text color={theme.primary as Color}>[{tabs.indexOf(x.id) + 1}]</Text>
          ) : isArchived ? (
            <Text dim>📦</Text>
          ) : hasParent ? (
            <Text color={theme.info as Color}>⑂</Text>
          ) : undefined,
        }
      })

    if (ftsResults && ftsResults.length > 0) {
      const ftsOptions = ftsResults.map((r) => {
        const session = sessionsList.find((s) => s.id === r.sessionID)
        return {
          key: `fts:${r.sessionID}`,
          label: session?.title ?? "Unknown Session",
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
  }, [sessions, toDelete, sessionStatusMap, ftsResults, sessionsList, tabs])

  useKeybindings(
    {
      "tabs:next": () => {
        // Tab cycles through tag filters (local scope — not global tab switching)
        const t = ["", ...tags]
        const currentIdx = t.indexOf(activeTag ?? "")
        const nextIdx = (currentIdx + 1) % t.length
        setActiveTag(t[nextIdx] || undefined)
      },
      "select:delete": () => {
        if (!selectedOption) return
        if (toDelete === selectedOption.value) {
          void (async () => {
            try {
              await sdk.client.project.session.delete({
                projectID: sdk.projectID,
                sessionID: selectedOption.value,
              })
              setToDelete(undefined)
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              console.error("[dialog-session-list] Failed to delete session:", err)
              toast.show({ variant: "error", message: `Failed to delete session: ${message}` })
              // Keep toDelete set so the user can retry
            }
          })()
          return
        }
        setToDelete(selectedOption.value)
      },
      "select:rename": () => {
        if (!selectedOption) return
        setView({ type: "rename", sessionID: selectedOption.value })
      },
      "select:tag": () => {
        if (!selectedOption) return
        const session = sessionsList.find((s) => s.id === selectedOption.value)
        if (!session) return
        const sessionExt = session as import("@liteai/sdk").Session & { tags?: string[] }
        setView({
          type: "tag",
          sessionID: selectedOption.value,
          existingTags: sessionExt.tags || [],
          allTags: tags,
        })
      },
      "select:archive": () => {
        setShowArchived((v) => !v)
      },
      "select:toggleArchive": () => {
        if (!selectedOption) return
        const session = sessionsList.find((s) => s.id === selectedOption.value)
        if (!session) return
        const isNowArchived = !session.time.archived
        void (async () => {
          try {
            await sdk.client.project.session.update({
              sessionID: selectedOption.value,
              projectID: sdk.projectID,
              time: { archived: isNowArchived ? Date.now() : 0 },
            })
            toast.show({
              variant: "success",
              message: isNowArchived ? "Session archived" : "Session restored from archive",
            })
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            toast.show({ variant: "error", message: `Failed to update session: ${message}` })
          }
        })()
      },
    },
    { context: "Select" },
  )

  if (view.type === "rename") {
    return <DialogSessionRename session={view.sessionID} onClose={() => setView({ type: "list" })} />
  }

  if (view.type === "tag") {
    return (
      <DialogTag
        sessionID={view.sessionID}
        existingTags={view.existingTags}
        allTags={view.allTags}
        onClose={() => setView({ type: "list" })}
      />
    )
  }

  return (
    <SelectPane
      title={`Sessions (${sessions.length})`}
      items={options}
      skipFilter={true}
      current={currentSessionID}
      onFilter={setSearch}
      onHighlight={(item) => {
        setToDelete(undefined)
        setSelectedOption(item)
      }}
      onSelect={(item) => {
        route.navigate({
          type: "session",
          sessionID: item.value,
        })
        props.onClose?.()
      }}
      onClose={props.onClose}
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
      headerEnd={showArchived ? <Text dim>📦 Archived</Text> : undefined}
      footerContent={
        <Text color={theme.textMuted as Color}>
          ↑↓ navigate · Enter select · ctrl+d del · ctrl+r rename · ctrl+a archived view · ctrl+u toggle archive ·
          ctrl+t tag · tab filter
        </Text>
      }
    />
  )
}
