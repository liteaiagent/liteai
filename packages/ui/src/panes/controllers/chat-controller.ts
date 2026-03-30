import type { Agent, Config, Message, Part, Session, SessionStatus, VcsInfo } from "@liteai/sdk/client"

/**
 * ChatController — abstract interface for reading chat/session data.
 *
 * Components in `packages/ui/src/panes/chat/` depend on this interface
 * rather than directly calling `useSync()` / `useSDK()`. Implementations
 * are provided by the host platform (Web, VSCode, etc.).
 */
export interface ChatController {
  // ─── Messages ───

  /** Reactive list of messages for a session. Returns `[]` if not loaded. */
  messages(sessionID: string): Message[]

  /** Whether messages for the session have been fetched (may be empty but loaded). */
  messagesReady(sessionID: string): boolean

  /** Reactive list of parts for a message.  Returns `[]` if not loaded. */
  parts(messageID: string): Part[]

  /** Reactive session status (idle / running / etc.). */
  sessionStatus(sessionID: string): SessionStatus

  // ─── Agents ───

  /** Reactive list of agents configured for the current project. */
  agents(): Agent[]

  // ─── Session CRUD ───

  session: {
    /** Get session metadata by ID. */
    get(sessionID: string): Session | undefined

    /** Ensure session data is loaded (fetches if missing). */
    sync(sessionID: string): Promise<void>

    /** Pagination for message history within a session. */
    history: {
      /** Whether there are more messages to load before the current range. */
      more(sessionID: string): boolean

      /** Whether a history load request is in-flight. */
      loading(sessionID: string): boolean

      /** Fetch the next page of older messages. */
      loadMore(sessionID: string): Promise<void>
    }
  }

  // ─── Project context ───

  /** Reactive project config. */
  config(): Config

  /** Current project directory path. */
  directory(): string

  /** Current project ID. */
  projectID(): string

  /** Reactive list of sessions in the project. */
  sessions(): Session[]

  /** Reactive project metadata (worktree, sandboxes, timestamps). */
  project(): ProjectInfo | undefined

  /** Reactive VCS info (branch, etc.). */
  vcs(): VcsInfo | undefined

  /** Whether sharing is enabled for this project. */
  shareEnabled(): boolean
}

/** Subset of project data needed by chat components. */
export type ProjectInfo = {
  worktree?: string
  sandboxes?: string[]
  time: { created: number; updated?: number }
}
