# LiteAI Core — Context Instructions & Agent Memory

> **Scope:** `src/session/engine/instruction.ts`, `src/platform/`, `src/agent/memory.ts`, `src/tool/memory.ts`, `src/config/schema.ts`  
> **Last audited:** 2026-05-09  
> **Roadmap:** [Project-Scoped Persistence](../project-scoped-persistence/02-roadmap.md)

---

## 1. Context Instructions (AGENTS.md)

Static, human-authored project rules injected into the system prompt. Agents have **read-only** access — humans edit via git.

> **Resolution chain:** Global → Project → Subdirectory (JIT) → URL

### 1.1 — Instruction Loading

| Feature | Status | Source |
|---|:---:|---|
| Global instruction file (`~/.liteai/AGENTS.md`) | ✅ | [`engine/instruction.ts`](../../packages/core/src/session/engine/instruction.ts) `globalFiles()` |
| Project instruction file (`<worktree>/AGENTS.md`) | ✅ | [`engine/instruction.ts`](../../packages/core/src/session/engine/instruction.ts) `systemPaths()` |
| `findUp` traversal (worktree → root) | ✅ | [`engine/instruction.ts`](../../packages/core/src/session/engine/instruction.ts) via `Filesystem.findUp()` |
| Custom instruction file paths (config) | ✅ | [`engine/instruction.ts`](../../packages/core/src/session/engine/instruction.ts) `config.instructions` |
| Remote instruction URLs (HTTP fetch) | ✅ | [`engine/instruction.ts`](../../packages/core/src/session/engine/instruction.ts) URL fetch with 5s timeout |
| Subdirectory JIT loading | ✅ | [`engine/instruction.ts`](../../packages/core/src/session/engine/instruction.ts) `resolve()` |
| Duplicate claim guard (per-message) | ✅ | [`engine/instruction.ts`](../../packages/core/src/session/engine/instruction.ts) `claim()` / `isClaimed()` |
| System prompt injection | ✅ | [`engine/system.ts`](../../packages/core/src/session/engine/system.ts) |
| `LITEAI_CONFIG_DIR` override | ✅ | [`engine/instruction.ts`](../../packages/core/src/session/engine/instruction.ts) `Flag.LITEAI_CONFIG_DIR` |
| `LITEAI_DISABLE_PROJECT_CONFIG` flag | ✅ | [`engine/instruction.ts`](../../packages/core/src/session/engine/instruction.ts) skip project instructions |

### 1.2 — Platform Profiles

Multi-platform instruction file support — LiteAI can load instructions from AGENTS.md, CLAUDE.md, GEMINI.md, etc.

| Feature | Status | Source |
|---|:---:|---|
| Platform profile registry | ✅ | [`platform/index.ts`](../../packages/core/src/platform/index.ts) |
| `PlatformProfile` interface | ✅ | [`platform/profile.ts`](../../packages/core/src/platform/profile.ts) |
| Standard profile (`AGENTS.md`) | ✅ | [`platform/profiles/standard.ts`](../../packages/core/src/platform/profiles/standard.ts) |
| Claude profile (`CLAUDE.md`) | ✅ | [`platform/profiles/claude.ts`](../../packages/core/src/platform/profiles/claude.ts) |
| Gemini profile (`GEMINI.md`) | ✅ | [`platform/profiles/gemini.ts`](../../packages/core/src/platform/profiles/gemini.ts) |
| Codex profile | ✅ | [`platform/profiles/codex.ts`](../../packages/core/src/platform/profiles/codex.ts) |
| `LITEAI_PLATFORM` selector | ✅ | [`platform/index.ts`](../../packages/core/src/platform/index.ts) `active()` |
| Platform-specific dirs | ✅ | [`platform/index.ts`](../../packages/core/src/platform/index.ts) `dirs()` |
| Global instruction paths (per-platform) | ✅ | [`platform/index.ts`](../../packages/core/src/platform/index.ts) `globalInstructionPaths()` |
| Env prefix registry | ✅ | [`platform/index.ts`](../../packages/core/src/platform/index.ts) `envPrefixes()` |

### 1.3 — Context Instructions v2 (Planned)

