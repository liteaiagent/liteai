# Feature Comparison: Claude Code vs Gemini CLI vs LiteAI

> Last updated: 2026-05-09
> Sources: Claude Code (`d:\claude-code`), Gemini CLI (`d:\gemini-cli`), LiteAI (`d:\liteai`)

---

## 1. Core Tools

| Tool | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **File Read** | ✅ `FileReadTool` | ✅ `read_file` | ✅ `read` | All support line ranges, binary detection |
| **File Write** | ✅ `FileWriteTool` | ✅ `write_file` | ✅ `write` | Full file creation/overwrite |
| **File Edit** | ✅ `FileEditTool` | ✅ `replace` (search/replace) | ✅ `edit` + `multiedit` | CC: diff-based. GC: search/replace. LA: both + multi-edit |
| **Read Many Files** | ❌ | ✅ `read_many_files` | ✅ `batch` | GC: dedicated tool. LA: generic batch tool |
| **Glob** | ✅ `GlobTool` | ✅ `glob` | ✅ `glob` | File pattern matching |
| **Grep** | ✅ `GrepTool` | ✅ `grep_search` + `ripgrep` | ✅ `grep` | All use ripgrep. GC has two variants |
| **List Directory** | ❌ (via Bash) | ✅ `list_directory` | ✅ `ls` | CC uses Bash `ls` |
| **Shell / Bash** | ✅ `BashTool` + `PowerShellTool` | ✅ `run_shell_command` | ✅ `run_command` | |
| **Background Shell** | ❌ | ✅ `shellBackgroundTools` | ✅ `command_status` + `send_command_input` | LA: explicit status/input tools |
| **Apply Patch** | ❌ | ❌ | ✅ `apply_patch` | Unified diff application |
| **LSP Integration** | ✅ `LSPTool` | ❌ | ✅ `lsp` | Language Server Protocol |
| **Notebook Edit** | ✅ `NotebookEditTool` | ❌ | ❌ | Jupyter notebook editing |

---

## 2. Web & Search Tools

| Tool | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **Web Search** | ✅ `WebSearchTool` | ✅ `google_web_search` | ✅ `websearch` | CC: unspecified. GC: Google. LA: Exa MCP |
| **Web Fetch** | ✅ `WebFetchTool` | ✅ `web_fetch` | ✅ `webfetch` | Fetch URL content |
| **Code Search** | ❌ | ❌ | ✅ `codesearch` | Semantic code search via Exa |
| **Internal Docs** | ❌ | ✅ `get_internal_docs` | ❌ | GC: fetches Google internal docs |

---

## 3. Agent & Task Tools

| Tool | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **Subagent / Fork** | ✅ `AgentTool` | ❌ | ✅ `task` | CC: full fork with worktree isolation |
| **Task Create/List/Update** | ✅ `TaskCreateTool` etc. (6 tools) | ❌ | ✅ `task` | CC: separate create/get/list/update/stop/output |
| **Ask User** | ✅ `AskUserQuestionTool` | ✅ `ask_user` | ✅ `ask_user` | Interactive user prompt |
| **Send Message** | ✅ `SendMessageTool` | ❌ | ✅ `send_message` | Non-blocking message to user |
| **Yield Turn** | ❌ | ❌ | ✅ `yield_turn` | Explicit turn yielding |
| **Todo / Checklist** | ✅ `TodoWriteTool` | ✅ `write_todos` | ✅ `todo` | In-session task tracking |
| **Brief / Summary** | ✅ `BriefTool` | ❌ | ❌ | Compact response mode |

---

## 4. Planning & Skills

| Feature | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **Plan Mode** | ✅ `EnterPlanModeTool` / `ExitPlanModeTool` | ✅ `enter_plan_mode` / `exit_plan_mode` | ✅ `plan` | All three support structured planning |
| **Skills** | ✅ `SkillTool` | ✅ `activate_skill` | ✅ `skill` | Specialized agent capabilities |
| **Tool Search** | ✅ `ToolSearchTool` | ❌ | ❌ | Discover available tools |
| **Config Tool** | ✅ `ConfigTool` | ❌ | ❌ | Runtime config changes |

---

## 5. MCP (Model Context Protocol)

