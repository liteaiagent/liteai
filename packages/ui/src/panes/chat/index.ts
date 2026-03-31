// ─── Chat Pane: Portable chat components ───

export { agentColor, messageAgentColor } from "./agent-color"
export { ChatModelSelector } from "./chat-model-selector"
export { ChatNewSession } from "./chat-new-session"
// ─── Chat Pane: New portable components ───
export { ChatPane } from "./chat-pane"
export type {
  ChatCommandOption,
  ChatCommentFocus,
  ChatPromptCommentActions,
  ChatPromptCommands,
  ChatPromptSubmitHandler,
} from "./chat-prompt-input"
export { ChatPromptInput } from "./chat-prompt-input"
export type { PromptComment } from "./comment-note"
export { createCommentMetadata, formatCommentNote, parseCommentNote, readCommentMetadata } from "./comment-note"
// History window
export type { SessionHistoryWindowInput } from "./history-window"
export { createSessionHistoryWindow, emptyUserMessages } from "./history-window"
export { normalizeWheelDelta, shouldMarkBoundaryGesture } from "./message-gesture"
export { MessageTimeline } from "./message-timeline"
export {
  canNavigateHistoryAtCursor,
  clonePromptHistoryComments,
  clonePromptParts,
  createPromptAttachments,
  MAX_HISTORY,
  navigatePromptHistory,
  normalizePromptHistoryEntry,
  prependHistoryEntry,
  promptLength,
} from "./prompt-input"
export type { PromptHistoryComment, PromptHistoryEntry, PromptHistoryStoredEntry } from "./prompt-input/history"
// ─── Prompt Input: Portable sub-modules ───
export type { AtOption, SlashCommand } from "./prompt-input/slash-popover"
// Utilities
export { same } from "./same"
// Components
export { SessionTitleBar } from "./session-title-bar"
// Timeline staging
export type { StageConfig, TimelineStageInput } from "./timeline-staging"
export { createTimelineStaging } from "./timeline-staging"
