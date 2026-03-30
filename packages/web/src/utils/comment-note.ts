// Re-export from @liteai/ui/panes/chat for backward compatibility.
// The pane version uses FileSelection from panes/shared/prompt (structurally identical).
export type { PromptComment } from "@liteai/ui/panes/chat"
export { createCommentMetadata, formatCommentNote, parseCommentNote, readCommentMetadata } from "@liteai/ui/panes/chat"
