# LiteAI2 → LiteAI Feature Porting Checklist

> Track implementation progress. Mark `[x]` when complete, `[/]` when in progress.

---

## Phase 1 — Modular Prompt System

- [ ] Section-based system prompt registry
- [ ] `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` cache boundary marker
- [ ] `DANGEROUS_uncachedSystemPromptSection()` volatile section utility
- [ ] Byte-identical prefix guarantee for prompt cache hits
- [ ] User context vs system context separation
- [ ] Per-turn dynamic section recomputation

## Phase 2 — Tool System Hardening

- [ ] `getAllBaseTools()` centralized tool registry
- [ ] Feature-flag gated tool loading (DCE-compatible)
- [ ] Pre-model deny-rule filtering
- [ ] `assembleToolPool()` with MCP tool merging
- [ ] Cache-stable tool sorting (built-in prefix guarantee)
- [ ] Tool schema deduplication
- [ ] Tool result persistence (large results saved to disk)
- [ ] Per-message tool result budget enforcement
- [ ] Content replacement state (frozen per-turn decisions)
- [ ] Cost tracking per model (USD, tokens, cache read/write)
- [ ] Effort system (low/medium/high/max thinking budget)

## Phase 3 — Subagent Foundation

- [ ] `createSubagentContext()` context sharing
- [ ] `runForkedAgent()` isolated execution
- [ ] `CacheSafeParams` for prompt cache stability across forks
- [ ] Context pruning strategies (message selection)
- [ ] Agent-specific MCP server initialization
- [ ] Agent summary generation (post-subagent dense summaries)
- [ ] Subagent tool restriction (configurable tool subset)

## Phase 4 — Context Window Management

- [ ] Auto-compact token threshold detection
- [ ] Forked-agent compaction (summary generation)
- [ ] Circuit breaker (3 consecutive failures → stop)
- [ ] Micro-compact (per-turn old tool result cleanup)
- [ ] Session memory compaction (lightweight alternative)
- [ ] Post-compact cleanup (reset caches, notify systems)
- [ ] Compact warning hook
- [ ] Context collapse (experimental — section-level)

## Phase 5 — Plan Mode

- [ ] `EnterPlanModeTool` / `ExitPlanModeTool`
- [ ] Attachment-based state machine (plan-in-context)
- [ ] Plan verification tool
- [ ] Plan file persistence and slug management
- [ ] Plan-aware prompt injection

## Phase 6 — Skills System

- [ ] Two-tier skill system (registration vs execution)
- [ ] Forked skill execution (isolated context)
- [ ] Skill discovery and listing
- [ ] Skill search (local + remote)
- [ ] Skill state preservation across compaction
- [ ] Suppress duplicate skill listings on resume

## Phase 7 — Memory & Dream Engine

- [ ] Persistent memory scopes (user, project, session)
- [ ] CLAUDE.md / memory directory loading
- [ ] Auto-managed memory file detection
- [ ] Dream engine (background memory consolidation)
  - [ ] Gate logic (turn count, time, idle)
  - [ ] Lock-based mutual exclusion
  - [ ] Forked read-only agent execution
  - [ ] 4-phase consolidation prompt
- [ ] Session memory service (within-session fact extraction)
- [ ] Extract memories pipeline (separate from Dream)
- [ ] Memory file write detection and collapsing

## Phase 8 — KAIROS & Proactive Features

- [ ] KAIROS proactive context injection
- [ ] Brief mode (SendUserFileTool)
- [ ] Cron scheduler (persistent cron tasks)
- [ ] Cron task jitter configuration
- [ ] Lock-based cron execution
- [ ] Prompt suggestions (post-turn prediction)
- [ ] Speculative execution
  - [ ] Overlay filesystem (copy-on-write isolation)
  - [ ] Safety boundaries (permission-aware)
  - [ ] Pipelined suggestion (cascading predictions)
  - [ ] Speculation accept/reject/inject flow

---

## Phase 9 — Hooks Lifecycle

- [ ] Hook execution engine (shell commands)
- [ ] HTTP webhook hooks
- [ ] Agent prompt hooks
- [ ] `SessionStart` / `SessionEnd` hooks
- [ ] `Setup` hook
- [ ] `PreToolUse` hook (modify input, deny)
- [ ] `PostToolUse` hook (inject context)
- [ ] `PostToolUseFailure` hook
- [ ] `PermissionDenied` / `PermissionRequest` hooks
- [ ] `UserPromptSubmit` hook
- [ ] `SubagentStart` / `SubagentStop` hooks
- [ ] `TaskCreated` / `TaskCompleted` hooks
- [ ] `ConfigChange` hook
- [ ] `CwdChanged` hook
- [ ] `FileChanged` hook
- [ ] `Elicitation` / `ElicitationResult` hooks
- [ ] `Stop` / `StopFailure` hooks
- [ ] Async hooks with rewake notification
- [ ] Workspace trust security checks
- [ ] Hook output protocol (JSON structured response)

