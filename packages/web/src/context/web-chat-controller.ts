import type { Session } from "@liteai/sdk/client"
import type { ChatController, ProjectInfo, SessionController } from "@liteai/ui/panes"
import { produce } from "solid-js/store"
import { useGlobalSDK } from "../context/global-sdk"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useProviders } from "../hooks/use-providers"

/**
 * Creates a ChatController backed by the web app's useSync() + useSDK().
 *
 * This adapter wraps the existing sync/sdk infrastructure into the abstract
 * ChatController interface, allowing chat components to read data without
 * knowing about the HTTP/SSE implementation underneath.
 */
export function createWebChatController(): ChatController {
  const sync = useSync()
  const sdk = useSDK()
  const globalSdk = useGlobalSDK()
  const providers = useProviders()

  return {
    messages(sessionID: string) {
      return sync.data.message[sessionID] ?? []
    },
    messagesReady(sessionID: string) {
      return sync.data.message[sessionID] !== undefined
    },
    parts(messageID: string) {
      return sync.data.part[messageID] ?? []
    },
    sessionStatus(sessionID: string) {
      return sync.data.session_status[sessionID] ?? { type: "idle" }
    },
    agents() {
      return sync.data.agent
    },
    session: {
      get(sessionID: string) {
        return sync.session.get(sessionID)
      },
      sync(sessionID: string) {
        return sync.session.sync(sessionID)
      },
      history: {
        more(sessionID: string) {
          return sync.session.history.more(sessionID)
        },
        loading(sessionID: string) {
          return sync.session.history.loading(sessionID)
        },
        loadMore(sessionID: string) {
          return sync.session.history.loadMore(sessionID)
        },
      },
    },
    config() {
      return sync.data.config
    },
    directory() {
      return sdk.directory
    },
    projectID() {
      return sdk.projectID
    },
    sessions() {
      return sync.data.session ?? []
    },
    project(): ProjectInfo | undefined {
      const p = sync.project
      if (!p) return undefined
      return {
        worktree: p.worktree,
        sandboxes: p.sandboxes,
        time: p.time,
      }
    },
    vcs() {
      return sync.data.vcs
    },
    shareEnabled() {
      return sync.data.config.share !== "disabled"
    },
    commands() {
      return sync.data.command
    },
    hasPaidProviders() {
      return providers.paid().length > 0
    },
    events: {
      subscribe(eventType: string, callback: (payload: unknown) => void) {
        return globalSdk.event.on(sdk.directory, (payload: { type?: string; properties?: unknown }) => {
          if (payload.type === eventType) {
            callback(payload.properties)
          }
        })
      },
    },
  }
}

/**
 * Creates a SessionController backed by the web app's useSync() + useSDK().
 *
 * Handles both the API call and optimistic local-store updates, matching
 * the behavior that was previously inline in SessionTitleBar.
 */
export function createWebSessionController(): SessionController {
  const sync = useSync()
  const sdk = useSDK()

  return {
    async rename(sessionID: string, title: string) {
      await sdk.client.project.session.update({
        sessionID,
        title,
        projectID: sdk.projectID,
      })
      sync.set(
        produce((draft) => {
          const index = draft.session.findIndex((s: Session) => s.id === sessionID)
          if (index !== -1) draft.session[index].title = title
        }),
      )
    },

    async archive(sessionID: string) {
      await sdk.client.project.session.update({
        sessionID,
        time: { archived: Date.now() },
        projectID: sdk.projectID,
      })
      sync.set(
        produce((draft) => {
          const index = draft.session.findIndex((s: Session) => s.id === sessionID)
          if (index !== -1) draft.session.splice(index, 1)
        }),
      )
    },

    async delete(sessionID: string): Promise<boolean> {
      const result = await sdk.client.project.session
        .delete({ sessionID, projectID: sdk.projectID })
        .then((x) => x.data)
        .catch(() => false)

      if (!result) return false

      sync.set(
        produce((draft) => {
          const removed = new Set<string>([sessionID])

          const byParent = new Map<string, string[]>()
          for (const item of draft.session) {
            const parentID = (item as Session).parentID
            if (!parentID) continue
            const existing = byParent.get(parentID)
            if (existing) {
              existing.push((item as Session).id)
              continue
            }
            byParent.set(parentID, [(item as Session).id])
          }

          const stack = [sessionID]
          while (stack.length) {
            const parentID = stack.pop()
            if (!parentID) continue

            const children = byParent.get(parentID)
            if (!children) continue

            for (const child of children) {
              if (removed.has(child)) continue
              removed.add(child)
              stack.push(child)
            }
          }

          draft.session = draft.session.filter((s: Session) => !removed.has(s.id))
        }),
      )

      return true
    },

    async share(sessionID: string) {
      await sdk.client.project.session.share({
        sessionID,
        projectID: sdk.projectID,
      })
    },

    async unshare(sessionID: string) {
      await sdk.client.project.session.unshare({
        sessionID,
        projectID: sdk.projectID,
      })
    },
  }
}
