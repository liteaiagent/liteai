// ─── Controller interfaces ───

// ─── Chat context ───
export { ChatContextProvider, useChatController, useSessionController } from "./chat-context"
export type { ChatController, ProjectInfo } from "./chat-controller"
export type { ModelController, ModelInfo, ModelKey } from "./model-controller"

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
export type { SessionController } from "./session-controller"