| Feature | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **MCP Client** | ✅ Full (stdio + SSE + streamable HTTP) | ✅ Full (stdio + SSE) | ✅ Full (stdio + SSE + streamable HTTP) | All three: full MCP client |
| **MCP Tools** | ✅ Dynamic registration | ✅ Dynamic registration | ✅ Dynamic registration | Tools auto-registered from MCP servers |
| **MCP Resources** | ✅ `ListMcpResourcesTool` + `ReadMcpResourceTool` | ✅ `list-mcp-resources` + `read-mcp-resource` | ✅ `/mcp/resource` API | LA: HTTP API for resources |
| **MCP Auth (OAuth)** | ✅ `McpAuthTool` | ❌ | ✅ Full OAuth flow | LA: start/callback/authenticate/remove |
| **MCP Prompts** | ✅ | ❌ | ✅ `listPrompts` | |
| **MCP Configuration** | ✅ `.claude/mcp.json` | ✅ `.gemini/settings.json` | ✅ `.mcp.json` + config | LA: global + project-scoped |
| **MCP HTTP API** | ❌ (CLI-only) | ❌ (CLI-only) | ✅ REST endpoints (add/connect/disconnect/auth) | LA: full CRUD via HTTP |
| **Dynamic Add/Remove** | ❌ | ❌ | ✅ Runtime add/connect/disconnect | |
| **Project-Scoped MCP** | ✅ | ✅ | ✅ `MCP.sync()` on project bootstrap | |

---

## 6. Context Instructions

| Feature | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **Global Instructions** | ✅ `~/.claude/CLAUDE.md` | ✅ `~/.gemini/GEMINI.md` | ✅ `~/.liteai/AGENTS.md` | User-level context |
| **Project Instructions** | ✅ `<worktree>/CLAUDE.md` | ✅ `<worktree>/GEMINI.md` | ✅ `<worktree>/AGENTS.md` | Project-level context |
| **Local Instructions** | ✅ `CLAUDE.local.md` | ❌ | ❌ | Private, not committed |
| **Rule Files** | ✅ `.claude/rules/*.md` | ❌ | 🔜 `.liteai/rules/*.md` | Modular rule organization |
| **JIT / Subdirectory** | ✅ Subdirectory `CLAUDE.md` | ✅ Subdirectory `GEMINI.md` (recursive) | ❌ | Load lazily when agent touches a path |
| **Agent-Read-Only** | ✅ No write access | ✅ No write access | ✅ No write access | Humans author, agents consume |
| **Platform-Aware** | ❌ (CLAUDE.md only) | ❌ (GEMINI.md only) | ✅ Multi-platform filenames | LA can load CLAUDE.md, GEMINI.md, etc. |

---

## 7. Agent Memory

| Feature | Claude Code | Gemini CLI | LiteAI (Current) | LiteAI (v-Next) | Notes |
|---|:---:|:---:|:---:|:---:|---|
| **Memory Storage** | ✅ `~/.claude/projects/<id>/memory/` | ✅ `~/.gemini/tmp/<id>/memory/` | ⚠️ Per-agent dirs in worktree | 🔜 `~/.liteai/projects/<id>/memory/` | v-Next: unified, user-private |
| **Memory Index** | ✅ `MEMORY.md` (capped 200 lines) | ✅ `MEMORY.md` (flat) | ⚠️ `MEMORY.md` per agent | 🔜 Single `MEMORY.md` index | v-Next: shared, not per-agent |
| **Topic Files** | ✅ Per-topic `.md` files | ❌ (single file) | ❌ | 🔜 Per-topic `.md` files | |
| **Memory Types** | ✅ 4 types (user/feedback/project/reference) | ❌ (untyped) | ❌ | 🔜 4 types (Claude Code pattern) | |
| **Save Memory Tool** | ✅ `write_file` to memory dir | ✅ `save_memory` | ✅ `memory_write` / `memory_edit` | 🔜 `save_memory` with type param | |
| **Read Memory Tool** | ✅ `read_file` from memory dir | ❌ (auto-loaded) | ✅ `memory_read` | 🔜 `read_file` (JIT) | |
| **Background Extraction** | ✅ `extractMemories` (forked agent) | ❌ | ❌ | 🔜 Forked agent (Claude pattern) | |
| **Memory Scope** | Always user-private | Always user-private | 3 scopes: user/project/local | 🔜 Default user-private | |
| **Per-Agent Memory** | ❌ | ❌ | ✅ Per agent type | 🔜 Removed | |
| **Subagent Memory Access** | ❌ Read-only (inherited) | ❌ | ✅ Full read/write | 🔜 Read-only (inherited) | |
| **What NOT to Save** | ✅ Explicit exclusions enforced | ❌ | ❌ | 🔜 Explicit exclusions | Ref: `memoryTypes.ts:183-195` |

