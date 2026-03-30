// ─── Chat Pane: Portable chat components ───

export { agentColor, messageAgentColor } from "./agent-color"
export type { PromptComment } from "./comment-note"
export { createCommentMetadata, formatCommentNote, parseCommentNote, readCommentMetadata } from "./comment-note"
// History window
export type { SessionHistoryWindowInput } from "./history-window"
export { createSessionHistoryWindow, emptyUserMessages } from "./history-window"
export { normalizeWheelDelta, shouldMarkBoundaryGesture } from "./message-gesture"
export { MessageTimeline } from "./message-timeline"
// Utilities
export { same } from "./same"
// Components
export { SessionTitleBar } from "./session-title-bar"
// Timeline staging
export type { StageConfig, TimelineStageInput } from "./timeline-staging"
export { createTimelineStaging } from "./timeline-staging"
