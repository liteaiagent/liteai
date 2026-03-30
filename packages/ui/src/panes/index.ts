// ─── Shared Pane Providers ───

// ─── File Types ───
export type { SelectedLineRange } from "./shared/file-types"
export { selectionFromLines } from "./shared/file-types"
export { GlobalSDKProvider, useGlobalSDK } from "./shared/global-sdk"
// ─── Global Sync ───
export { GlobalSyncProvider, useGlobalSync } from "./shared/global-sync"
export type { InitError } from "./shared/global-sync/error-types"
// ─── Global Sync Sub-modules ───
export { getSessionPrefetch, SESSION_PREFETCH_TTL } from "./shared/global-sync/session-prefetch"
export type { PathState, ProjectMeta, State as GlobalSyncState } from "./shared/global-sync/types"
export type { Locale } from "./shared/language"
// ─── Language ───
export { LanguageProvider, mergeHostDictionaries, useLanguage } from "./shared/language"
// ─── Local ───
export { LocalProvider, useLocal } from "./shared/local"
export {
  cycleModelVariant,
  getConfiguredAgentVariant,
  resolveModelVariant,
} from "./shared/model-variant"
export type { ModelKey } from "./shared/models"
// ─── Models ───
export { ModelsProvider, useModels } from "./shared/models"
export { PaneProviders } from "./shared/pane-providers"
export type { PaneRoute } from "./shared/pane-route"
// ─── Route ───
export { PaneRouteProvider, usePaneRoute } from "./shared/pane-route"
// ─── Permission ───
export { PermissionProvider, usePermission } from "./shared/permission"
export {
  acceptKey,
  autoRespondsPermission,
  directoryAcceptKey,
  isDirectoryAutoAccepting,
} from "./shared/permission-auto-respond"
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
// ─── SDK ───
export { SDKProvider, useSDK } from "./shared/sdk"
// ─── Server ───
export {
  normalizeServerUrl,
  ServerConnection,
  ServerProvider,
  serverName,
  useServer,
} from "./shared/server"
export type { ConfigInvalidError, ProviderModelNotFoundError } from "./shared/server-errors"
export { formatServerError, parseReadableConfigInvalidError } from "./shared/server-errors"
export type { ServerHealth } from "./shared/server-health"
export { checkServerHealth, createCheckServerHealth } from "./shared/server-health"
// ─── Server Utilities ───
export { createSdkForServer } from "./shared/server-util"
export type { NotificationSettings, Settings, SoundSettings } from "./shared/settings"
// ─── Settings ───
export { monoFontFamily, SettingsProvider, useSettings } from "./shared/settings"
// ─── Sync ───
export {
  applyOptimisticAdd,
  applyOptimisticRemove,
  mergeOptimisticPage,
  SyncProvider,
  useSync,
} from "./shared/sync"
export { popularProviders, useProviders } from "./shared/use-providers"
// ─── UUID ───
export { uuid } from "./shared/uuid"
