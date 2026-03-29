// ─── Shared Pane Providers ───
export { PaneProviders } from "./shared/pane-providers"

// ─── Platform ───
export { usePlatform, PlatformProvider } from "./shared/platform"
export type { Platform } from "./shared/platform"

// ─── Server ───
export {
  useServer,
  ServerProvider,
  ServerConnection,
  normalizeServerUrl,
  serverName,
} from "./shared/server"

// ─── Server Utilities ───
export { createSdkForServer } from "./shared/server-util"
export { checkServerHealth, createCheckServerHealth } from "./shared/server-health"
export type { ServerHealth } from "./shared/server-health"

// ─── SDK ───
export { useSDK, SDKProvider } from "./shared/sdk"
export { useGlobalSDK, GlobalSDKProvider } from "./shared/global-sdk"

// ─── Route ───
export { usePaneRoute, PaneRouteProvider } from "./shared/pane-route"
export type { PaneRoute } from "./shared/pane-route"

// ─── Language ───
export { useLanguage, LanguageProvider, mergeHostDictionaries } from "./shared/language"
export type { Locale } from "./shared/language"

// ─── Settings ───
export { useSettings, SettingsProvider, monoFontFamily } from "./shared/settings"
export type { Settings, NotificationSettings, SoundSettings } from "./shared/settings"

// ─── Global Sync ───
export { useGlobalSync, GlobalSyncProvider } from "./shared/global-sync"

// ─── Sync ───
export {
  useSync,
  SyncProvider,
  mergeOptimisticPage,
  applyOptimisticAdd,
  applyOptimisticRemove,
} from "./shared/sync"

// ─── Models ───
export { useModels, ModelsProvider } from "./shared/models"
export type { ModelKey } from "./shared/models"

// ─── Prompt ───
export {
  usePrompt,
  PromptProvider,
  isPromptEqual,
  DEFAULT_PROMPT,
} from "./shared/prompt"
export type {
  ContentPart,
  TextPart,
  FileAttachmentPart,
  AgentPart,
  ImageAttachmentPart,
  Prompt,
  ContextItem,
  FileContextItem,
  FileSelection,
} from "./shared/prompt"

// ─── Permission ───
export { usePermission, PermissionProvider } from "./shared/permission"

// ─── Local ───
export { useLocal, LocalProvider } from "./shared/local"

// ─── Utilities ───
export { Persist, persisted, removePersisted, PersistTesting } from "./shared/persist"
export { toProjectID, toDirectory, __updateProjectRegistry } from "./shared/project-id"
export { formatServerError, parseReadableConfigInvalidError } from "./shared/server-errors"
export type { ConfigInvalidError, ProviderModelNotFoundError } from "./shared/server-errors"
export { useProviders, popularProviders } from "./shared/use-providers"
export {
  getConfiguredAgentVariant,
  resolveModelVariant,
  cycleModelVariant,
} from "./shared/model-variant"
export {
  acceptKey,
  directoryAcceptKey,
  isDirectoryAutoAccepting,
  autoRespondsPermission,
} from "./shared/permission-auto-respond"

// ─── Global Sync Sub-modules ───
export { getSessionPrefetch, SESSION_PREFETCH_TTL } from "./shared/global-sync/session-prefetch"
export type { State as GlobalSyncState, PathState, ProjectMeta } from "./shared/global-sync/types"
export type { InitError } from "./shared/global-sync/error-types"