---

## 8. Skills System

| Feature | Claude Code | Gemini CLI | LiteAI (Current) | LiteAI (v-Next) | Notes |
|---|:---:|:---:|:---:|:---:|---|
| **Skill Definition** | ✅ `.claude/skills/` | ✅ `.gemini/skills/` | ✅ `.liteai/skills/` | ✅ | All use SKILL.md format |
| **Skill Activation** | ✅ `SkillTool` | ✅ `activate_skill` | ✅ `skill` tool | ✅ | Agent activates by name |
| **Background Extraction** | ❌ | ✅ (session-based) | ❌ | 🔜 Post-session extraction | |
| **Skills Inbox** | ❌ | ✅ `/memory inbox` | ❌ | 🔜 `/skills inbox` | Review before accepting |
| **Inbox Accept/Reject** | ❌ | ✅ Move/dismiss | ❌ | 🔜 Accept/reject/edit | |
| **Inbox Patches** | ❌ | ✅ Patch-based updates | ❌ | ❌ | GC: patches to existing skills |

---

## 9. Session Management

| Feature | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **Session Persistence** | ✅ JSONL transcripts | ✅ In-memory only | ✅ SQLite (messages + parts) | CC: filesystem. LA: database |
| **Session Resume** | ✅ `--resume` / `/resume` | ✅ `/restore` | ✅ Session reconnect via SSE | |
| **Session Branch/Fork** | ✅ `/branch` | ❌ | ✅ `Session.fork` + `forkAtCheckpoint` | LA: fork at message point or checkpoint, with model/agent override + guidance |
| **Session Export** | ✅ `/export` | ❌ | ❌ | Export as markdown |
| **Session Rename** | ✅ `/rename` | ❌ | ✅ `setTitle` via API | LA: HTTP PATCH with title |
| **Session Tag** | ✅ `/tag` | ❌ | ✅ `setTags` via API | LA: multi-tag support, tag filtering, list all tags |
| **Session Share** | ❌ | ❌ | ✅ Share/unshare via API | LA: shareable URL generation, auto-share option |
| **Session Stats** | ✅ `/stats` + `/cost` | ❌ | ✅ Stats panel (UI) | |
| **Session Compact** | ✅ `/compact` (context window mgmt) | ❌ | ✅ Auto-compact + API trigger | LA: `POST /summarize`, auto-triggers on overflow |
| **Conversation History** | ✅ Past session search via grep | ❌ | ✅ FTS5 search + history API | LA: full-text search across sessions |
| **Conversation Recall** | ✅ Grep JSONL transcripts | ❌ | 🔜 System prompt injection + DB | |
| **Multi-Project** | ❌ (single project per session) | ❌ (single project) | ✅ Multi-project backend | LA: one core serves many projects |
| **Context Breakdown** | ❌ | ❌ | ✅ Token usage by category | LA: per-session context window analysis |

---

## 10. Safety & Sandboxing

| Feature | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **Command Approval** | ✅ Per-command permission prompts | ✅ Per-command with sandbox | ✅ Permission system | |
| **Sandbox** | ✅ macOS sandbox profiles | ✅ macOS seatbelt + Windows sandbox + Docker | ❌ | GC: most comprehensive |
| **Worktree Isolation** | ✅ `EnterWorktreeTool` / `ExitWorktreeTool` | ❌ | ❌ | CC: git worktree per agent |
| **File Checkpoints** | ❌ | ❌ | ✅ Git-based snapshots | LA: `snapshot/` per project |
| **Dangerous Path Protection** | ✅ `DANGEROUS_DIRECTORIES` | ✅ `SandboxPolicyManager` | ⚠️ Basic path validation | |
| **Permission Persistence** | ✅ Per-session + settings | ✅ Per-session | ✅ DB-persisted | |
| **Network Isolation** | ❌ | ✅ Sandbox network rules | ❌ | |

---

## 11. Context Window Management

