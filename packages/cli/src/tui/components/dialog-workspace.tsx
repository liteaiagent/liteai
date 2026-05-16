import { type Color, Text } from "@liteai/ink"
import { createLiteaiClient, type Session } from "@liteai/sdk"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { useKeybindings } from "../keybindings/use-keybinding"
import type { SelectItem } from "../primitives/types"
import { selectSessions, useAppActions, useAppState } from "../state"
import { SelectPane } from "../ui/select-pane"
import { DialogSessionList } from "./dialog-session-list"

// openWorkspace function port
async function openWorkspace(input: {
  onClose?: () => void
  route: ReturnType<typeof useRoute>
  sdk: ReturnType<typeof useSDK>
  actions: ReturnType<typeof useAppActions>
  toast: ReturnType<typeof useToast>
  workspaceID: string
  forceCreate?: boolean
}) {
  const client = createLiteaiClient({
    baseUrl: input.sdk.url,
    fetch: input.sdk.fetch,
    experimental_workspaceID: input.workspaceID,
  })
  const listed = input.forceCreate
    ? undefined
    : await client.project.session.list({ roots: true, limit: 1, projectID: input.workspaceID }).catch(() => undefined)
  const session = listed?.data?.[0]
  if (session?.id) {
    await input.actions.session.sync(session.id)
    input.route.navigate({
      type: "session",
      sessionID: session.id,
    })
    input.onClose?.()
    return
  }
  let created: Session | undefined
  while (!created) {
    const result = await client.project.session
      .create({ workspaceID: input.workspaceID, projectID: input.workspaceID })
      .catch(() => undefined)
    if (!result) {
      input.toast.show({
        message: "Failed to open workspace",
        variant: "error",
      })
      return
    }
    if (result.response.status >= 500 && result.response.status < 600) {
      await new Promise((r) => setTimeout(r, 1000))
      continue
    }
    if (!result.data) {
      input.toast.show({
        message: "Failed to open workspace",
        variant: "error",
      })
      return
    }
    created = result.data
  }
  await input.actions.session.sync(created.id)
  input.route.navigate({
    type: "session",
    sessionID: created.id,
  })
  input.onClose?.()
}

// DialogWorkspaceCreate component port
export function DialogWorkspaceCreate(props: {
  onSelect: (workspaceID: string) => Promise<void>
  onClose?: () => void
}) {
  const actions = useAppActions()
  const sdk = useSDK()
  const toast = useToast()
  const [creating, setCreating] = useState<string | undefined>()

  const options = useMemo(() => {
    const type = creating
    if (type) {
      return [
        {
          key: "creating",
          label: `Creating ${type} workspace...`,
          value: "creating",
          description: "This can take a while for remote environments",
        },
      ]
    }
    return [
      {
        key: "worktree",
        label: "Worktree",
        value: "worktree",
        description: "Create a local git worktree",
      },
    ]
  }, [creating])

  const createWorkspace = async (type: string) => {
    if (creating) return
    setCreating(type)

    const result = await sdk.client.project.experimental.workspace
      .create({ type, branch: null, projectID: "$UNKNOWN" })
      .catch((err) => {
        console.log(err)
        return undefined
      })

    const workspace = result?.data
    if (!workspace) {
      setCreating(undefined)
      toast.show({
        message: "Failed to create workspace",
        variant: "error",
      })
      return
    }
    await actions.workspace.sync()
    await props.onSelect(workspace.id)
    setCreating(undefined)
  }

  return (
    <SelectPane
      title={creating ? "Creating Workspace" : "New Workspace"}
      skipFilter={true}
      items={options}
      onSelect={(item) => {
        if (item.value === "creating") return
        void createWorkspace(item.value)
      }}
      onClose={props.onClose}
    />
  )
}

