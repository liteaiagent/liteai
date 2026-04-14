# Agent Architecture Review: LiteAI vs LiteAI2

## Overview
This document provides a deep, technical comparison between the agent systems of LiteAI (`packages/core/src/agent`) and LiteAI2 (`src/tools/AgentTool`). We analyze the structural differences, context orchestration, tool permissions, and execution boundaries. The goal is to identify proven patterns from LiteAI2 that can be ported back to LiteAI to enhance its modularity and scalability.

---

## 1. Declarative Agents & Configuration
Both platforms utilize strongly-typed configuration schemas, parsing agent roles out of Markdown (`.md`) files containing YAML frontmatter.

- **LiteAI (`packages/core/src/agent` & `config/schema.ts`)**: 
  LiteAI focuses on rule-based configuration. An "Agent" acts primarily as an execution preset. It defines base model overrides, system prompts, structural permissions (`PermissionNext.Ruleset`), and some Claude Code compatibility fields (`mcpServers`, `hooks`). However, many of these fields currently serve as static configuration properties.
- **LiteAI2 (`src/tools/AgentTool/loadAgentsDir.ts`)**: 
  LiteAI2 treats sub-agents as dynamic execution objects. The frontmatter properties (like `mcpServers`, `skills`, and `memory`) are actively hooked into the agent's runner. For example, `liteai_cli_mvp` dynamically connects and tears down specific MCP servers for a single sub-agent execution.

### ✨ Opportunities for LiteAI
- **Dynamic Resource Mounting**: The `task` tool in LiteAI currently evaluates permissions but delegates mainly back to `SessionPrompt`. LiteAI should adopt LiteAI2's pattern of dynamically mounting specific `MCP servers` and `skills` explicitly for the local lifecycle of the agent, rather than relying strictly on the project-wide default pool.

---

## 2. Context Orchestration and Forking
In swarm and sub-agent architectures, optimizing the context window is critical for system performance, latency, and token economics.

- **LiteAI (`session/index.ts > Session.fork` vs `tool/task.ts`)**: 
  LiteAI provides a `Session.fork` utility, but this is primarily a user-level feature that permanently clones the entire message history into a new database lineage. Conversely, when a sub-agent is invoked programmatically via the `task` tool, LiteAI initializes a *clean slate* session (`Session.create({ parentID })`). The sub-agent receives no historical system/user context aside from what is explicitly crammed into `params.prompt`.
- **LiteAI2 (`src/tools/AgentTool/runAgent.ts`)**: 
  Actively shares the parent's context cache and message history right into the child sub-agent in memory via `createSubagentContext()`. Crucially, while it passes the parent's history to preserve conversational state, it selectively prunes out heavy contextual boilerplates. For example, it detects if an agent is a read-only role (like `Explore` or `Plan`) and automatically strips `CLAUDE.md` instructions and massive `git status` outputs to decrease token padding.

### ✨ Opportunities for LiteAI
- **Intelligent Context Pruning & Automatic Sharing**: Currently, LiteAI subagents start with a completely empty memory slate. LiteAI could adopt LiteAI2's selective context forking: seamlessly passing parent messages into the subagent (simplifying tool usage) while systematically stripping out heavy global context files (`CLAUDE.md`, `git status`) for stateless child agents to save thousands of tokens per run.

---

## 3. Tool Permissions & Sandbox Isolation
- **LiteAI (`tool/task.ts`)**: 
  Employs a robust, explicit deny-list system at initialization. Before an agent executes via `task`, LiteAI explicitly injects `deny` rules for highly sensitive tools (e.g., `todowrite`, `todoread`, `task` recursions) unless they are hard-whitelisted. It tightly binds tool execution to `PermissionNext`.
- **LiteAI2 (`src/tools/AgentTool/runAgent.ts`)**: 
  Provides contextually isolated permission scopes during execution, overriding the parent context's state. It specifically factors in asynchronous environments, enforcing "silent denials" if background tasks attempt actions that demand interactive user prompts.

### ✨ Opportunities for LiteAI
- **Asynchronous Prompt Blocking**: LiteAI can benefit from explicitly wrapping background agents in a mode where blocking-UI prompts instantly reject. This will prevent headless agents from hanging indefinitely when asking a user to proceed with destructive operations.
- **Isolated Working Directories**: Applying strict memory scopes (`AgentMemoryScope` mapped to `user`, `project`, `local`) from LiteAI2 can sandbox execution boundaries cleanly.

---

## 4. Execution Telemetry and Traces
- **LiteAI (`SessionPrompt.prompt`)**: 
  Executes sub-agents using the primary conversational loop. A spawned sub-agent writes its final block `<task_result>` straight back to the parent message chain. The logging and tracing are bundled natively within the session.
- **LiteAI2**: 
  Utilizes complete **sidechain transcripts**. Sub-agents output their reasoning events into an isolated `recordSidechainTranscript` stream. Furthermore, LiteAI2 deeply integrates with trace layers (`registerPerfettoAgent`), allowing complex parent-child swarm spans to be visualized via local traces.

### ✨ Opportunities for LiteAI
- **Sidechain Execution Streams**: To protect the LLM Prompt Cache sizes, LiteAI should avoid dumping large sub-agent raw executions into the primary session path where it busts the KV cache. Logging subagent transcripts off-band—and just exposing the dense, finalized outcome to the parent—drastically improves caching stability and UX.
- **Hierarchical Tracing**: Adding Perfetto/OTel span links to strictly define when an agent invoked another agent improves debuggability natively.
