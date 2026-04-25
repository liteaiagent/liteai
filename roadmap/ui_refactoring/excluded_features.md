# CLI TUI Migration — Permanently Excluded Features

MVP features that are **never** being ported. These were gated behind feature flags, internal-only tooling, or experimental systems that have no place in the new architecture.

> [!NOTE]
> This list exists so future developers don't wonder "where did X go?" — it was intentionally excluded.

---

## Permanently Excluded (MVP Feature-Flagged)

| Feature | MVP Source | Reason |
|---|---|---|
| Voice Mode | `hooks/useVoiceEnabled.ts`, `context/voice.ts`, `VoiceIndicator.tsx` | `feature('VOICE_MODE')` |
| Coordinator Mode | `coordinator/coordinatorMode.ts`, `CoordinatorAgentStatus.tsx` | `feature('COORDINATOR_MODE')` |
| Bridge Mode | `bridge/`, `BridgeDialog.tsx`, `BridgeStatusIndicator` | `feature('BRIDGE_MODE')` |
| Proactive/Kairos | `proactive/index.ts`, `ProactiveCountdown` | `feature('PROACTIVE')` / `feature('KAIROS')` |
| Transcript Classifier (auto mode) | `utils/permissions/PermissionMode.ts` line 80-90 | `feature('TRANSCRIPT_CLASSIFIER')` |
| Native Clipboard Image | `utils/imagePaste.ts` lines 101-116 | `feature('NATIVE_CLIPBOARD_IMAGE')` |
| Agent Swarms | `utils/agentSwarmsEnabled.ts`, `TeamStatus.tsx`, `TeamsDialog.tsx` | `isAgentSwarmsEnabled()` |
| Tungsten/Tmux | `TungstenPill`, tmux session state | `"external" === 'ant'` |
| PR Badge | `PrBadge.tsx`, `usePrStatus.ts` | `isPrStatusEnabled()` |
| Undercover mode | `utils/undercover.ts` | Ant-internal |
| Auto-updater | `utils/autoUpdater.ts`, `AutoUpdaterWrapper.tsx` | MVP auto-update system |
| IDE integration | `IdeStatusIndicator.tsx`, `useIdeAtMentioned.ts` | MVP IDE coupling |
| GrowthBook feature flags | `services/analytics/growthbook.ts` | MVP analytics |
| Background Task Status | `BackgroundTaskStatus` component | Coordinator/teammate-specific |
| API Key Status Display | `ApiKeyStatus` inline component | MVP-specific key verification |
| MCP Server Connection Display | `MCPServerConnection` inline component | MVP-specific MCP status |
| Fullscreen Overlay System | `isFullscreenEnvEnabled()` branches | xterm.js fullscreen mode |
| Selection Hints | `useHasSelection` / selection hints | Fullscreen xterm.js selection |
