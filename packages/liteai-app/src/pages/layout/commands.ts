import type { ColorScheme, useTheme } from "@liteai/ui/theme"
import { showToast } from "@liteai/ui/toast"
import type { Session } from "@liteai/sdk/client"
import { type Accessor, createMemo } from "solid-js"
import type { CommandOption, useCommand } from "@/context/command"
import type { Locale, useLanguage } from "@/context/language"
import type { LocalProject } from "@/context/layout"

export type CommandDeps = {
  language: ReturnType<typeof useLanguage>
  theme: ReturnType<typeof useTheme>
  command: ReturnType<typeof useCommand>
  currentProject: Accessor<LocalProject | undefined>
  workspaceSetting: Accessor<boolean>
  currentSessions: Accessor<Session[]>
  params: { projectID?: string; id?: string }
  sidebarToggle: () => void
  chooseProject: () => void
  connectProvider: () => void
  openServer: () => void
  openSettings: (tab?: string) => void
  navigateSessionByOffset: (offset: number) => void
  navigateSessionByUnseen: (offset: number) => void
  archiveSession: (session: Session) => Promise<void>
  createWorkspace: (project: LocalProject) => Promise<void>
  toggleWorkspaces: (project: LocalProject) => void
  toggleWorkspacesEnabled: (worktree: string) => Accessor<boolean>
}

const colorSchemeOrder: ColorScheme[] = ["system", "light", "dark"]
const colorSchemeKey: Record<ColorScheme, "theme.scheme.system" | "theme.scheme.light" | "theme.scheme.dark"> = {
  system: "theme.scheme.system",
  light: "theme.scheme.light",
  dark: "theme.scheme.dark",
}

export function cycleTheme(
  deps: { theme: ReturnType<typeof useTheme>; language: ReturnType<typeof useLanguage> },
  direction = 1,
) {
  const entries = Object.entries(deps.theme.themes())
  const ids = entries.map(([id]) => id)
  if (ids.length === 0) return
  const current = ids.indexOf(deps.theme.themeId())
  const next = current === -1 ? 0 : (current + direction + ids.length) % ids.length
  const id = ids[next]
  deps.theme.setTheme(id)
  const def = deps.theme.themes()[id]
  showToast({
    title: deps.language.t("toast.theme.title"),
    description: def?.name ?? id,
  })
}

export function cycleColorScheme(
  deps: { theme: ReturnType<typeof useTheme>; language: ReturnType<typeof useLanguage> },
  direction = 1,
) {
  const current = deps.theme.colorScheme()
  const index = colorSchemeOrder.indexOf(current)
  const next = index === -1 ? 0 : (index + direction + colorSchemeOrder.length) % colorSchemeOrder.length
  const scheme = colorSchemeOrder[next]
  deps.theme.setColorScheme(scheme)
  showToast({
    title: deps.language.t("toast.scheme.title"),
    description: deps.language.t(colorSchemeKey[scheme]),
  })
}

export function setLocale(deps: { language: ReturnType<typeof useLanguage> }, next: Locale) {
  if (next === deps.language.locale()) return
  deps.language.setLocale(next)
  showToast({
    title: deps.language.t("toast.language.title"),
    description: deps.language.t("toast.language.description", { language: deps.language.label(next) }),
  })
}

function cycleLanguage(deps: { language: ReturnType<typeof useLanguage> }, direction = 1) {
  const locales = deps.language.locales
  const current = locales.indexOf(deps.language.locale())
  const next = current === -1 ? 0 : (current + direction + locales.length) % locales.length
  const locale = locales[next]
  if (!locale) return
  setLocale(deps, locale)
}

