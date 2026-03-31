// ─── Controller interfaces ───

// ─── Chat context ───
export {
  ChatContextProvider,
  useChatController,
  usePermissionController,
  useSelectionController,
  useSessionController,
} from "./chat-context"
export type { ChatController, ProjectInfo } from "./chat-controller"
export type { ModelController, ModelInfo, ModelKey } from "./model-controller"
export type { PermissionController } from "./permission-controller"
// ─── Prompt types (re-export for convenience) ───
export type {
  AgentPart,
  ContentPart,
  ContextItem,
  FileAttachmentPart,
  FileContextItem,
  FileSelection,
  ImageAttachmentPart,
  Prompt,
  TextPart,
} from "./prompt-controller"
export type { SelectionController } from "./selection-controller"
export type { SessionController } from "./session-controller"
