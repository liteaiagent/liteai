import { Button } from "@liteai/ui/button"
import { DropdownMenu } from "@liteai/ui/dropdown-menu"
import { IconButton } from "@liteai/ui/icon-button"
import { Tooltip } from "@liteai/ui/tooltip"
import { getFilename } from "@liteai/util/path"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { closestCenter, DragDropProvider, DragDropSensors, DragOverlay, SortableProvider } from "@thisbeyond/solid-dnd"
import { type Accessor, createMemo, For, Show } from "solid-js"
import type { useLanguage } from "@/context/language"
import type { LocalProject } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { useProviders } from "@/hooks/use-providers"
import { toProjectID } from "@/utils/project-id"
import { ConstrainDragXAxis } from "@/utils/solid-dnd"
import type { createInlineEditorController } from "./inline-editor"
import {
  LocalWorkspace,
  SortableWorkspace,
  WorkspaceDragOverlay,
  type WorkspaceSidebarContext,
} from "./sidebar-workspace"

export type SidebarPanelProps = {
  project: Accessor<LocalProject | undefined>
  mobile?: boolean
  merged?: boolean
  // layout deps
  sidebarOpened: Accessor<boolean>
  sidebarWidth: Accessor<number>
  // language
  language: ReturnType<typeof useLanguage>
  // workspace sidebar context
  workspaceSidebarCtx: WorkspaceSidebarContext
  // callbacks
  renameProject: (project: LocalProject, next: string) => void
  closeProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  navigateWithSidebarReset: (href: string) => void
  connectProvider: () => void
  createWorkspace: (project: LocalProject) => Promise<void>
  // inline editor
  InlineEditor: ReturnType<typeof createInlineEditorController>["InlineEditor"]
  // workspace state
  workspaceIds: (project: LocalProject) => string[]
  workspacesEnabled: (project: LocalProject) => boolean
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
  sidebarHovering: Accessor<boolean>
  // workspace drag
  handleWorkspaceDragStart: (event: unknown) => void
  handleWorkspaceDragEnd: () => void
  handleWorkspaceDragOver: (event: DragEvent) => void
  sidebarProject: Accessor<LocalProject | undefined>
  activeWorkspace: Accessor<string | undefined>
  // sort
  sortNow: () => number
  // getting started
  gettingStartedDismissed: boolean
  dismissGettingStarted: () => void
  // home dir
  homedir: Accessor<string>
}

