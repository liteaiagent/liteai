// ─── Controller Interfaces ───

// ─── Shared Pane Providers ───
export * from "./chat/index"
export type {
  ChatController,
  ModelController,
  ModelInfo,
  PermissionController,
  ProjectInfo,
  SelectionController,
  SessionController,
} from "./controllers"
export {
  ChatContextProvider,
  useChatController,
  usePermissionController,
  useSelectionController,
  useSessionController,
} from "./controllers"
// ─── File Types ───
export type { SelectedLineRange } from "./shared/file-types"
export { selectionFromLines } from "./shared/file-types"

export type { Locale } from "./shared/language"
// ─── Language ───
export { LanguageProvider, mergeHostDictionaries, useLanguage } from "./shared/language"

export {
  cycleModelVariant,
  getConfiguredAgentVariant,
  resolveModelVariant,
} from "./shared/model-variant"

export { PaneProviders } from "./shared/pane-providers"
export type { PaneRoute } from "./shared/pane-route"
// ─── Route ───
export { PaneRouteProvider, usePaneRoute } from "./shared/pane-route"

// ─── Utilities ───
export { Persist, PersistTesting, persisted, removePersisted } from "./shared/persist"
export type { Platform } from "./shared/platform"
// ─── Platform ───
export { PlatformProvider, usePlatform } from "./shared/platform"
export { __updateProjectRegistry, toDirectory, toProjectID } from "./shared/project-id"
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
} from "./shared/prompt"
// ─── Prompt ───
export {
  DEFAULT_PROMPT,
  isPromptEqual,
  PromptProvider,
  usePrompt,
} from "./shared/prompt"

export type { NotificationSettings, Settings, SoundSettings } from "./shared/settings"
// ─── Settings ───
export { monoFontFamily, SettingsProvider, useSettings } from "./shared/settings"

// ─── UUID ───
export { uuid } from "./shared/uuid"
