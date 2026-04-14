# LiteAI2 Analysis Audit — Coverage Tracker

> **Last updated:** 2026-04-07  
> **Purpose:** Track exactly what has and hasn't been analyzed from liteai_cli_mvp.  
> **liteai_cli_mvp root:** `C:\Users\aghassan\Documents\workspace\liteai_cli_mvp`  
> **All paths below are relative to:** `liteai_cli_mvp/src/`

---

## ✅ Fully Analyzed — Files We Read & Documented

These files were opened, analyzed, and their architectures documented in the corresponding doc files.

### Doc 01 — Subagent Architecture (`01-subagent-architecture.md`)

| File | Size | What We Extracted |
|------|------|-------------------|
| `utils/forkedAgent.ts` | 24KB | Context forking, CacheSafeParams, prompt cache stability, runForkedAgent() |
| `tools/AgentTool/` (directory) | ~40KB | AgentTool.runAgent(), context sharing, pruning, MCP init, isolated execution |

### Doc 02 — Plan Mode (`02-plan-mode.md`)

| File | Size | What We Extracted |
|------|------|-------------------|
| `tools/EnterPlanModeTool/` (directory) | ~15KB | Plan mode entry, attachment-based state machine |
| `tools/ExitPlanModeTool/` (directory) | ~10KB | Plan mode exit, plan verification |
| `tools/VerifyPlanExecutionTool/` (directory) | ~10KB | Plan execution verification |

### Doc 03 — Tools Architecture (`03-tools-architecture.md`)

| File | Size | What We Extracted |
|------|------|-------------------|
| `tools.ts` | 17KB | `getAllBaseTools()`, feature-flag gating, DCE-enabled lazy loading, conditional tool registration |
| `Tool.ts` | 29KB | Tool type definitions, tool matching, MCP tool integration |
| `utils/toolPool.ts` | 3KB | `assembleToolPool()`, MCP merging, cache-stable sorting |

### Doc 04 — Skills System (`04-skills-system.md`)

| File | Size | What We Extracted |
|------|------|-------------------|
| `tools/SkillTool/` (directory) | ~20KB | Forked skill execution, two-tier system |
| `tools/DiscoverSkillsTool/` (directory) | ~15KB | Skill discovery, listing, registration |
| `services/skillSearch/` (7 files, all stubs ~132B) | ~1KB | Skill search — stubs only (DCE-excluded) |

### Doc 05 — Prompt System (`05-prompt-system.md`)

