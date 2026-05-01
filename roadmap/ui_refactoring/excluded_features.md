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

---

## Permanently Excluded Slash Commands (~40)

Commands whose **backing infrastructure** is permanently excluded above. These will never be ported.

| Command | Backing Feature | Reason |
|---|---|---|
| `/voice` | Voice Mode | Feature-flagged |
| `/teams`, `/swarm` | Agent Swarms / Coordinator | Feature-flagged |
| `/bridge` | Bridge Mode | Feature-flagged |
| `/background`, `/inbox` | Background Tasks (Coordinator) | Coordinator-dependent |
| `/dream` | Proactive/Kairos | Feature-flagged |
| `/tungsten`, `/tmux` | Tungsten/Tmux | Ant-internal |
| `/login`, `/logout` | OAuth / API Key Flow | LiteAI uses provider-level config, not in-CLI auth |
| `/pr`, `/review-pr` | PR Badge | Feature-gated |
| `/ide`, `/open-in-ide` | IDE Integration | MVP IDE coupling — LiteAI has VSCode extension instead |
| `/share` | Session Sharing | No sharing backend in LiteAI |
| `/upgrade` | Auto-updater | LiteAI uses package manager updates |
| `/release-notes` | Auto-updater | No in-CLI changelog system |
| `/sandbox` | Sandbox System | No sandboxing infrastructure |
| `/hooks` | Git Hooks System | Not ported to LiteAI core |
| `/branch` | Git branch management | Covered by agent tool use, not a TUI command |
| `/fast` | Fast mode toggle | LiteAI uses effort level in model config |
| `/output-style` | Output style picker | LiteAI uses theme system instead |
| `/copy` | Copy last message | Covered by message cursor mode (`c` key in cursor) |
| `/color` | Agent color picker | Agent Swarms excluded |
| `/tag` | Session tagging | No tagging backend |
| `/usage` | Usage reporting / analytics | GrowthBook excluded |
| `/rename` (full) | Session rename wizard | Basic rename exists via `dialog-session-rename.tsx` |

> [!NOTE]
> This accounts for ~40 of the ~85 commands identified in v1 gap analysis as "missing". The remaining ~30 commands are addressed in the active roadmap (Phases 4–5) or map to existing LiteAI dialogs.
