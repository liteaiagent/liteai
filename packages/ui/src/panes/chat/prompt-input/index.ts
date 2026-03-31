// ─── Portable prompt-input sub-modules ───

export { type AddPartContext, addPartAtCursor } from "./add-part"
export { createPromptAttachments } from "./attachments"
export { PromptContextItems } from "./context-items"
export { PromptDragOverlay } from "./drag-overlay"
export { createTextFragment, getCursorPosition, setCursorPosition, setRangeEdge } from "./editor-dom"
export { createPill, isNormalizedEditor, parseFromDOM, reconcile, renderEditor } from "./editor-reconciler"
export { ACCEPTED_FILE_TYPES, ACCEPTED_IMAGE_TYPES, attachmentMime } from "./files"
export type {
  PromptHistoryComment,
  PromptHistoryEntry,
  PromptHistoryStoredEntry,
} from "./history"
export {
  canNavigateHistoryAtCursor,
  clonePromptHistoryComments,
  clonePromptParts,
  MAX_HISTORY,
  navigatePromptHistory,
  normalizePromptHistoryEntry,
  prependHistoryEntry,
  promptLength,
} from "./history"
export { PromptImageAttachments } from "./image-attachments"
export { createImeHandler, type ImeHandler } from "./ime-handler"
export { normalizePaste, pasteMode } from "./paste"
export { promptPlaceholder } from "./placeholder"
export type { AtOption, SlashCommand } from "./slash-popover"
export { PromptPopover } from "./slash-popover"
