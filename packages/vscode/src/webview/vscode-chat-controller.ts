import type { Agent, Config, Message, Session, SessionStatus, VcsInfo } from "@liteai/sdk/client"
import type { ChatController, ProjectInfo, SessionController } from "@liteai/ui/panes"

/**
 * VSCode ChatController — lightweight implementation for the extension webview.
 *
 * Phase 1: Provides a minimal stub that allows the ChatPane to render.
 * Phase 3: This will be replaced with a full implementation that communicates
 * with the Extension Host via postMessage for real data.
 */
export function createVscodeChatController(opts: {
  serverUrl: string
  directory?: string
  projectID?: string
}): ChatController {
  const emptyMessages: Message[] = []
  const emptyAgents: Agent[] = []
  const emptySessions: Session[] = []
  const idleStatus: SessionStatus = { type: "idle" }
  const defaultConfig = {} as Config

  return {
    messages(_sessionID: string) {
      return emptyMessages
    },
    messagesReady(_sessionID: string) {
      return true
    },
    parts(_messageID: string) {
      return []
    },
    sessionStatus(_sessionID: string) {
      return idleStatus
    },
    agents() {
      return emptyAgents
    },
    session: {
      get(_sessionID: string) {
        return undefined
      },
      async sync(_sessionID: string) {
        // No-op in stub — Phase 3 will fetch via HTTP
      },
      history: {
        more(_sessionID: string) {
          return false
        },
        loading(_sessionID: string) {
          return false
        },
        async loadMore(_sessionID: string) {
          // No-op in stub
        },
      },
    },
    config() {
      return defaultConfig
    },
    directory() {
      return opts.directory ?? ""
    },
    projectID() {
      return opts.projectID ?? ""
    },
    sessions() {
      return emptySessions
    },
    project(): ProjectInfo | undefined {
      return undefined
    },
    vcs(): VcsInfo | undefined {
      return undefined
    },
    shareEnabled() {
      return false
    },
  }
}

/**
 * VSCode SessionController — lightweight stub for the extension webview.
 */
export function createVscodeSessionController(_opts: { serverUrl: string }): SessionController {
  return {
    async rename(_sessionID: string, _title: string) {
      console.log("[vscode] SessionController.rename not yet implemented")
    },
    async archive(_sessionID: string) {
      console.log("[vscode] SessionController.archive not yet implemented")
    },
    async delete(_sessionID: string): Promise<boolean> {
      console.log("[vscode] SessionController.delete not yet implemented")
      return false
    },
    async share(_sessionID: string) {
      console.log("[vscode] SessionController.share not yet implemented")
    },
    async unshare(_sessionID: string) {
      console.log("[vscode] SessionController.unshare not yet implemented")
    },
  }
}