> 📋 **Roadmap:** [Phase 4.1 — Context Instructions v2](../project-scoped-persistence/02-roadmap.md#41--context-instructions-v2)

| Feature | Status | Source |
|---|:---:|---|
| `.liteai/rules/*.md` modular rule files | ❌ | Planned — Phase 4.1 |
| JIT / subdirectory lazy loading on path access | ❌ | Planned — Phase 4.1 |
| `AGENTS.local.md` (private, not git-committed) | ❌ | Planned — Phase 4.1 |

---

## 2. Agent Memory (Current: Per-Agent Model)

Dynamic, agent-written knowledge persisted across sessions. Current implementation uses **per-agent, per-scope** memory directories.

> **⚠️ Legacy architecture.** The per-agent memory model will be replaced by a unified, project-scoped memory system in Phase 1 of the [persistence roadmap](../project-scoped-persistence/02-roadmap.md#phase-1--foundation-project-registry--unified-memory).

### 2.1 — Memory Service (Legacy)

| Feature | Status | Source |
|---|:---:|---|
| `AgentMemory` namespace | ✅ | [`agent/memory.ts`](../../packages/core/src/agent/memory.ts) |
| Per-agent memory dirs (user/project/local scope) | ✅ | [`agent/memory.ts`](../../packages/core/src/agent/memory.ts) `getAgentMemoryDir()` |
| Auto-memory enable/disable (env + config) | ✅ | [`agent/memory.ts`](../../packages/core/src/agent/memory.ts) `isAutoMemoryEnabled()` |
| Memory directory creation | ✅ | [`agent/memory.ts`](../../packages/core/src/agent/memory.ts) `ensureMemoryDirExists()` |
| Memory path validation | ✅ | [`agent/memory.ts`](../../packages/core/src/agent/memory.ts) `isAgentMemoryPath()` |
| Memory prompt loading | ✅ | [`agent/memory.ts`](../../packages/core/src/agent/memory.ts) `loadAgentMemoryPrompt()` |
| Memory snapshot check (project → local) | ✅ | [`agent/memory.ts`](../../packages/core/src/agent/memory.ts) `checkAgentMemorySnapshot()` |
| Memory snapshot copy | ✅ | [`agent/memory.ts`](../../packages/core/src/agent/memory.ts) `copyProjectSnapshotToLocal()` |
| Memory scope config (`memory` setting) | ✅ | [`config/schema.ts`](../../packages/core/src/config/schema.ts) `memory: z.enum(...)` |

### 2.2 — Memory Tools (Legacy)

| Feature | Status | Source |
|---|:---:|---|
| `readMemory` tool | ✅ | [`tool/memory.ts`](../../packages/core/src/tool/memory.ts) `ReadMemoryTool` |
| `writeMemory` tool | ✅ | [`tool/memory.ts`](../../packages/core/src/tool/memory.ts) `WriteMemoryTool` |
| `editMemory` tool | ✅ | [`tool/memory.ts`](../../packages/core/src/tool/memory.ts) `EditMemoryTool` |
| Scope-aware dir resolution (local > project) | ✅ | [`tool/memory.ts`](../../packages/core/src/tool/memory.ts) `getMemDir()` |
| Path traversal guard | ✅ | [`tool/memory.ts`](../../packages/core/src/tool/memory.ts) `isAgentMemoryPath()` check |

---

## 3. Unified Memory System (Planned: v-Next)

> 📋 **Roadmap:** [Phase 1 — Foundation](../project-scoped-persistence/02-roadmap.md#phase-1--foundation-project-registry--unified-memory)

Replaces the per-agent model with a single, project-scoped memory system under `~/.liteai/projects/<id>/memory/`.

### 3.1 — Project-Scoped Memory (Phase 1.2)

| Feature | Status | Source |
|---|:---:|---|
| `~/.liteai/projects/<id>/memory/MEMORY.md` index | ❌ | Planned — Phase 1.2 |
| Topic files (`user-profile.md`, `feedback.md`, `project-context.md`, `references.md`) | ❌ | Planned — Phase 1.2 |
| Memory type taxonomy (user/feedback/project/reference) | ❌ | Planned — Phase 1.2 |
| MEMORY.md index cap (200 lines / 25KB) | ❌ | Planned — Phase 1.2 |
| System prompt injection (index only) | ❌ | Planned — Phase 1.2 |
| "What NOT to save" enforcement | ❌ | Planned — Phase 1.2 |

### 3.2 — Memory Tools v2 (Phase 1.3)

| Feature | Status | Source |
|---|:---:|---|
| `save_memory` tool (typed: user/feedback/project/reference) | ❌ | Planned — Phase 1.3 |
| JIT topic file access (read_file / write_file) | ❌ | Planned — Phase 1.3 |
| Root-agent-only access control | ❌ | Planned — Phase 1.3 |
| Subagent read-only inheritance | ❌ | Planned — Phase 1.3 |
| `/remember <fact>` command | ❌ | Planned — Phase 1.3 |
| Remove `AgentMemory` namespace | ❌ | Planned — Phase 1.3 |
| Remove per-agent memory directories | ❌ | Planned — Phase 1.3 |

### 3.3 — Background Memory Extraction (Phase 3.1)

| Feature | Status | Source |
|---|:---:|---|
| In-session forked extraction agent | ❌ | Planned — Phase 3.1 |
| Token + tool-call threshold triggers | ❌ | Planned — Phase 3.1 |
| Dedup (skip if agent already wrote memory) | ❌ | Planned — Phase 3.1 |
| Non-blocking background execution | ❌ | Planned — Phase 3.1 |

---

## 4. Conversation History & Recall (Planned: v-Next)

> 📋 **Roadmap:** [Phase 2 — Conversation History](../project-scoped-persistence/02-roadmap.md#phase-2--conversation-history--recall)

### 4.1 — Summarization Pipeline (Phase 2.1)

| Feature | Status | Source |
|---|:---:|---|
| Background summarization agent (session end) | ❌ | Planned — Phase 2.1 |
| Title + summary + tags generation | ❌ | Planned — Phase 2.1 |
| Lightweight model usage (flash/mini) | ❌ | Planned — Phase 2.1 |
| Fire-and-forget (non-blocking) | ❌ | Planned — Phase 2.1 |

### 4.2 — Index Storage (Phase 2.2)

| Feature | Status | Source |
|---|:---:|---|
| `index.jsonl` append-only storage | ❌ | Planned — Phase 2.2 |
| Last 50 entries loaded at session start | ❌ | Planned — Phase 2.2 |
| Directory auto-creation | ❌ | Planned — Phase 2.2 |

### 4.3 — Conversation Recall (Phase 2.3–2.4)

| Feature | Status | Source |
|---|:---:|---|
| System prompt injection (conversation history block) | ❌ | Planned — Phase 2.3 |
| Full recall from DB (`recall_conversation`) | ❌ | Planned — Phase 2.4 |
| Project-scoped recall (`WHERE project_id = ?`) | ❌ | Planned — Phase 2.4 |

---

## 5. Skills Extraction (Planned: v-Next)

> 📋 **Roadmap:** [Phase 3.2–3.3 — Skills Extraction](../project-scoped-persistence/02-roadmap.md#32--skills-extraction-post-session)

| Feature | Status | Source |
|---|:---:|---|
| Post-session background extraction agent | ❌ | Planned — Phase 3.2 |
| Repeating workflow detection | ❌ | Planned — Phase 3.2 |
| Skills inbox (`~/.liteai/projects/<id>/skills-inbox/`) | ❌ | Planned — Phase 3.2 |
| `/skills inbox` command | ❌ | Planned — Phase 3.3 |
| `/skills accept <name>` command | ❌ | Planned — Phase 3.3 |
| `/skills reject <name>` command | ❌ | Planned — Phase 3.3 |
| `/skills edit <name>` command | ❌ | Planned — Phase 3.3 |

---

## 6. Session Export (Planned: v-Next)

> 📋 **Roadmap:** [Phase 4.2 — Session Export](../project-scoped-persistence/02-roadmap.md#42--session-export)

| Feature | Status | Source |
|---|:---:|---|
| `/export` command (Markdown) | ❌ | Planned — Phase 4.2 |
| `GET /session/:id/export` API | ❌ | Planned — Phase 4.2 |

---

## 7. Content Replacement (Planned: v-Next)

> 📋 **Roadmap:** [Phase 4.3 — Content Replacement](../project-scoped-persistence/02-roadmap.md#43--content-replacement)

| Feature | Status | Source |
|---|:---:|---|
| Large tool result → summary replacement | ❌ | Planned — Phase 4.3 |
| On-demand full result expansion | ❌ | Planned — Phase 4.3 |
| Compaction hook integration | ❌ | Planned — Phase 4.3 |

---

## Summary

| Category | ✅ | 🔶 | ❌ | Total |
|---|:---:|:---:|:---:|:---:|
| Context Instructions (Loading) | 10 | 0 | 0 | 10 |
| Platform Profiles | 10 | 0 | 0 | 10 |
| Context Instructions v2 | 0 | 0 | 3 | 3 |
| Agent Memory Service (Legacy) | 9 | 0 | 0 | 9 |
| Memory Tools (Legacy) | 5 | 0 | 0 | 5 |
| Unified Memory System | 0 | 0 | 6 | 6 |
| Memory Tools v2 | 0 | 0 | 7 | 7 |
| Background Memory Extraction | 0 | 0 | 4 | 4 |
| Summarization Pipeline | 0 | 0 | 4 | 4 |
| Index Storage | 0 | 0 | 3 | 3 |
| Conversation Recall | 0 | 0 | 3 | 3 |
| Skills Extraction | 0 | 0 | 7 | 7 |
| Session Export | 0 | 0 | 2 | 2 |
| Content Replacement | 0 | 0 | 3 | 3 |
| **Total** | **34** | **0** | **42** | **76** |