| Feature | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **Context Compaction** | ✅ `/compact` + auto-compact | ❌ | ✅ `CompactionOrchestrator` + auto-compact | LA: overflow detection, pruning, summary generation |
| **Reactive Compaction** | ✅ Auto-triggers near limit | ❌ | ✅ Auto-triggers on overflow | LA: `isOverflow()` checks after each turn |
| **Tool Result Truncation** | ✅ Smart truncation | ✅ Basic truncation | ✅ Truncation + tool output pruning | LA: strips old tool results beyond 40K token threshold |
| **Prompt Caching** | ✅ Anthropic cache | ✅ Gemini cache | ⚠️ Provider-dependent | CC: deep cache optimization |
| **Content Replacement** | ✅ Replaces large results | ❌ | ❌ | Store full result, inject summary |
| **Compaction Hooks** | ❌ | ❌ | ✅ Plugin + Hook integration | LA: `experimental.session.compacting` + `PreCompact` hooks |
| **Compaction Config** | ✅ | ❌ | ✅ `compaction.auto`, `compaction.reserved`, `compaction.prune` | LA: configurable buffer, reserve, prune settings |

---

## 12. UI & Interface

| Feature | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **CLI (Terminal)** | ✅ Ink (React) TUI | ✅ Custom TUI | ✅ Ink TUI | |
| **Web UI** | ❌ | ❌ | ✅ Web client | LA: full web interface |
| **VSCode Extension** | ✅ (bundled) | ✅ (bundled) | ✅ (separate package) | |
| **IDE Integration** | ✅ `/ide` bridge | ✅ IDE hooks | ✅ LSP-based | |
| **Voice Input** | ✅ `/voice` | ✅ Voice support | ❌ | |
| **Themes** | ✅ `/theme` | ❌ | ❌ | |
| **Stickers** | ✅ `/stickers` | ❌ | ❌ | Fun visual feedback |
| **Keybindings** | ✅ `/keybindings` | ❌ | ❌ | Custom key mappings |

---

## 13. Model & Provider Support

| Feature | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **Primary Provider** | Anthropic (Claude) | Google (Gemini) | Multi-provider | LA: provider-agnostic |
| **Model Switching** | ✅ `/model` | ❌ (config only) | ✅ Dynamic model selection | |
| **OpenAI-Compatible** | ❌ | ❌ | ✅ OpenAI-compat providers | LA: Ollama, LMStudio, etc. |
| **Local Models** | ❌ | ❌ | ✅ Local model discovery | LA: Ollama/LMStudio auto-detect |
| **Dynamic Model Fetch** | ❌ | ❌ | ✅ API-based model listing | |
| **Model Registry** | ❌ (hardcoded) | ❌ (hardcoded) | ✅ `models.dev` + local API | |
| **Extended Thinking** | ✅ (Claude 3.5+) | ✅ (Gemini 2.0+) | ✅ Provider-dependent | |

---

## 14. Extensibility

| Feature | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **MCP Servers** | ✅ Full client | ✅ Full client | ✅ Full client + HTTP API | All three have full MCP support |
| **Plugins** | ✅ `/plugin` system | ✅ Extensions | ✅ Full plugin framework | LA: convention-based loader, registry, marketplace catalogs |
| **Plugin Install/Manage** | ✅ Install/uninstall | ❌ | ✅ Install/enable/disable/uninstall | LA: scoped (user/project), cached, with persistent data dir |
| **Plugin Marketplace** | ❌ | ❌ | ✅ Marketplace catalogs | LA: GitHub/URL/npm/git-subdir sources, known marketplace registry |
| **Plugin Components** | ✅ Commands, hooks | ❌ | ✅ Commands, agents, skills, hooks, MCP servers | LA: convention-based auto-discovery, namespaced |
| **Plugin HTTP API** | ❌ | ❌ | ✅ Full CRUD REST API | LA: list/enable/disable/uninstall/marketplace/install endpoints |
| **Plugin Compat** | ✅ `.claude-plugin/` | ❌ | ✅ `.liteai-plugin/` + `.claude-plugin/` | LA: Claude Code plugin format compatible |
| **Hooks (lifecycle)** | ✅ Pre/post tool, stop hooks | ✅ Hooks system | ✅ 17+ hook points | LA: chat, tool, shell, command, session, permission, compaction hooks |
| **Custom Agents** | ✅ Agent definitions | ❌ | ✅ `.liteai/agents/` + plugin agents | |
| **Custom Skills** | ✅ `.claude/skills/` | ✅ `.gemini/skills/` | ✅ `.liteai/skills/` + plugin skills | |
| **Custom Tools** | ❌ (via MCP/plugins) | ❌ (via extensions) | ✅ Tool registry API + plugin tools | |
| **SDK** | ✅ Programmatic API | ❌ | ✅ `@liteai/sdk` | |
| **HTTP/SSE API** | ❌ (CLI-only) | ❌ (CLI-only) | ✅ Full HTTP/SSE server | LA: multi-tenant backend |