## Phase 10 — Permissions Engine

- [ ] Permission mode system (plan, acceptEdits, bypassPermissions)
- [ ] Filesystem permission rules and path allowlists
- [ ] YOLO classifier (auto-allow heuristics)
- [ ] Permission setup and mode transitions
- [ ] Path validation and traversal prevention
- [ ] Shell rule matching
- [ ] Permission rule parser (from settings/CLAUDE.md)
- [ ] Shadowed rule detection
- [ ] Permission explainer (human-readable)
- [ ] Bypass permissions remote killswitch
- [ ] Denial tracking
- [ ] Dangerous command pattern detection

## Phase 11 — Coordinator & Swarm

- [ ] Coordinator mode (orchestrator with worker agents)
- [ ] Coordinator-only tool set (AgentTool, SendMessage, TaskStop)
- [ ] Worker full tool set delegation
- [ ] Task notification XML protocol
- [ ] Scratchpad directory for cross-worker sharing
- [ ] Concurrency rules (read-only unlimited, writes serialized)
- [ ] Swarm system (tmux backend)
- [ ] Swarm system (iTerm2 backend)
- [ ] In-process agent runner
- [ ] Leader-follower permission synchronization
- [ ] Team/teammate helpers
- [ ] Teammate mailbox message passing
- [ ] Teammate layout management

## Phase 12 — Git Worktree Isolation

- [ ] Worktree creation from branch
- [ ] Worktree creation from PR number/URL
- [ ] Slug validation (path traversal prevention)
- [ ] Fast resume via direct SHA read (no subprocess)
- [ ] Sparse checkout support
- [ ] Post-creation setup (settings copy, hooks, symlinks)
- [ ] `.worktreeinclude` file support
- [ ] tmux session per worktree
- [ ] Hook-based worktree (custom VCS)
- [ ] Worktree cleanup and keep
- [ ] Worktree session persistence in config

## Phase 13 — Session Management

- [ ] Conversation recovery (mid-turn interruption detection)
- [ ] Legacy attachment migration
- [ ] Unresolved tool use filtering
- [ ] Orphaned thinking removal
- [ ] Skill state restoration from attachments
- [ ] Cross-directory resume (via .jsonl path)
- [ ] Worktree session restoration on resume
- [ ] File history / checkpoints
  - [ ] Per-message file snapshots
  - [ ] File backup with hash-based naming
  - [ ] Snapshot rewind (undo to any message)
  - [ ] Diff stats computation
  - [ ] Resume support for file history
- [ ] Session storage and transcript persistence
- [ ] Cost state persistence across resume
- [ ] Commit attribution (AI-generated code tagging)

---

## Phase 14 — Telemetry & Analytics

- [ ] Session tracing (hierarchical spans)
- [ ] Perfetto trace export
- [ ] OTel instrumentation
- [ ] Plugin telemetry
- [ ] GrowthBook feature flag integration
- [ ] Event logging pipeline
- [ ] Analytics metadata collection
- [ ] First-party event logger

## Phase 15 — Enterprise & Team Features

- [ ] Team memory sync
- [ ] Secret scanning in memory files
- [ ] Team memory secret guard
- [ ] Remote managed settings (org policy push)
- [ ] Settings synchronization
- [ ] Policy limits enforcement
- [ ] Plugin installation manager
- [ ] Plugin CLI commands
- [ ] Plugin operations (install, update, remove)

## Phase 16 — Advanced Services

- [ ] LSP client integration
- [ ] LSP server manager
- [ ] LSP diagnostic registry
- [ ] Passive diagnostic feedback to model
- [ ] Sandbox execution adapter
- [ ] OAuth client and auth code flow
- [ ] MagicDocs (dynamic docs generation)
- [ ] Tips system (contextual user tips)
- [ ] Ultraplan / CCR session management
- [ ] Collapse read/search (UX grouping)
- [ ] Fast mode (Haiku fallback)

---

## Legend

- `[ ]` — Not started
- `[/]` — In progress
- `[x]` — Complete
