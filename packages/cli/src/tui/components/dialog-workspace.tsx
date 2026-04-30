import { type Color, Text } from "@liteai/ink"
import { createLiteaiClient, type Session } from "@liteai/sdk"
import { useEffect, useMemo, useRef, useState } from "react"
import { useDialog } from "../context/dialog"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { useKeybindings } from "../keybindings/use-keybinding"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { DialogSessionList } from "./dialog-session-list"

// openWorkspace function port
async function openWorkspace(input: {
  dialog: ReturnType<typeof useDialog>
  route: ReturnType<typeof useRoute>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
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
    await input.sync.session.sync(session.id)
    input.route.navigate({
      type: "session",
      sessionID: session.id,
    })
    input.dialog.clear()
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
  await input.sync.session.sync(created.id)
  input.route.navigate({
    type: "session",
    sessionID: created.id,
  })
  input.dialog.clear()
}

// DialogWorkspaceCreate component port
export function DialogWorkspaceCreate(props: { onSelect: (workspaceID: string) => Promise<void> }) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const [creating, setCreating] = useState<string | undefined>()

  useEffect(() => {
    dialog.setSize("medium")
  }, [dialog])

  const options = useMemo(() => {
    const type = creating
    if (type) {
      return [
        {
          title: `Creating ${type} workspace...`,
          value: "creating",
          description: "This can take a while for remote environments",
        },
      ]
    }
    return [
      {
        title: "Worktree",
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
    await sync.workspace.sync()
    await props.onSelect(workspace.id)
    setCreating(undefined)
  }

  return (
    <DialogSelect
      title={creating ? "Creating Workspace" : "New Workspace"}
      skipFilter={true}
      options={options}
      onSelect={(option) => {
        if (option.value === "creating") return
        void createWorkspace(option.value)
      }}
    />
  )
}

// DialogWorkspaceList component port
export function DialogWorkspaceList() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const [toDelete, setToDelete] = useState<string | undefined>()
  const [selectedOption, setSelectedOption] = useState<DialogSelectOption<string> | undefined>()
  const [counts, setCounts] = useState<Record<string, number | null | undefined>>({})

  const open = (workspaceID: string, forceCreate?: boolean) =>
    openWorkspace({
      dialog,
      route,
      sdk,
      sync,
      toast,
      workspaceID,
      forceCreate,
    })

  async function selectWorkspace(workspaceID: string) {
    if (workspaceID === "__local__") {
      if (localCount > 0) {
        dialog.replace(() => <DialogSessionList localOnly={true} />)
        return
      }
      route.navigate({
        type: "home",
      })
      dialog.clear()
      return
    }
    const count = counts[workspaceID]
    if (count && count > 0) {
      dialog.replace(() => <DialogSessionList workspaceID={workspaceID} />)
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
      dialog.replace(() => <DialogSessionList workspaceID={workspaceID} />)
      return
    }
    await open(workspaceID)
  }

  const currentWorkspaceID = useMemo(() => {
    if (route.data.type === "session") {
      return sync.session.get(route.data.sessionID)?.workspaceID ?? "__local__"
    }
    return "__local__"
  }, [route.data, sync.session])

  const localCount = useMemo(
    () => sync.sessions.filter((session) => !session.workspaceID && !session.parentID).length,
    [sync.sessions],
  )

  const runRef = useRef(0)
  useEffect(() => {
    const workspaces = sync.workspaceList
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
  }, [sync.workspaceList, sdk.url, sdk.fetch])

  const options = useMemo(
    () =>
      [
        {
          title: "Local",
          value: "__local__",
          category: "Workspace",
          description: "Use the local machine",
          footer: `${localCount} session${localCount === 1 ? "" : "s"}`,
        },
        ...sync.workspaceList.map((workspace) => {
          const count = counts[workspace.id]
          return {
            title: toDelete === workspace.id ? `Delete ${workspace.id}? Press ctrl+d again` : workspace.id,
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
          title: "+ New workspace",
          value: "__create__",
          category: "Actions",
          description: "Create a new workspace",
        },
      ] as DialogSelectOption<string>[],
    [sync.workspaceList, counts, localCount, toDelete],
  )

  useEffect(() => {
    dialog.setSize("large")
    void sync.workspace.sync()
  }, [dialog, sync.workspace])

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
            type: "home",
          })
        }
        await sync.workspace.sync()
      },
    },
    { context: "Select" },
  )

  return (
    <DialogSelect
      title="Workspaces"
      skipFilter={true}
      options={options}
      current={currentWorkspaceID}
      onMove={(option) => {
        setToDelete(undefined)
        setSelectedOption(option)
      }}
      onSelect={(option) => {
        setToDelete(undefined)
        if (option.value === "__create__") {
          dialog.replace(() => <DialogWorkspaceCreate onSelect={(workspaceID) => open(workspaceID, true)} />)
          return
        }
        void selectWorkspace(option.value)
      }}
      footerContent={<Text color={theme.textMuted as Color}>↑↓ navigate · Enter select · ctrl+d delete</Text>}
    />
  )
}