| File | Size | What We Extracted |
|------|------|-------------------|
| `utils/systemPrompt.ts` | 5KB | System prompt assembly |
| `utils/queryContext.ts` | 6KB | `fetchSystemPromptParts()`, user context, system context |
| Main prompt files (various locations) | ~30KB | `DANGEROUS_uncachedSystemPromptSection()`, `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, cache boundary patterns |

### Doc 06 — Memory, Dream Engine, KAIROS (`06-memory-dream-kairos.md`)

| File | Size | What We Extracted |
|------|------|-------------------|
| `services/autoDream/autoDream.ts` | 12KB | Dream gate logic, lock management, forked agent execution |
| `services/autoDream/consolidationPrompt.ts` | 3KB | 4-phase consolidation prompt structure |
| `memdir/` (directory) | ~40KB | Memory directory system, scoped memory, CLAUDE.md loading |
| `utils/memory/` (directory) | varies | Memory file detection, auto-managed paths |

### Doc 07 — Remaining Features (`07-remaining-features.md`)

| File | Size | What We Extracted |
|------|------|-------------------|
| `services/compact/autoCompact.ts` | 13KB | Token threshold check, circuit breaker, fork compaction |
| `services/compact/compact.ts` | 61KB | Full compaction engine (read headers only) |
| `services/compact/microCompact.ts` | 19KB | Per-turn lightweight compaction |
| `services/compact/sessionMemoryCompact.ts` | 21KB | Experimental session-memory-based compaction |
| `services/compact/postCompactCleanup.ts` | 4KB | Post-compaction cache/state reset |
| `services/contextCollapse/` (3 files, all stubs) | ~0.4KB | Stubs — experimental feature |
| `services/PromptSuggestion/speculation.ts` | 31KB | Speculative execution, overlay isolation, pipelining |
| `services/PromptSuggestion/promptSuggestion.ts` | 17KB | Post-turn prompt prediction |
| `utils/hooks.ts` | 159KB | Full hooks lifecycle engine (20+ events, all hook types) |
| `utils/worktree.ts` | 50KB | Git worktree creation, sparse checkout, tmux, cleanup |
| `coordinator/coordinatorMode.ts` | 19KB | Coordinator system prompt, worker orchestration |
| `utils/conversationRecovery.ts` | 21KB | Session resume, interruption detection, skill state restoration |
| `utils/toolResultStorage.ts` | 38KB | Tool result persistence, per-message budget, replacement state |
| `cost-tracker.ts` | 11KB | Per-model cost tracking, USD calculation, OTel counters |
| `utils/effort.ts` | 12KB | Effort levels, model defaults, persistence, env override |
| `services/SessionMemory/` (3 files) | 35KB | Session memory extraction, prompts, utilities |
| `services/AgentSummary/agentSummary.ts` | 6KB | Post-subagent summary generation |
| `utils/cronScheduler.ts` | 21KB | Persistent cron scheduling |
| `utils/cronTasks.ts` | 17KB | Cron task definitions |
| `utils/commitAttribution.ts` | 30KB | Git commit attribution hooks (read headers) |

### Files Read But Not Given Dedicated Documentation

These were opened during analysis for cross-reference but aren't the primary subject of any doc:

| File | Size | Why Read |
|------|------|----------|
| `utils/collapseReadSearch.ts` | 38KB | Checked during remaining features scan — UX grouping logic |
| `utils/fileHistory.ts` | 35KB | Checked during scan — file checkpoint/rewind system |
| `QueryEngine.ts` | 47KB | Checked during scan — core query lifecycle |
| `services/tools/toolExecution.ts` | 60KB | Cross-referenced during tools architecture |
| `utils/messages.ts` | 193KB | Cross-referenced for message normalization |
| `utils/attachments.ts` | 127KB | Cross-referenced for plan mode attachments |
| `utils/config.ts` | 63KB | Cross-referenced for configuration system |

---

## ❌ NOT YET ANALYZED — Organized by Priority

### Priority P0 — Permissions & Security

> **Total: ~320KB** — The single largest unanalyzed subsystem

| File | Size | Description |
|------|------|-------------|
| `utils/permissions/filesystem.ts` | 62KB | Filesystem permission rules, path allowlists, temp dir management |
| `utils/permissions/permissions.ts` | 52KB | Core permission checking engine, tool permission decisions |
| `utils/permissions/yoloClassifier.ts` | 52KB | YOLO mode classifier — auto-allow heuristics |
| `utils/permissions/permissionSetup.ts` | 53KB | Permission mode initialization and transition logic |
| `utils/permissions/pathValidation.ts` | 16KB | Path security validation, traversal prevention |
| `utils/permissions/PermissionUpdate.ts` | 12KB | Permission state updates and persistence |
| `utils/permissions/permissionRuleParser.ts` | 7KB | Rule parsing from settings/CLAUDE.md |
| `utils/permissions/shellRuleMatching.ts` | 6KB | Shell command pattern matching against rules |
| `utils/permissions/shadowedRuleDetection.ts` | 8KB | Detecting rules that shadow/override each other |
| `utils/permissions/permissionExplainer.ts` | 8KB | Human-readable permission explanations |
| `utils/permissions/permissionsLoader.ts` | 9KB | Loading permission rules from config sources |
| `utils/permissions/bypassPermissionsKillswitch.ts` | 5KB | Remote killswitch for bypass mode |
| `utils/permissions/classifierDecision.ts` | 5KB | Classifier result types and decisions |
| `utils/permissions/PermissionMode.ts` | 3KB | Permission mode types |
| `utils/permissions/PermissionPromptToolResultSchema.ts` | 4KB | Permission prompt schema |
| `utils/permissions/PermissionResult.ts` | 1KB | Permission result types |
| `utils/permissions/PermissionRule.ts` | 1KB | Permission rule types |
| `utils/permissions/PermissionUpdateSchema.ts` | 2KB | Update schema (Zod) |
| `utils/permissions/autoModeState.ts` | 1KB | Auto-mode tracking state |
| `utils/permissions/bashClassifier.ts` | 1KB | Bash command classification |
| `utils/permissions/classifierShared.ts` | 1KB | Shared classifier utilities |
| `utils/permissions/dangerousPatterns.ts` | 2KB | Dangerous command patterns |
| `utils/permissions/denialTracking.ts` | 1KB | Tracking denied permissions |
| `utils/permissions/getNextPermissionMode.ts` | 3KB | Permission mode progression |
| `services/policyLimits/index.ts` | 18KB | Organization policy enforcement |
| `services/policyLimits/types.ts` | 1KB | Policy types |

---

### Priority P1 — Swarm & Multi-Agent

> **Total: ~180KB** — Full multi-agent parallel execution

| File | Size | Description |
|------|------|-------------|
| `utils/swarm/inProcessRunner.ts` | 53KB | In-process agent runner for swarm teammates |
| `utils/swarm/permissionSync.ts` | 26KB | Leader-follower permission synchronization |
| `utils/swarm/teamHelpers.ts` | 21KB | Team/swarm helper utilities |
| `utils/swarm/It2SetupPrompt.tsx` | 43KB | iTerm2 setup prompt for swarm UI |
| `utils/swarm/spawnInProcess.ts` | 10KB | In-process agent spawning |
| `utils/swarm/spawnUtils.ts` | 5KB | Spawn utility functions |
| `utils/swarm/teammateInit.ts` | 4KB | Teammate initialization |
| `utils/swarm/teammateLayoutManager.ts` | 3KB | Tmux layout management for teammates |
| `utils/swarm/leaderPermissionBridge.ts` | 2KB | Leader permission bridging |
| `utils/swarm/reconnection.ts` | 3KB | Swarm reconnection handling |
| `utils/swarm/constants.ts` | 1KB | Swarm constants |
| `utils/swarm/teammateModel.ts` | 0.5KB | Teammate model config |
| `utils/swarm/teammatePromptAddendum.ts` | 0.8KB | Teammate prompt additions |
| `utils/swarm/backends/` (directory) | ~10KB | tmux + iTerm2 backends |

---

### Priority P1 — Tool Execution Engine

> **Total: ~105KB** — The runtime that actually executes tools

| File | Size | Description |
|------|------|-------------|
| `services/tools/toolExecution.ts` | 60KB | Core tool execution pipeline, parallel execution, error handling |
| `services/tools/toolHooks.ts` | 22KB | Pre/post tool hook integration with execution |
| `services/tools/StreamingToolExecutor.ts` | 17KB | Streaming tool result executor |
| `services/tools/toolOrchestration.ts` | 5KB | Tool orchestration and scheduling |

---

### Priority P1 — QueryEngine & Core Loop

> **Total: ~115KB** — The heart of the application

| File | Size | Description |
|------|------|-------------|
| `QueryEngine.ts` | 47KB | SDK/headless query lifecycle, session state management |
| `query.ts` | 69KB | Main API query loop, streaming, tool use cycle |

---

### Priority P1 — File History / Checkpoints

> **Total: ~35KB** — Undo/redo for AI edits

| File | Size | Description |
|------|------|-------------|
| `utils/fileHistory.ts` | 35KB | Per-message file snapshots, backup/restore, diff stats, rewind |

---

### Priority P2 — Telemetry & Tracing

> **Total: ~120KB**

| File | Size | Description |
|------|------|-------------|
| `utils/telemetry/perfettoTracing.ts` | 30KB | Perfetto trace export |
| `utils/telemetry/sessionTracing.ts` | 28KB | Session-level tracing |
| `utils/telemetry/instrumentation.ts` | 27KB | OTel instrumentation setup |
| `utils/telemetry/betaSessionTracing.ts` | 16KB | Beta session tracing |
| `utils/telemetry/pluginTelemetry.ts` | 10KB | Plugin telemetry collection |
| `utils/telemetry/bigqueryExporter.ts` | 8KB | BigQuery data export |
| `utils/telemetry/events.ts` | 2KB | Telemetry event types |
| `utils/telemetry/skillLoadedEvent.ts` | 1KB | Skill load event |
| `utils/telemetry/logger.ts` | 1KB | Telemetry logger |

---

### Priority P2 — Analytics & Feature Flags

> **Total: ~135KB**

| File | Size | Description |
|------|------|-------------|
| `services/analytics/growthbook.ts` | 40KB | GrowthBook feature flag integration |
| `services/analytics/metadata.ts` | 33KB | Analytics metadata collection |
| `services/analytics/firstPartyEventLoggingExporter.ts` | 26KB | Event log export pipeline |
| `services/analytics/firstPartyEventLogger.ts` | 15KB | First-party event logger |
| `services/analytics/index.ts` | 6KB | Analytics entry point |
| `services/analytics/datadog.ts` | 9KB | Datadog integration |
| `services/analytics/sink.ts` | 4KB | Analytics sinks |
| `services/analytics/config.ts` | 1KB | Analytics config |
| `services/analytics/sinkKillswitch.ts` | 1KB | Remote killswitch for analytics |

---

### Priority P2 — Team Memory Sync

> **Total: ~73KB**

| File | Size | Description |
|------|------|-------------|
| `services/teamMemorySync/index.ts` | 44KB | Team memory synchronization engine |
| `services/teamMemorySync/watcher.ts` | 13KB | File watcher for team memory changes |
| `services/teamMemorySync/secretScanner.ts` | 9KB | Secret detection in memory files |
| `services/teamMemorySync/types.ts` | 5KB | Team memory types |
| `services/teamMemorySync/teamMemSecretGuard.ts` | 2KB | Secret guard utilities |

---

### Priority P2 — LSP Service

> **Total: ~69KB**

| File | Size | Description |
|------|------|-------------|
| `services/lsp/LSPServerInstance.ts` | 17KB | LSP server instance management |
| `services/lsp/LSPClient.ts` | 14KB | LSP protocol client |
| `services/lsp/LSPServerManager.ts` | 13KB | Multi-server management |
| `services/lsp/LSPDiagnosticRegistry.ts` | 12KB | Diagnostic tracking and aggregation |
| `services/lsp/passiveFeedback.ts` | 11KB | Passive diagnostic feedback to model |
| `services/lsp/manager.ts` | 10KB | Manager utilities |
| `services/lsp/config.ts` | 3KB | LSP configuration |
| `services/lsp/types.ts` | 0.1KB | LSP types |

---

### Priority P2 — Plugins System

> **Total: ~52KB**

| File | Size | Description |
|------|------|-------------|
| `services/plugins/pluginOperations.ts` | 36KB | Plugin install, update, remove operations |
| `services/plugins/pluginCliCommands.ts` | 11KB | Plugin CLI command handling |
| `services/plugins/PluginInstallationManager.ts` | 6KB | Installation lifecycle |

---

### Priority P2 — Remote Managed Settings

> **Total: ~40KB**

| File | Size | Description |
|------|------|-------------|
| `services/remoteManagedSettings/index.ts` | 21KB | Remote settings sync engine |
| `services/remoteManagedSettings/securityCheck.tsx` | 10KB | Security validation for remote settings |
| `services/remoteManagedSettings/syncCache.ts` | 4KB | Sync state caching |
| `services/remoteManagedSettings/syncCacheState.ts` | 4KB | Cache state management |
| `services/remoteManagedSettings/types.ts` | 1KB | Settings types |

---

### Priority P2 — Sandbox Execution

> **Total: ~36KB**

| File | Size | Description |
|------|------|-------------|
| `utils/sandbox/sandbox-adapter.ts` | 36KB | Sandboxed execution adapter |
| `utils/sandbox/sandbox-ui-utils.ts` | 0.4KB | Sandbox UI utilities |

---

### Priority P2 — Extract Memories (separate from Dream)

> **Total: ~29KB**

| File | Size | Description |
|------|------|-------------|
| `services/extractMemories/extractMemories.ts` | 22KB | Memory extraction pipeline |
| `services/extractMemories/prompts.ts` | 8KB | Extraction prompt templates |

---

### Priority P3 — OAuth

> **Total: ~34KB**

| File | Size | Description |
|------|------|-------------|
| `services/oauth/client.ts` | 18KB | OAuth client implementation |
| `services/oauth/auth-code-listener.ts` | 7KB | Auth code callback listener |
| `services/oauth/index.ts` | 7KB | OAuth entry point |
| `services/oauth/getOauthProfile.ts` | 2KB | Profile fetching |
| `services/oauth/crypto.ts` | 0.6KB | PKCE crypto utilities |
| `services/oauth/types.ts` | 0.1KB | OAuth types |

---

### Priority P3 — MCP Service (very large, partially covered in doc 03)

> **Total: ~420KB** — Largest service, mostly connection management

| File | Size | Description |
|------|------|-------------|
| `services/mcp/client.ts` | 119KB | MCP client manager (massive!) |
| `services/mcp/auth.ts` | 89KB | MCP auth flows |
| `services/mcp/config.ts` | 51KB | MCP configuration loading |
| `services/mcp/useManageMCPConnections.ts` | 45KB | React hook for MCP connection management |
| `services/mcp/xaa.ts` | 18KB | XAA (cross-account auth) |
| `services/mcp/xaaIdpLogin.ts` | 16KB | XAA IDP login |
| `services/mcp/utils.ts` | 18KB | MCP utilities |
| `services/mcp/channelNotification.ts` | 13KB | Channel notification system |
| `services/mcp/elicitationHandler.ts` | 10KB | MCP elicitation handling |
| `services/mcp/channelPermissions.ts` | 9KB | Channel permission management |
| `services/mcp/types.ts` | 7KB | MCP types |
| `services/mcp/claudeai.ts` | 6KB | Claude.ai MCP integration |
| `services/mcp/headersHelper.ts` | 5KB | HTTP headers for MCP |
| `services/mcp/SdkControlTransport.ts` | 5KB | SDK control transport |
| `services/mcp/MCPConnectionManager.tsx` | 8KB | Connection manager component |
| `services/mcp/mcpStringUtils.ts` | 4KB | MCP string utilities |
| `services/mcp/vscodeSdkMcp.ts` | 4KB | VS Code MCP bridge |
| `services/mcp/channelAllowlist.ts` | 3KB | Channel allowlisting |
| `services/mcp/oauthPort.ts` | 2KB | OAuth port management |
| `services/mcp/InProcessTransport.ts` | 2KB | In-process transport |
| `services/mcp/officialRegistry.ts` | 2KB | Official MCP server registry |
| `services/mcp/normalization.ts` | 1KB | MCP normalization |

---

### Priority P3 — API Service

> **Total: ~360KB** — Core API communication

| File | Size | Description |
|------|------|-------------|
| `services/api/claude.ts` | 126KB | Main Claude API client (streaming, tool use cycle) |
| `services/api/errors.ts` | 42KB | API error classification and retry logic |
| `services/api/withRetry.ts` | 28KB | Retry policy engine |
| `services/api/promptCacheBreakDetection.ts` | 26KB | Prompt cache break detection |
| `services/api/logging.ts` | 24KB | API request/response logging |
| `services/api/filesApi.ts` | 21KB | Files API integration |
| `services/api/sessionIngress.ts` | 17KB | Session ingress handling |
| `services/api/client.ts` | 16KB | HTTP client setup |
| `services/api/grove.ts` | 12KB | Grove integration |
| `services/api/errorUtils.ts` | 8KB | Error utility functions |
| `services/api/referral.ts` | 8KB | Referral tracking |
| `services/api/dumpPrompts.ts` | 7KB | Prompt dumping for debugging |
| `services/api/overageCreditGrant.ts` | 5KB | Overage credit handling |
| `services/api/metricsOptOut.ts` | 5KB | Metrics opt-out |
| `services/api/bootstrap.ts` | 5KB | API bootstrap |
| `services/api/adminRequests.ts` | 3KB | Admin API requests |
| `services/api/firstTokenDate.ts` | 2KB | First token tracking |
| `services/api/usage.ts` | 2KB | Usage types |
| `services/api/ultrareviewQuota.ts` | 1KB | Ultra review quota |
| `services/api/emptyUsage.ts` | 1KB | Empty usage constant |

---

### Priority P3 — Remaining Services (smaller)

| File | Size | Description |
|------|------|-------------|
| `services/tokenEstimation.ts` | 17KB | Token count estimation |
| `services/voice.ts` | 17KB | Voice input/output |
| `services/voiceStreamSTT.ts` | 21KB | Voice streaming speech-to-text |
| `services/claudeAiLimits.ts` | 17KB | Claude.ai rate limit handling |
| `services/diagnosticTracking.ts` | 12KB | Diagnostic tracking service |
| `services/vcr.ts` | 12KB | VCR recording/replay |
| `services/rateLimitMessages.ts` | 11KB | Rate limit user messaging |
| `services/mockRateLimits.ts` | 30KB | Mock rate limiting for testing |
| `services/mcpServerApproval.tsx` | 6KB | MCP server approval UI |
| `services/notifier.ts` | 4KB | Notification service |
| `services/preventSleep.ts` | 5KB | Prevent system sleep during tasks |
| `services/rateLimitMocking.ts` | 4KB | Rate limit mocking utilities |
| `services/toolUseSummary/toolUseSummaryGenerator.ts` | 3KB | Tool use summary generation |
| `services/voiceKeyterms.ts` | 3KB | Voice key terms |
| `services/awaySummary.ts` | 3KB | Away summary generation |
| `services/internalLogging.ts` | 3KB | Internal logging service |
| `services/settingsSync/index.ts` | 18KB | Settings synchronization |
| `services/settingsSync/types.ts` | 2KB | Settings sync types |
| `services/tips/tipRegistry.ts` | 23KB | Contextual tip registry |
| `services/tips/tipScheduler.ts` | 2KB | Tip scheduling |
| `services/tips/tipHistory.ts` | 0.6KB | Tip display history |
| `services/tips/types.ts` | 0.1KB | Tips types |
| `services/MagicDocs/magicDocs.ts` | 8KB | Dynamic documentation generation |
| `services/MagicDocs/prompts.ts` | 6KB | MagicDocs prompts |
| `services/sessionTranscript/sessionTranscript.ts` | 0.1KB | Session transcript (stub) |

---

### Priority P3 — Large Utility Files (not yet analyzed)

> Key `utils/` files over 10KB that haven't been analyzed:

| File | Size | Description |
|------|------|-------------|
| `utils/messages.ts` | 193KB | Message normalization, filtering, creation (read partially) |
| `utils/teleport.tsx` | 176KB | Teleport system (conversation sharing) |
| `utils/sessionStorage.ts` | 181KB | Session persistence, transcript storage |
| `utils/attachments.ts` | 127KB | Attachment system (read partially for plan mode) |
| `utils/ansiToPng.ts` | 215KB | ANSI to PNG conversion (rendering) |
| `utils/hooks.ts` | 159KB | ✅ Already analyzed |
| `utils/auth.ts` | 65KB | Authentication system |
| `utils/config.ts` | 63KB | Global/project config (read partially) |
| `utils/worktree.ts` | 50KB | ✅ Already analyzed |
| `utils/status.tsx` | 49KB | Status bar system (mostly UI) |
| `utils/Cursor.ts` | 47KB | Cursor/editor integration |
| `utils/claudemd.ts` | 46KB | CLAUDE.md loading and parsing |
| `utils/ide.ts` | 47KB | IDE integration (VS Code, JetBrains) |
| `utils/analyzeContext.ts` | 43KB | Context window analysis |
| `utils/collapseReadSearch.ts` | 38KB | Read/search collapsing (read partially) |
| `utils/toolResultStorage.ts` | 38KB | ✅ Already analyzed |
| `utils/fileHistory.ts` | 35KB | Read but not documented in detail |
| `utils/stats.ts` | 34KB | Statistics tracking |
| `utils/teammateMailbox.ts` | 33KB | Teammate message passing |
| `utils/statusNoticeDefinitions.tsx` | 31KB | Status notice UI definitions |
| `utils/git.ts` | 30KB | Git operations |
| `utils/commitAttribution.ts` | 30KB | ✅ Already analyzed |
| `utils/api.ts` | 26KB | API utilities |
| `utils/theme.ts` | 27KB | Theme system |
| `utils/toolSearch.ts` | 27KB | Tool search/discovery |
| `utils/tasks.ts` | 26KB | Task management |
| `utils/imageResizer.ts` | 27KB | Image resizing for context |
| `utils/sessionStoragePortable.ts` | 25KB | Portable session storage |
| `utils/fsOperations.ts` | 24KB | Filesystem operations |
| `utils/ripgrep.ts` | 21KB | Ripgrep integration |
| `utils/cronScheduler.ts` | 21KB | ✅ Already analyzed |
| `utils/handlePromptSubmit.ts` | 22KB | Prompt submission handling |
| `utils/markdownConfigLoader.ts` | 21KB | Markdown config loading (CLAUDE.md) |
| `utils/conversationRecovery.ts` | 21KB | ✅ Already analyzed |
| `utils/doctorDiagnostic.ts` | 20KB | `claude doctor` diagnostic system |
| `utils/sessionRestore.ts` | 20KB | Session restore logic |
| `utils/gracefulShutdown.ts` | 20KB | Graceful shutdown handling |
| `utils/preflightChecks.tsx` | 19KB | Pre-flight checks before session |
| `utils/queryHelpers.ts` | 20KB | Query helper utilities |
| `utils/fastMode.ts` | 18KB | Fast mode / Haiku fallback |
| `utils/file.ts` | 18KB | File utility functions |
| `utils/autoUpdater.ts` | 18KB | Auto-update system |
| `utils/cleanup.ts` | 18KB | Cleanup utilities |
| `utils/Shell.ts` | 17KB | Shell management |
| `utils/cronTasks.ts` | 17KB | ✅ Already analyzed |
| `utils/gitDiff.ts` | 16KB | Git diff generation |
| `utils/messageQueueManager.ts` | 17KB | Message queue management |
| `utils/betas.ts` | 16KB | Beta feature flags |
| `utils/exportRenderer.tsx` | 17KB | Export rendering |
| `utils/imagePaste.ts` | 14KB | Image paste handling |
| `utils/ShellCommand.ts` | 14KB | Shell command execution |
| `utils/statsCache.ts` | 14KB | Statistics caching |
| `utils/listSessionsImpl.ts` | 15KB | Session listing |
| `utils/attribution.ts` | 13KB | Attribution tracking |
| `utils/tmuxSocket.ts` | 14KB | Tmux socket management |
| `utils/proxy.ts` | 14KB | HTTP proxy support |
| `utils/frontmatterParser.ts` | 12KB | Frontmatter parsing |
| `utils/readFileInRange.ts` | 12KB | Ranged file reading |
| `utils/plans.ts` | 12KB | Plan management |
| `utils/staticRender.tsx` | 12KB | Static rendering |
| `utils/releaseNotes.ts` | 12KB | Release notes |
| `utils/markdown.ts` | 12KB | Markdown utilities |
| `utils/log.ts` | 12KB | Logging system |
| `utils/effort.ts` | 12KB | ✅ Already analyzed |

---

### Priority P3 — Remaining Top-Level Source

| File / Directory | Size | Description |
|---|---|---|
| `main.tsx` | 803KB | Main REPL application (Ink/React — mostly UI) |
| `interactiveHelpers.tsx` | 57KB | Interactive helper components (UI) |
| `dialogLaunchers.tsx` | 23KB | Dialog launcher components (UI) |
| `commands.ts` | 24KB | Slash command definitions |
| `history.ts` | 14KB | Command history management |
| `setup.ts` | 21KB | Setup/onboarding flow |
| `context.ts` | 6KB | Context utilities |
| `costHook.ts` | 1KB | Cost tracking React hook |
| `projectOnboardingState.ts` | 2KB | Onboarding state |
| `tasks.ts` | 1KB | Task types |
| `Task.ts` | 3KB | Task class definition |
| `replLauncher.tsx` | 4KB | REPL launcher |
| `env.d.ts` | 1KB | Environment type declarations |
| `components/` (directory) | large | React/Ink UI components (not backend) |
| `screens/` (directory) | large | Screen components (UI) |
| `ink/` (directory) | varies | Ink rendering utilities (UI) |
| `state/` (directory) | varies | AppState management |
| `types/` (directory) | varies | Type definitions |
| `schemas/` (directory) | varies | Zod schemas |
| `constants/` (directory) | varies | Constants |
| `entrypoints/` (directory) | varies | SDK/CLI entry points |
| `cli/` (directory) | varies | CLI argument parsing |
| `bootstrap/` (directory) | varies | Bootstrap/init logic |
| `hooks/` (directory) | varies | React hooks |
| `assistant/` (directory) | varies | Assistant helpers |
| `bridge/` (directory) | varies | Bridge utilities |
| `buddy/` (directory) | varies | Buddy feature |
| `context/` (directory) | varies | Context providers |
| `jobs/` (directory) | varies | Background jobs |
| `keybindings/` (directory) | varies | Keybinding system |
| `migrations/` (directory) | varies | Data migrations |
| `moreright/` (directory) | varies | More-right feature |
| `native-ts/` (directory) | varies | Native TS bindings |
| `outputStyles/` (directory) | varies | Output formatting |
| `plugins/` (directory) | varies | Plugin infrastructure |
| `query/` (directory) | varies | Query sub-utilities |
| `remote/` (directory) | ~33KB | Remote session management |
| `server/` (directory) | ~10KB | Server infrastructure |
| `self-hosted-runner/` (directory) | ~0.3KB | Self-hosted runner (stubs) |
| `ssh/` (directory) | ~0.3KB | SSH sessions (stubs) |
| `daemon/` (directory) | ~0.3KB | Daemon mode (stubs) |
| `skills/` (directory) | varies | Skills infrastructure |
| `tasks/` (directory) | varies | Task system |
| `tools/` (53 tool directories) | ~500KB+ | Individual tool implementations |
| `upstreamproxy/` (directory) | varies | Upstream proxy |
| `vim/` (directory) | varies | Vim mode |
| `voice/` (directory) | varies | Voice feature |
| `environment-runner/` (directory) | varies | Environment runner |
| `proactive/` (directory) | ~0.1KB | Proactive features (stub) |

---

## 📊 Final Coverage Summary

```
FULLY ANALYZED & DOCUMENTED (docs 01-07):         ~1,050 KB
READ BUT NOT DOCUMENTED:                           ~400 KB  
NOT YET ANALYZED:
  P0 - Permissions & Security:                     ~320 KB
  P1 - Swarm + Tool Execution + QueryEngine + FH:  ~435 KB
  P2 - Telemetry + Analytics + Team + LSP + etc:   ~554 KB
  P3 - MCP + API + remaining services + utils:     ~2,800 KB+
                                                   ─────────