// DialogWorkspaceList component port
export function DialogWorkspaceList(props: { onClose?: () => void }) {
  const route = useRoute()
  const actions = useAppActions()
  const sessions = useAppState(selectSessions())
  const workspaceList = useAppState((s) => s.workspaceList)
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const [toDelete, setToDelete] = useState<string | undefined>()
  const [selectedOption, setSelectedOption] = useState<SelectItem<string> | undefined>()
  const [counts, setCounts] = useState<Record<string, number | null | undefined>>({})

  type ViewState =
    | { type: "list" }
    | { type: "create" }
    | { type: "sessionList"; workspaceID?: string; localOnly?: boolean }

  const [view, setView] = useState<ViewState>({ type: "list" })

  const open = (workspaceID: string, forceCreate?: boolean) =>
    openWorkspace({
      onClose: props.onClose,
      route,
      sdk,
      actions,
      toast,
      workspaceID,
      forceCreate,
    })

  async function selectWorkspace(workspaceID: string) {
    if (workspaceID === "__local__") {
      if (localCount > 0) {
        setView({ type: "sessionList", localOnly: true })
        return
      }
      route.navigate({
        type: "session",
      })
      props.onClose?.()
      return
    }
    const count = counts[workspaceID]
    if (count && count > 0) {
      setView({ type: "sessionList", workspaceID })
      return
    }

    if (count === 0) {
      await open(workspaceID)
      return
    }
    const client = createLiteaiClient({
      baseUrl: sdk.url,
      fetch: sdk.fetch,
      experimental_workspaceID: workspaceID,
    })
    const listed = await client.project.session
      .list({ roots: true, limit: 1, projectID: workspaceID })
      .catch(() => undefined)
    if (listed?.data?.length) {
      setView({ type: "sessionList", workspaceID })
      return
    }
    await open(workspaceID)
  }

  const currentWorkspaceID = useMemo(() => {
    if (route.data.sessionID) {
      return sessions.find((s) => s.id === route.data.sessionID)?.workspaceID ?? "__local__"
    }
    return "__local__"
  }, [route.data, sessions])

  const localCount = useMemo(
    () => sessions.filter((session) => !session.workspaceID && !session.parentID).length,
    [sessions],
  )

  const runRef = useRef(0)
  useEffect(() => {
    const workspaces = workspaceList
    const next = ++runRef.current
    if (!workspaces.length) {
      setCounts({})
      return
    }
    setCounts(Object.fromEntries(workspaces.map((workspace) => [workspace.id, undefined])))
    void Promise.all(
      workspaces.map(async (workspace) => {
        const client = createLiteaiClient({
          baseUrl: sdk.url,
          fetch: sdk.fetch,
          experimental_workspaceID: workspace.id,
        })
        const result = await client.project.session
          .list({ roots: true, projectID: workspace.id })
          .catch(() => undefined)
        return [workspace.id, result ? (result.data?.length ?? 0) : null] as const
      }),
    ).then((entries) => {
      if (runRef.current !== next) return
      setCounts(Object.fromEntries(entries))
    })
  }, [workspaceList, sdk.url, sdk.fetch])

  const options = useMemo(
    () =>
      [
        {
          key: "__local__",
          label: "Local",
          value: "__local__",
          category: "Workspace",
          description: "Use the local machine",
          footer: `${localCount} session${localCount === 1 ? "" : "s"}`,
        },
        ...workspaceList.map((workspace) => {
          const count = counts[workspace.id]
          return {
            key: workspace.id,
            label: toDelete === workspace.id ? `Delete ${workspace.id}? Press ctrl+d again` : workspace.id,
            value: workspace.id,
            category: workspace.type,
            description: workspace.branch ? `Branch ${workspace.branch}` : undefined,
            footer:
              count === undefined
                ? "Loading sessions..."
                : count === null
                  ? "Sessions unavailable"
                  : `${count} session${count === 1 ? "" : "s"}`,
          }
        }),
        {
          key: "__create__",
          label: "+ New workspace",
          value: "__create__",
          category: "Actions",
          description: "Create a new workspace",
        },
      ] as SelectItem<string>[],
    [workspaceList, counts, localCount, toDelete],
  )

  useEffect(() => {
    void actions.workspace.sync()
  }, [actions.workspace])

  useKeybindings(
    {
      "select:delete": async () => {
        if (!selectedOption || selectedOption.value === "__create__" || selectedOption.value === "__local__") return
        if (toDelete !== selectedOption.value) {
          setToDelete(selectedOption.value)
          return
        }
        const result = await sdk.client.project.experimental.workspace
          .remove({ id: selectedOption.value, projectID: "$UNKNOWN" })
          .catch(() => undefined)
        setToDelete(undefined)
        if (result?.error) {
          toast.show({
            message: "Failed to delete workspace",
            variant: "error",
          })
          return
        }
        if (currentWorkspaceID === selectedOption.value) {
          route.navigate({
            type: "session",
          })
        }
        await actions.workspace.sync()
      },
    },
    { context: "Select" },
  )

  if (view.type === "create") {
    return (
      <DialogWorkspaceCreate
        onSelect={(workspaceID) => open(workspaceID, true)}
        onClose={() => setView({ type: "list" })}
      />
    )
  }

  if (view.type === "sessionList") {
    return (
      <DialogSessionList
        localOnly={view.localOnly}
        workspaceID={view.workspaceID}
        onClose={() => setView({ type: "list" })}
      />
    )
  }

  return (
    <SelectPane
      title="Workspaces"
      skipFilter={true}
      items={options}
      current={currentWorkspaceID}
      onHighlight={(item) => {
        setToDelete(undefined)
        setSelectedOption(item)
      }}
      onSelect={(item) => {
        setToDelete(undefined)
        if (item.value === "__create__") {
          setView({ type: "create" })
          return
        }
        void selectWorkspace(item.value)
      }}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ navigate · Enter select · ctrl+d delete</Text>}
      onClose={props.onClose}
    />
  )
}