export function SidebarPanel(props: SidebarPanelProps) {
  const notification = useNotification()
  const providers = useProviders()
  const project = props.project
  const merged = createMemo(() => props.mobile || (props.merged ?? props.sidebarOpened()))
  const hover = createMemo(() => !props.mobile && props.merged === false && !props.sidebarOpened())
  const popover = createMemo(() => !!props.mobile || props.merged === false || props.sidebarOpened())
  const projectName = createMemo(() => {
    const item = project()
    if (!item) return ""
    return item.name || getFilename(item.worktree)
  })
  const projectId = createMemo(() => project()?.id ?? "")
  const worktree = createMemo(() => project()?.worktree ?? "")
  const slug = createMemo(() => {
    const dir = worktree()
    if (!dir) return ""
    return toProjectID(dir)
  })
  const workspaces = createMemo(() => {
    const item = project()
    if (!item) return [] as string[]
    return props.workspaceIds(item)
  })
  const unseenCount = createMemo(() =>
    workspaces().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  const clearNotifications = () =>
    workspaces()
      .filter((directory) => notification.project.unseenCount(directory) > 0)
      .forEach((directory) => {
        notification.project.markViewed(directory)
      })
  const workspacesOn = createMemo(() => {
    const item = project()
    if (!item) return false
    return props.workspacesEnabled(item)
  })
  const canToggle = createMemo(() => {
    const item = project()
    if (!item) return false
    return item.vcs === "git" || props.workspacesEnabled(item)
  })

  return (
    <div
      classList={{
        "flex flex-col min-h-0 min-w-0 box-border rounded-tl-[12px] px-3": true,
        "border border-b-0 border-border-weak-base": !merged(),
        "border-l border-t border-border-weaker-base": merged(),
        "bg-background-base": merged() || hover(),
        "bg-background-stronger": !merged() && !hover(),
        "flex-1 min-w-0": props.mobile,
        "max-w-full overflow-hidden": props.mobile,
      }}
      style={{
        width: props.mobile ? undefined : `${Math.max(Math.max(props.sidebarWidth(), 244) - 64, 0)}px`,
      }}
    >
      <Show when={project()}>
        <div class="shrink-0 pl-1 py-1">
          <div class="group/project flex items-start justify-between gap-2 py-2 pl-2 pr-0">
            <div class="flex flex-col min-w-0">
              <props.InlineEditor
                id={`project:${projectId()}`}
                value={projectName}
                onSave={(next) => {
                  const item = project()
                  if (!item) return
                  props.renameProject(item, next)
                }}
                class="text-14-medium text-text-strong truncate"
                displayClass="text-14-medium text-text-strong truncate"
                stopPropagation
              />

              <Tooltip
                placement="bottom"
                gutter={2}
                value={worktree()}
                class="shrink-0"
                contentStyle={{
                  "max-width": "640px",
                  transform: "translate3d(52px, 0, 0)",
                }}
              >
                <span class="text-12-regular text-text-base truncate select-text">
                  {worktree().replace(props.homedir(), "~")}
                </span>
              </Tooltip>
            </div>

            <DropdownMenu modal={!props.sidebarHovering()}>
              <DropdownMenu.Trigger
                as={IconButton}
                icon="dot-grid"
                variant="ghost"
                data-action="project-menu"
                data-project={slug()}
                class="shrink-0 size-6 rounded-md data-[expanded]:bg-surface-base-active"
                classList={{
                  "opacity-0 group-hover/project:opacity-100 data-[expanded]:opacity-100": !props.mobile,
                }}
                aria-label={props.language.t("common.moreOptions")}
              />
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="mt-1">
                  <DropdownMenu.Item
                    onSelect={() => {
                      const item = project()
                      if (!item) return
                      props.showEditProjectDialog(item)
                    }}
                  >
                    <DropdownMenu.ItemLabel>{props.language.t("common.edit")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    data-action="project-workspaces-toggle"
                    data-project={slug()}
                    disabled={!canToggle()}
                    onSelect={() => {
                      const item = project()
                      if (!item) return
                      props.toggleProjectWorkspaces(item)
                    }}
                  >
                    <DropdownMenu.ItemLabel>
                      {workspacesOn()
                        ? props.language.t("sidebar.workspaces.disable")
                        : props.language.t("sidebar.workspaces.enable")}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    data-action="project-clear-notifications"
                    data-project={slug()}
                    disabled={unseenCount() === 0}
                    onSelect={clearNotifications}
                  >
                    <DropdownMenu.ItemLabel>
                      {props.language.t("sidebar.project.clearNotifications")}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <Show when={!workspacesOn()}>
                    <DropdownMenu.Item
                      onSelect={() => {
                        const item = project()
                        if (!item) return
                        props.workspaceSidebarCtx.setShowArchived(
                          item.worktree,
                          !props.workspaceSidebarCtx.showArchived(item.worktree),
                        )
                      }}
                    >
                      <DropdownMenu.ItemLabel>
                        {props.workspaceSidebarCtx.showArchived(worktree())
                          ? props.language.t("sidebar.workspace.hideArchived")
                          : props.language.t("sidebar.workspace.showArchived")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </Show>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    data-action="project-close-menu"
                    data-project={slug()}
                    onSelect={() => {
                      const dir = worktree()
                      if (!dir) return
                      props.closeProject(dir)
                    }}
                  >
                    <DropdownMenu.ItemLabel>{props.language.t("common.close")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </div>
        </div>

        <div class="flex-1 min-h-0 flex flex-col">
          <Show
            when={workspacesOn()}
            fallback={
              <>
                <div class="shrink-0 py-4">
                  <Button
                    size="large"
                    icon="new-session"
                    class="w-full"
                    onClick={() => {
                      const dir = worktree()
                      if (!dir) return
                      props.navigateWithSidebarReset(`/${toProjectID(dir)}/session`)
                    }}
                  >
                    {props.language.t("command.session.new")}
                  </Button>
                </div>
                <div class="flex-1 min-h-0">
                  <LocalWorkspace
                    ctx={props.workspaceSidebarCtx}
                    project={project() as LocalProject}
                    sortNow={props.sortNow}
                    mobile={props.mobile}
                    popover={popover()}
                  />
                </div>
              </>
            }
          >
            <div class="shrink-0 py-4">
              <Button
                size="large"
                icon="plus-small"
                class="w-full"
                onClick={() => {
                  const item = project()
                  if (!item) return
                  props.createWorkspace(item)
                }}
              >
                {props.language.t("workspace.new")}
              </Button>
            </div>
            <div class="relative flex-1 min-h-0">
              <DragDropProvider
                onDragStart={props.handleWorkspaceDragStart}
                onDragEnd={props.handleWorkspaceDragEnd}
                onDragOver={props.handleWorkspaceDragOver}
                collisionDetector={closestCenter}
              >
                <DragDropSensors />
                <ConstrainDragXAxis />
                <div
                  ref={(el) => {
                    props.workspaceSidebarCtx.setScrollContainerRef(el, props.mobile)
                  }}
                  class="size-full flex flex-col py-2 gap-4 overflow-y-auto no-scrollbar [overflow-anchor:none]"
                >
                  <SortableProvider ids={workspaces()}>
                    <For each={workspaces()}>
                      {(directory) => (
                        <SortableWorkspace
                          ctx={props.workspaceSidebarCtx}
                          directory={directory}
                          project={project() as LocalProject}
                          sortNow={props.sortNow}
                          mobile={props.mobile}
                          popover={popover()}
                        />
                      )}
                    </For>
                  </SortableProvider>
                </div>
                <DragOverlay>
                  <WorkspaceDragOverlay
                    sidebarProject={props.sidebarProject}
                    activeWorkspace={props.activeWorkspace}
                    workspaceLabel={props.workspaceLabel}
                  />
                </DragOverlay>
              </DragDropProvider>
            </div>
          </Show>
        </div>
      </Show>

      <div
        class="shrink-0 px-3 py-3"
        classList={{
          hidden: props.gettingStartedDismissed || !(providers.all().length > 0 && providers.paid().length === 0),
        }}
      >
        <div class="rounded-xl bg-background-base shadow-xs-border-base" data-component="getting-started">
          <div class="p-3 flex flex-col gap-6">
            <div class="flex flex-col gap-2">
              <div class="text-14-medium text-text-strong">{props.language.t("sidebar.gettingStarted.title")}</div>
              <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                {props.language.t("sidebar.gettingStarted.line1")}
              </div>
              <div class="text-14-regular text-text-base" style={{ "line-height": "var(--line-height-normal)" }}>
                {props.language.t("sidebar.gettingStarted.line2")}
              </div>
            </div>
            <div data-component="getting-started-actions">
              <Button size="large" icon="plus-small" onClick={props.connectProvider}>
                {props.language.t("command.provider.connect")}
              </Button>
              <Button size="large" variant="ghost" onClick={props.dismissGettingStarted}>
                {props.language.t("toast.update.action.notYet")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
