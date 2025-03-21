import { ResizeHandle } from "@liteai/ui/resize-handle"
import { Toast } from "@liteai/ui/toast"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { type Accessor, type ParentProps, Show } from "solid-js"
import { Titlebar } from "@/components/titlebar"
import type { useCommand } from "@/context/command"
import type { useLanguage } from "@/context/language"
import type { LocalProject, useLayout } from "@/context/layout"
import type { usePlatform } from "@/context/platform"
import { SidebarPanel, type SidebarPanelProps } from "./sidebar-panel"
import type { ProjectSidebarContext } from "./sidebar-project"
import { SortableProject } from "./sidebar-project"
import { SidebarContent } from "./sidebar-shell"

export type LayoutShellProps = ParentProps & {
  language: ReturnType<typeof useLanguage>
  layout: ReturnType<typeof useLayout>
  platform: ReturnType<typeof usePlatform>
  command: ReturnType<typeof useCommand>
  // state
  sizing: boolean
  peeked: boolean
  sidebarHovering: Accessor<boolean>
  autoselecting: Accessor<boolean>
  // nav ref
  setNav: (el: HTMLElement) => void
  setSizing: (value: boolean) => void
  // resize
  sizet: { current: number | undefined }
  // hover
  disarm: () => void
  arm: () => void
  aimReset: () => void
  aimMove: (event: MouseEvent) => void
  // sidebar content
  projects: Accessor<LocalProject[]>
  projectSidebarCtx: ProjectSidebarContext
  sortNow: () => number
  handleDragStart: (event: unknown) => void
  handleDragEnd: () => void
  handleDragOver: (event: DragEvent) => void
  // biome-ignore lint/suspicious/noExplicitAny: SolidJS/React JSX namespace conflict
  projectOverlay: () => any
  chooseProject: () => void
  openSettings: (tab?: string) => void
  // sidebar panel
  currentProject: Accessor<LocalProject | undefined>
  peekProject: Accessor<LocalProject | undefined>
  panelProps: Omit<SidebarPanelProps, "project" | "mobile" | "merged">
}

