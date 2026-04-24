import type { ReactNode } from 'react'

export interface AnalyticsPort {
  logEvent: (eventName: string, metadata: Record<string, boolean | number | string | undefined>) => void
  logEventAsync: (eventName: string, metadata: Record<string, boolean | number | string | undefined>) => Promise<void>
}

export type Priority = 'low' | 'medium' | 'high' | 'immediate'

export interface Notification {
  key: string
  /**
   * Keys of notifications that this notification invalidates.
   */
  invalidates?: string[]
  priority: Priority
  timeoutMs?: number
  /**
   * Combine notifications with the same key.
   */
  fold?: (accumulator: Notification, incoming: Notification) => Notification
  text?: string
  jsx?: ReactNode
  color?: string
}

export interface NotificationPort {
  addNotification: (notification: Notification) => void
  removeNotification: (key: string) => void
}

export interface ScrollBoxHandle {
  scrollTo: (y: number) => void
  scrollBy: (dy: number) => void
  scrollToElement: (el: HTMLElement | null, offset?: number) => void
  scrollToBottom: () => void
  getScrollTop: () => number
  getPendingDelta: () => number
  getScrollHeight: () => number
  getFreshScrollHeight: () => number
  getViewportHeight: () => number
  getViewportTop: () => number
  isSticky: () => boolean
  subscribe: (listener: () => void) => () => void
  setClampBounds: (min: number | undefined, max: number | undefined) => void
}

export type MessageType = 'user' | 'assistant' | 'system' | 'progress' | 'attachment'

export interface MessageBase {
  type: MessageType
  uuid: string
  timestamp: string
}

export interface AssistantMessage extends MessageBase {
  type: 'assistant'
  message: {
    id: string
    content: unknown[] // We'll keep this as unknown[] for now to avoid SDK dependency explosion
    model: string
    usage?: unknown
  }
  isVirtual?: boolean
  error?: unknown
  isApiErrorMessage?: boolean
}

export interface UserMessage extends MessageBase {
  type: 'user'
  message: {
    role: 'user'
    content: string | unknown[]
  }
  isMeta?: boolean
  isVirtual?: boolean
  toolUseResult?: unknown
}

export interface SystemMessage extends MessageBase {
  type: 'system'
  subtype: string
  content: string
  level: 'info' | 'warning' | 'error'
  toolUseID?: string
  isMeta?: boolean
}

export type Message = AssistantMessage | UserMessage | SystemMessage

export interface SystemInformationalMessage extends SystemMessage {
  type: 'system'
  subtype: 'informational'
}

/**
 * Subset of AppState needed by hooks.
 */
export interface AppState {
  verbose: boolean
  kairosEnabled: boolean
  thinkingEnabled?: boolean
  promptSuggestionEnabled: boolean
  notifications: {
    current: Notification | null
    queue: Notification[]
  }
  teamContext?: {
    teamName?: string
    selfAgentName?: string
  }
  messages: Message[]
}

export interface RemoteSessionConfig {
  sessionId: string
  getAccessToken: () => string
  orgUuid: string
  /** True if session was created with an initial prompt that's being processed */
  hasInitialPrompt?: boolean
  /**
   * When true, this client is a pure viewer. Ctrl+C/Escape do NOT send
   * interrupt to the remote agent; 60s reconnect timeout is disabled;
   * session title is never updated. Used by `claude assistant`.
   */
  viewerOnly?: boolean
}

export interface HistoryPage {
  /** Chronological order within the page. */
  events: unknown[] // SDKMessage[]
  /** Oldest event ID in this page → before_id cursor for next-older page. */
  firstId: string | null
  /** true = older events exist. */
  hasMore: boolean
}

export interface HistoryAuthCtx {
  baseUrl: string
  headers: Record<string, string>
}