export function registerCommands(deps: CommandDeps) {
  const themeLanguage = { theme: deps.theme, language: deps.language }
  const availableThemeEntries = createMemo(() => Object.entries(deps.theme.themes()))
  const colorSchemeLabel = (scheme: ColorScheme) => deps.language.t(colorSchemeKey[scheme])

  deps.command.register("layout", () => {
    const commands: CommandOption[] = [
      {
        id: "sidebar.toggle",
        title: deps.language.t("command.sidebar.toggle"),
        category: deps.language.t("command.category.view"),
        keybind: "mod+b",
        onSelect: deps.sidebarToggle,
      },
      {
        id: "project.open",
        title: deps.language.t("command.project.open"),
        category: deps.language.t("command.category.project"),
        keybind: "mod+o",
        onSelect: deps.chooseProject,
      },
      {
        id: "provider.connect",
        title: deps.language.t("command.provider.connect"),
        category: deps.language.t("command.category.provider"),
        onSelect: deps.connectProvider,
      },
      {
        id: "server.switch",
        title: deps.language.t("command.server.switch"),
        category: deps.language.t("command.category.server"),
        onSelect: deps.openServer,
      },
      {
        id: "settings.open",
        title: deps.language.t("command.settings.open"),
        category: deps.language.t("command.category.settings"),
        keybind: "mod+comma",
        slash: "settings",
        onSelect: () => deps.openSettings("general"),
      },
      {
        id: "settings.open.mcp",
        title: deps.language.t("settings.mcp.title"),
        description: "Manage MCP servers",
        category: deps.language.t("command.category.settings"),
        slash: "mcp",
        onSelect: () => deps.openSettings("mcp"),
      },
      {
        id: "settings.open.plugins",
        title: "Manage plugins",
        description: "Browse markets, install and configure plugins",
        category: deps.language.t("command.category.settings"),
        slash: "plugin",
        onSelect: () => deps.openSettings("plugins"),
      },
      {
        id: "session.previous",
        title: deps.language.t("command.session.previous"),
        category: deps.language.t("command.category.session"),
        keybind: "alt+arrowup",
        onSelect: () => deps.navigateSessionByOffset(-1),
      },
      {
        id: "session.next",
        title: deps.language.t("command.session.next"),
        category: deps.language.t("command.category.session"),
        keybind: "alt+arrowdown",
        onSelect: () => deps.navigateSessionByOffset(1),
      },
      {
        id: "session.previous.unseen",
        title: deps.language.t("command.session.previous.unseen"),
        category: deps.language.t("command.category.session"),
        keybind: "shift+alt+arrowup",
        onSelect: () => deps.navigateSessionByUnseen(-1),
      },
      {
        id: "session.next.unseen",
        title: deps.language.t("command.session.next.unseen"),
        category: deps.language.t("command.category.session"),
        keybind: "shift+alt+arrowdown",
        onSelect: () => deps.navigateSessionByUnseen(1),
      },
      {
        id: "session.archive",
        title: deps.language.t("command.session.archive"),
        category: deps.language.t("command.category.session"),
        keybind: "mod+shift+backspace",
        disabled: !deps.params.projectID || !deps.params.id,
        onSelect: () => {
          const session = deps.currentSessions().find((s) => s.id === deps.params.id)
          if (session) deps.archiveSession(session)
        },
      },
      {
        id: "workspace.new",
        title: deps.language.t("workspace.new"),
        category: deps.language.t("command.category.workspace"),
        keybind: "mod+shift+w",
        disabled: !deps.workspaceSetting(),
        onSelect: () => {
          const project = deps.currentProject()
          if (!project) return
          return deps.createWorkspace(project)
        },
      },
      {
        id: "workspace.toggle",
        title: deps.language.t("command.workspace.toggle"),
        description: deps.language.t("command.workspace.toggle.description"),
        category: deps.language.t("command.category.workspace"),
        slash: "workspace",
        disabled: !deps.currentProject() || deps.currentProject()?.vcs !== "git",
        onSelect: () => {
          const project = deps.currentProject()
          if (!project) return
          if (project.vcs !== "git") return
          const wasEnabled = deps.toggleWorkspacesEnabled(project.worktree)()
          deps.toggleWorkspaces(project)
          showToast({
            title: wasEnabled
              ? deps.language.t("toast.workspace.disabled.title")
              : deps.language.t("toast.workspace.enabled.title"),
            description: wasEnabled
              ? deps.language.t("toast.workspace.disabled.description")
              : deps.language.t("toast.workspace.enabled.description"),
          })
        },
      },
      {
        id: "theme.cycle",
        title: deps.language.t("command.theme.cycle"),
        category: deps.language.t("command.category.theme"),
        keybind: "mod+shift+t",
        onSelect: () => cycleTheme(themeLanguage, 1),
      },
    ]

    for (const [id, definition] of availableThemeEntries()) {
      commands.push({
        id: `theme.set.${id}`,
        title: deps.language.t("command.theme.set", { theme: definition.name ?? id }),
        category: deps.language.t("command.category.theme"),
        onSelect: () => deps.theme.commitPreview(),
        onHighlight: () => {
          deps.theme.previewTheme(id)
          return () => deps.theme.cancelPreview()
        },
      })
    }

    commands.push({
      id: "theme.scheme.cycle",
      title: deps.language.t("command.theme.scheme.cycle"),
      category: deps.language.t("command.category.theme"),
      keybind: "mod+shift+s",
      onSelect: () => cycleColorScheme(themeLanguage, 1),
    })

    for (const scheme of colorSchemeOrder) {
      commands.push({
        id: `theme.scheme.${scheme}`,
        title: deps.language.t("command.theme.scheme.set", { scheme: colorSchemeLabel(scheme) }),
        category: deps.language.t("command.category.theme"),
        onSelect: () => deps.theme.commitPreview(),
        onHighlight: () => {
          deps.theme.previewColorScheme(scheme)
          return () => deps.theme.cancelPreview()
        },
      })
    }

    commands.push({
      id: "language.cycle",
      title: deps.language.t("command.language.cycle"),
      category: deps.language.t("command.category.language"),
      onSelect: () => cycleLanguage(deps, 1),
    })

    for (const locale of deps.language.locales) {
      commands.push({
        id: `language.set.${locale}`,
        title: deps.language.t("command.language.set", { language: deps.language.label(locale) }),
        category: deps.language.t("command.category.language"),
        onSelect: () => setLocale(deps, locale),
      })
    }

    return commands
  })
}