---

## 15. DevOps & Collaboration

| Feature | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **Git Integration** | ✅ `/commit`, `/diff`, PR workflow | ❌ | ❌ | CC: full git workflow |
| **PR Review** | ✅ `/review`, `/pr_comments` | ❌ | ❌ | |
| **GitHub App** | ✅ `/install-github-app` | ❌ | ❌ | |
| **Slack Integration** | ✅ `/install-slack-app` | ❌ | ❌ | |
| **Team Memory** | ✅ Shared memory (TEAMMEM flag) | ❌ | ❌ | CC: multi-user shared memory |
| **Remote Execution** | ✅ CCR (Claude Code Remote) | ❌ | 🔜 Container-per-user | |
| **Cron Scheduling** | ✅ `ScheduleCronTool` | ❌ | ❌ | Proactive scheduled tasks |

---

## 16. Observability & Debugging

| Feature | Claude Code | Gemini CLI | LiteAI | Notes |
|---|:---:|:---:|:---:|---|
| **Usage Tracking** | ✅ `/usage`, `/cost` | ❌ | ✅ Per-model metrics | |
| **Session Insights** | ✅ `/insights` (detailed analysis) | ❌ | ❌ | CC: deep session analytics |
| **Share / Report** | ✅ `/share`, `/issue` | ❌ | ❌ | Upload session for debugging |
| **Telemetry** | ✅ OpenTelemetry | ✅ Google telemetry | ✅ OpenTelemetry (Langfuse) | |
| **Debug Mode** | ✅ `--debug` | ✅ `--debug` | ✅ Debug logging | |
| **Heap Dumps** | ✅ `/heapdump` | ❌ | ❌ | Memory profiling |
| **Doctor** | ✅ `/doctor` | ❌ | ❌ | System diagnostics |

---

## Summary: Competitive Position

### Claude Code Strengths
- **Deepest memory system**: Background extraction, typed memories, team sharing
- **Git workflow**: Full commit/PR/review pipeline
- **Context management**: Compaction, reactive compact, content replacement
- **Collaboration**: GitHub App, Slack, team memory, remote execution
- **Session management**: Branch, export, rename, tag, insights

### Gemini CLI Strengths
- **Sandboxing**: Most comprehensive (macOS seatbelt + Windows sandbox + Docker)
- **Skills extraction**: Automated background extraction with inbox review
- **Patches inbox**: Can propose patches to existing skills
- **Read many files**: Dedicated tool for bulk file reading

### LiteAI Strengths
- **Multi-provider**: Provider-agnostic, OpenAI-compatible, local model support
- **Multi-project backend**: One core process serves multiple projects
- **HTTP/SSE API**: Full server, not CLI-only
- **MCP HTTP API**: Runtime add/connect/disconnect MCP servers via REST + OAuth
- **Plugin framework**: Full lifecycle (registry, marketplace, install/enable/disable/uninstall), convention-based loader, Claude Code compat
- **Plugin marketplace**: Curated catalogs via GitHub, URL, npm, git-subdir sources
- **Context compaction**: Auto-compact on overflow, tool output pruning, plugin/hook integration
- **Session forking**: Fork at message point or checkpoint, with model/agent override + guidance injection
- **Session management**: Rename, tag, share/unshare, archive, FTS search, context breakdown
- **Web UI**: Browser-based interface alongside CLI
- **SDK**: Programmatic integration (`@liteai/sdk`)
- **File checkpoints**: Git-based snapshot/restore
- **Custom tools**: Direct tool registry API (no MCP wrapper needed)

### LiteAI Gaps (v-Next Priorities)
1. **Sandbox** — No sandboxed execution
2. **Memory System** — Per-agent dirs in worktree → unified user-private (in progress)
3. **Conversation Recall** — No cross-session context injection → system prompt injection (in progress)
4. **Git Workflow** — No integrated commit/PR/review tools
5. **Session Export** — No exporting sessions as markdown
6. **Content Replacement** — No storing full results with injected summaries