export interface AssistantHistoryPorts {
  createHistoryAuthCtx: (sessionId: string) => Promise<HistoryAuthCtx>
  fetchLatestEvents: (ctx: HistoryAuthCtx) => Promise<HistoryPage | null>
  fetchOlderEvents: (ctx: HistoryAuthCtx, beforeId: string) => Promise<HistoryPage | null>
  convertSDKMessage: (
    ev: unknown,
    opts: { convertUserTextMessages: boolean; convertToolResults: boolean },
  ) => { type: 'message'; message: Message } | { type: 'ignored' } | unknown
  logForDebugging: (msg: string) => void
}

export interface LogPorts {
  recordTranscript: (
    slice: Message[],
    teamInfo: { teamName?: string; agentName?: string },
    parentHint?: string,
    allMessages?: Message[],
  ) => Promise<string | null>
  isAgentSwarmsEnabled: () => boolean
  cleanMessagesForLogging: (slice: Message[], allMessages: Message[]) => Message[]
  isChainParticipant: (m: Message) => boolean
}

export type PastedContent = {
  id: number
  type: 'text' | 'image'
  content: string
  mediaType?: string
  filename?: string
}

export interface HistoryEntry {
  display: string
  pastedContents?: Record<number, PastedContent>
}

export interface CommandHistoryPorts {
  getHistory: () => AsyncIterable<HistoryEntry>
  getModeFromInput: (input: string) => string
}

export interface AnimationPorts {
  useAnimationFrame: (interval: number | null) => [(el: HTMLElement | null) => void, number]
  useTerminalFocus: () => boolean
}

export interface SuggestionItem {
  id: string
  displayText: string
  description?: string
  metadata?: unknown
}

export type SuggestionType =
  | 'none'
  | 'command'
  | 'file'
  | 'directory'
  | 'agent'
  | 'slack-channel'
  | 'shell'
  | 'custom-title'

export interface InlineGhostText {
  text: string
  fullCommand: string
  insertPosition: number
}

export interface TypeaheadPorts {
  generateCommandSuggestions: (input: string, commands: unknown[]) => SuggestionItem[]
  generateUnifiedSuggestions: (
    token: string,
    mcpResources: unknown,
    agents: unknown,
    isAtSymbol: boolean,
  ) => Promise<SuggestionItem[]>
  getShellCompletions: (input: string, cursorOffset: number, signal?: AbortSignal) => Promise<SuggestionItem[]>
  getShellHistoryCompletion: (input: string) => Promise<{ suffix: string; fullCommand: string } | null>
  getSlackChannelSuggestions: (clients: unknown, partial: string) => Promise<SuggestionItem[]>
  getDirectoryCompletions: (partial: string) => Promise<SuggestionItem[]>
  getPathCompletions: (partial: string, options: { maxResults: number }) => Promise<SuggestionItem[]>
  searchSessionsByCustomTitle: (partial: string, options: { limit: number }) => Promise<unknown[]>
  logEvent: (name: string, metadata: unknown) => void
}

export interface ClipboardPorts {
  hasImageInClipboard: () => Promise<boolean>
  getShortcutDisplay: (action: string, context: string, fallback: string) => string
}

export interface Key {
  upArrow: boolean
  downArrow: boolean
  leftArrow: boolean
  rightArrow: boolean
  pageDown: boolean
  pageUp: boolean
  wheelUp: boolean
  wheelDown: boolean
  home: boolean
  end: boolean
  return: boolean
  escape: boolean
  ctrl: boolean
  shift: boolean
  fn: boolean
  tab: boolean
  backspace: boolean
  delete: boolean
  meta: boolean
  super: boolean
}

export interface KeybindingPorts {
  useKeybinding: (
    action: string,
    handler: () => void | false | Promise<void>,
    options?: { context?: string; isActive?: boolean },
  ) => void
  useKeybindings: (
    handlers: Record<string, () => void | false | Promise<void>>,
    options?: { context?: string; isActive?: boolean },
  ) => void
}

export interface VirtualScrollPorts {
  getElementHeight: (el: HTMLElement | null) => number
  getElementTop: (el: HTMLElement | null) => number
}

export interface AppStateStore {
  getState: () => AppState
  setState: (updater: (prev: AppState) => AppState) => void
  subscribe: (listener: () => void) => () => void
}