TOTAL ESTIMATED SOURCE:                            ~5,500 KB+
COVERAGE:                                          ~19-26%
```

> [!IMPORTANT]
> The liteai_cli_mvp codebase is significantly larger than initially estimated.
> Including service/API/MCP code, it's ~5.5MB of TypeScript source.
> We've thoroughly documented ~1MB and partially read another ~0.4MB.

---

## 🎯 Recommended Next Sessions

| Session | Focus | Files | Est. Size | Priority |
|---------|-------|-------|-----------|----------|
| **A** | Permissions & Security | `utils/permissions/` (24 files) + `services/policyLimits/` | ~320KB | P0 |
| **B** | Swarm & Multi-Agent | `utils/swarm/` (14 files) | ~180KB | P1 |
| **C** | Tool Execution Pipeline | `services/tools/` + `QueryEngine.ts` + `query.ts` | ~220KB | P1 |
| **D** | File History + Session Storage | `utils/fileHistory.ts` + `utils/sessionStorage.ts` | ~215KB | P1 |
| **E** | Telemetry & Analytics | `utils/telemetry/` + `services/analytics/` | ~255KB | P2 |
| **F** | Team & Enterprise | `services/teamMemorySync/` + `services/plugins/` + `services/remoteManagedSettings/` | ~165KB | P2 |
| **G** | MCP Deep Dive | `services/mcp/` (23 files) | ~420KB | P3 |
| **H** | API Client | `services/api/` (20 files) | ~360KB | P3 |
| **I** | Individual Tools Audit | `tools/` (53 directories) | ~500KB+ | P3 |
