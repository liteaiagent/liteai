import { DataProvider } from "@liteai/ui/context"
import { showToast } from "@liteai/ui/toast"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { batch, createEffect, createMemo, type ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { LocalProvider } from "@/context/local"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { WebChatContextProvider } from "@/context/web-chat-context"
import { toProjectID } from "@/utils/project-id"

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const navigate = useNavigate()
  const sync = useSync()
  const slug = createMemo(() => toProjectID(props.directory))

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onNavigateToSession={(sessionID: string) => navigate(`/${slug()}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${slug()}/session/${sessionID}`}
    >
      <LocalProvider>
        <WebChatContextProvider>{props.children}</WebChatContextProvider>
      </LocalProvider>
    </DataProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const navigate = useNavigate()
  const _location = useLocation()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const projectID = createMemo(() => params.projectID ?? "")
  const [state, setState] = createStore({ invalid: "", resolvedDir: "" })

  createEffect(() => {
    if (!projectID()) return
    const currentID = projectID()

    globalSDK
      .createClient({
        throwOnError: true,
      })
      .project.get({ projectID: currentID })
      .then((x) => {
        if (projectID() !== currentID) return
        const dir = (x.data as { directory?: string })?.directory ?? x.data?.worktree ?? ""
        if (!dir) throw new Error("No directory in project response")
        batch(() => {
          setState("invalid", "")
          setState("resolvedDir", dir)
        })
      })
      .catch((err: unknown) => {
        if (projectID() !== currentID) return

        // If it's explicitly our backend rejecting the path, kick the user out
        const e = err as Record<string, unknown> | undefined
        if (e?.status === 404 || e?.status === 400 || e?.name === "NotFoundError") {
          setState("invalid", currentID)
          showToast({
            variant: "error",
            title: language.t("common.requestFailed"),
            description: "Project does not exist or is invalid.",
          })
          navigate("/", { replace: true })
        }
      })
  })

  return (
    <Show when={state.resolvedDir} keyed>
      {(resolvedDir) => (
        <SDKProvider projectID={projectID} directory={() => resolvedDir}>
          <SyncProvider>
            <DirectoryDataProvider directory={resolvedDir}>{props.children}</DirectoryDataProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
