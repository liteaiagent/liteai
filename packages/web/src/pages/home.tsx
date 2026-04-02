import { Button } from "@liteai/ui/button"
import { useDialog } from "@liteai/ui/context/dialog"
import { Icon } from "@liteai/ui/icon"
import { Logo } from "@liteai/ui/logo"
import { useNavigate } from "@solidjs/router"
import { DateTime } from "luxon"
import { createMemo, For, Match, Switch } from "solid-js"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"

export default function Home() {
  const sync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const homedir = createMemo(() => sync.data.path.home)
  const recent = createMemo(() => {
    return sync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5)
  })



  async function openProject(directory: string) {
    let projectID = ""
    try {
      const res = await globalSDK.client.project.create({ directory })
      if (res.data) projectID = res.data.id
    } catch {
      // ignore
    }
    if (!projectID) {
      const existing = sync.data.project.find(
        (p) =>
          p.worktree === directory ||
          (p as { sandbox?: string; directory?: string }).sandbox === directory ||
          (p as { sandbox?: string; directory?: string }).directory === directory,
      )
      if (existing) projectID = existing.id
    }
    if (!projectID) return

    layout.projects.open(directory)
    layout.projects.touch(directory)
    navigate(`/${projectID}`)
  }

  async function chooseProject() {
    async function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          await openProject(directory)
        }
      } else if (result) {
        await openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      dialog.show(
        () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
        () => resolve(null),
      )
    }
  }

  return (
    <>
      <div class="mx-auto mt-55 w-full md:w-auto px-4">
        <Logo class="md:w-xl opacity-12" />
        <Switch>
          <Match when={sync.ready && sync.data.project.length > 0}>
            <div class="mt-20 w-full flex flex-col gap-4">
              <div class="flex gap-2 items-center justify-between pl-3">
                <div class="text-14-medium text-text-strong">{language.t("home.recentProjects")}</div>
                <Button icon="folder-add-left" size="normal" class="pl-2 pr-3" onClick={chooseProject}>
                  {language.t("command.project.open")}
                </Button>
              </div>
              <ul class="flex flex-col gap-2">
                <For each={recent()}>
                  {(project) => (
                    <Button
                      size="large"
                      variant="ghost"
                      class="text-14-mono text-left justify-between px-3"
                      onClick={() => openProject(project.worktree)}
                    >
                      {project.worktree.replace(homedir(), "~")}
                      <div class="text-14-regular text-text-weak">
                        {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                      </div>
                    </Button>
                  )}
                </For>
              </ul>
            </div>
          </Match>
          <Match when={true}>
            <div class="mt-30 mx-auto flex flex-col items-center gap-3">
              <Icon name="folder-add-left" size="large" />
              <div class="flex flex-col gap-1 items-center justify-center">
                <div class="text-14-medium text-text-strong">{language.t("home.empty.title")}</div>
                <div class="text-12-regular text-text-weak">{language.t("home.empty.description")}</div>
              </div>
              <Button class="px-3 mt-1" onClick={chooseProject}>
                {language.t("command.project.open")}
              </Button>
            </div>
          </Match>
        </Switch>
      </div>
    </>
  )
}
