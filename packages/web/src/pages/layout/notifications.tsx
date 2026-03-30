import { showToast, toaster } from "@liteai/ui/toast"
import { getFilename } from "@liteai/util/path"
import { useParams } from "@solidjs/router"
import { type Accessor, createEffect, onCleanup, onMount } from "solid-js"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useGlobalSync } from "@/context/global-sync"
import type { useLanguage } from "@/context/language"
import type { useNotification } from "@/context/notification"
import type { usePermission } from "@/context/permission"
import type { usePlatform } from "@/context/platform"
import type { useSettings } from "@/context/settings"
import { toProjectID } from "@/utils/project-id"
import { playSound, soundSrc } from "@/utils/sound"
import { Worktree as WorktreeState } from "@/utils/worktree"

export type NotificationDeps = {
  globalSDK: ReturnType<typeof useGlobalSDK>
  globalSync: ReturnType<typeof useGlobalSync>
  language: ReturnType<typeof useLanguage>
  settings: ReturnType<typeof useSettings>
  platform: ReturnType<typeof usePlatform>
  permission: ReturnType<typeof usePermission>
  notification: ReturnType<typeof useNotification>
  navigate: (href: string) => void
  currentDir: Accessor<string>
  setBusy: (directory: string, value: boolean) => void
}

export function useSDKNotificationToasts(deps: NotificationDeps) {
  onMount(() => {
    const params = useParams()
    const bySession = new Map<string, number>()
    const alertedAt = new Map<string, number>()
    const cooldownMs = 5000

    const dismiss = (key: string) => {
      const id = bySession.get(key)
      if (id === undefined) return
      toaster.dismiss(id)
      bySession.delete(key)
      alertedAt.delete(key)
    }

    const unsub = deps.globalSDK.event.listen((e) => {
      if (e.details?.type === "worktree.ready") {
        deps.setBusy(e.name, false)
        WorktreeState.ready(e.name)
        return
      }

      if (e.details?.type === "worktree.failed") {
        deps.setBusy(e.name, false)
        WorktreeState.failed(e.name, e.details.properties?.message ?? deps.language.t("common.requestFailed"))
        return
      }

      if (
        e.details?.type === "question.replied" ||
        e.details?.type === "question.rejected" ||
        e.details?.type === "permission.replied"
      ) {
        const props = e.details.properties as { sessionID: string }
        const key = `${e.name}:${props.sessionID}`
        dismiss(key)
        return
      }

      if (e.details?.type !== "permission.asked" && e.details?.type !== "question.asked") return
      const title =
        e.details.type === "permission.asked"
          ? deps.language.t("notification.permission.title")
          : deps.language.t("notification.question.title")
      const icon = e.details.type === "permission.asked" ? ("checklist" as const) : ("bubble-5" as const)
      const directory = e.name
      const properties = e.details.properties
      if (e.details.type === "permission.asked" && deps.permission.autoResponds(e.details.properties, directory)) return

      const [store] = deps.globalSync.child(directory, { bootstrap: false })
      const session = store.session.find((s) => s.id === properties.sessionID)
      const key = `${directory}:${properties.sessionID}`

      const sessionTitle = session?.title ?? deps.language.t("command.session.new")
      const projectName = getFilename(directory)
      const description =
        e.details.type === "permission.asked"
          ? deps.language.t("notification.permission.description", { sessionTitle, projectName })
          : deps.language.t("notification.question.description", { sessionTitle, projectName })
      const href = `/${toProjectID(directory)}/session/${properties.sessionID}`

      const now = Date.now()
      const last = alertedAt.get(key) ?? 0
      if (now - last < cooldownMs) return
      alertedAt.set(key, now)

      if (e.details.type === "permission.asked") {
        if (deps.settings.sounds.permissionsEnabled()) {
          playSound(soundSrc(deps.settings.sounds.permissions()))
        }
        if (deps.settings.notifications.permissions()) {
          void deps.platform.notify(title, description, href)
        }
      }

      if (e.details.type === "question.asked") {
        if (deps.settings.notifications.agent()) {
          void deps.platform.notify(title, description, href)
        }
      }

      const currentSession = params.id
      if (directory === deps.currentDir() && properties.sessionID === currentSession) return
      if (directory === deps.currentDir() && session?.parentID === currentSession) return

      dismiss(key)

      const toastId = showToast({
        persistent: true,
        icon,
        title,
        description,
        actions: [
          {
            label: deps.language.t("notification.action.goToSession"),
            onClick: () => deps.navigate(href),
          },
          {
            label: deps.language.t("common.dismiss"),
            onClick: "dismiss",
          },
        ],
      })
      bySession.set(key, toastId)
    })
    onCleanup(unsub)

    createEffect(() => {
      const currentSession = params.id
      if (!deps.currentDir() || !currentSession) return
      const key = `${deps.currentDir()}:${currentSession}`
      dismiss(key)
      const [store] = deps.globalSync.child(deps.currentDir(), { bootstrap: false })
      const children = store.session.filter((s) => s.parentID === currentSession)
      for (const child of children) {
        dismiss(`${deps.currentDir()}:${child.id}`)
      }
    })
  })
}