export function LayoutShell(props: LayoutShellProps) {
  const sidebarContent = (mobile?: boolean) => (
    <SidebarContent
      mobile={mobile}
      opened={() => props.layout.sidebar.opened()}
      aimMove={props.aimMove}
      projects={props.projects}
      renderProject={(project) => (
        <SortableProject ctx={props.projectSidebarCtx} project={project} sortNow={props.sortNow} mobile={mobile} />
      )}
      handleDragStart={props.handleDragStart}
      handleDragEnd={props.handleDragEnd}
      handleDragOver={props.handleDragOver}
      openProjectLabel={props.language.t("command.project.open")}
      openProjectKeybind={() => props.command.keybind("project.open")}
      onOpenProject={props.chooseProject}
      renderProjectOverlay={props.projectOverlay}
      settingsLabel={() => props.language.t("sidebar.settings")}
      settingsKeybind={() => props.command.keybind("settings.open")}
      onOpenSettings={props.openSettings}
      helpLabel={() => props.language.t("sidebar.help")}
      onOpenHelp={() => props.platform.openLink("https://liteai.ai/desktop-feedback")}
      renderPanel={() =>
        mobile ? (
          <SidebarPanel project={props.currentProject} mobile {...props.panelProps} />
        ) : (
          <Show when={props.currentProject()}>
            <SidebarPanel project={props.currentProject} merged {...props.panelProps} />
          </Show>
        )
      }
    />
  )

  return (
    <div class="relative bg-background-base flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
      <Titlebar />
      <div class="flex-1 min-h-0 min-w-0 flex">
        <div class="flex-1 min-h-0 relative">
          <div class="size-full relative overflow-x-hidden">
            <nav
              aria-label={props.language.t("sidebar.nav.projectsAndSessions")}
              data-component="sidebar-nav-desktop"
              classList={{
                "hidden xl:block": true,
                "absolute inset-y-0 left-0": true,
                "z-10": true,
              }}
              style={{ width: `${Math.max(props.layout.sidebar.width(), 244)}px` }}
              ref={props.setNav}
              onMouseEnter={props.disarm}
              onMouseLeave={() => {
                props.aimReset()
                if (!props.sidebarHovering()) return
                props.arm()
              }}
            >
              <div class="@container w-full h-full contain-strict">{sidebarContent()}</div>
              <Show when={props.layout.sidebar.opened()}>
                <div onPointerDown={() => props.setSizing(true)}>
                  <ResizeHandle
                    direction="horizontal"
                    size={props.layout.sidebar.width()}
                    min={244}
                    max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.3 + 64}
                    collapseThreshold={244}
                    onResize={(w) => {
                      props.setSizing(true)
                      if (props.sizet.current !== undefined) clearTimeout(props.sizet.current)
                      props.sizet.current = window.setTimeout(() => props.setSizing(false), 120)
                      props.layout.sidebar.resize(w)
                    }}
                    onCollapse={props.layout.sidebar.close}
                  />
                </div>
              </Show>
            </nav>

            <div
              class="hidden xl:block pointer-events-none absolute top-0 right-0 z-0 border-t border-border-weaker-base"
              style={{ left: "calc(4rem + 12px)" }}
            />

            <div class="xl:hidden">
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: mobile sidebar overlay backdrop */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: mobile sidebar overlay backdrop */}
              <div
                classList={{
                  "fixed inset-x-0 top-10 bottom-0 z-40 transition-opacity duration-200": true,
                  "opacity-100 pointer-events-auto": props.layout.mobileSidebar.opened(),
                  "opacity-0 pointer-events-none": !props.layout.mobileSidebar.opened(),
                }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) props.layout.mobileSidebar.hide()
                }}
              />
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: sidebar navigation container */}
              <nav
                aria-label={props.language.t("sidebar.nav.projectsAndSessions")}
                data-component="sidebar-nav-mobile"
                classList={{
                  "@container fixed top-10 bottom-0 left-0 z-50 w-full max-w-[400px] overflow-hidden border-r border-border-weaker-base bg-background-base transition-transform duration-200 ease-out": true,
                  "translate-x-0": props.layout.mobileSidebar.opened(),
                  "-translate-x-full": !props.layout.mobileSidebar.opened(),
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {sidebarContent(true)}
              </nav>
            </div>

            <div
              classList={{
                "absolute inset-0": true,
                "xl:inset-y-0 xl:right-0 xl:left-[var(--main-left)]": true,
                "z-20": true,
                "transition-[left] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[left] motion-reduce:transition-none":
                  !props.sizing,
              }}
              style={{
                "--main-left": props.layout.sidebar.opened()
                  ? `${Math.max(props.layout.sidebar.width(), 244)}px`
                  : "4rem",
              }}
            >
              <main
                classList={{
                  "size-full overflow-x-hidden flex flex-col items-start contain-strict border-t border-border-weak-base bg-background-base xl:border-l xl:rounded-tl-[12px]": true,
                }}
              >
                <Show when={!props.autoselecting()} fallback={<div class="size-full" />}>
                  {props.children}
                </Show>
              </main>
            </div>

            {/* biome-ignore lint/a11y/noStaticElementInteractions: peek panel layout container */}
            <div
              classList={{
                "hidden xl:flex absolute inset-y-0 left-16 z-30": true,
                "opacity-100 translate-x-0 pointer-events-auto": props.peeked && !props.layout.sidebar.opened(),
                "opacity-0 -translate-x-2 pointer-events-none": !props.peeked || props.layout.sidebar.opened(),
                "transition-[opacity,transform] motion-reduce:transition-none": true,
                "duration-180 ease-out": props.peeked && !props.layout.sidebar.opened(),
                "duration-120 ease-in": !props.peeked || props.layout.sidebar.opened(),
              }}
              onMouseMove={props.disarm}
              onMouseEnter={() => {
                props.disarm()
                props.aimReset()
              }}
              onPointerDown={props.disarm}
              onMouseLeave={() => props.arm()}
            >
              <Show when={props.peekProject()}>
                <SidebarPanel project={props.peekProject} merged={false} {...props.panelProps} />
              </Show>
            </div>

            <div
              classList={{
                "hidden xl:block pointer-events-none absolute inset-y-0 right-0 z-25 overflow-hidden": true,
                "opacity-100 translate-x-0": props.peeked && !props.layout.sidebar.opened(),
                "opacity-0 -translate-x-2": !props.peeked || props.layout.sidebar.opened(),
                "transition-[opacity,transform] motion-reduce:transition-none": true,
                "duration-180 ease-out": props.peeked && !props.layout.sidebar.opened(),
                "duration-120 ease-in": !props.peeked || props.layout.sidebar.opened(),
              }}
              style={{ left: `calc(4rem + ${Math.max(Math.max(props.layout.sidebar.width(), 244) - 64, 0)}px)` }}
            >
              <div class="h-full w-px" style={{ "box-shadow": "var(--shadow-sidebar-overlay)" }} />
            </div>
          </div>
        </div>
      </div>
      <Toast.Region />
    </div>
  )
}
