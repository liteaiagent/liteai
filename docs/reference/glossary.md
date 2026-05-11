---
title: Glossary
description: "Definitions of key terms used in LiteAI documentation."
---

# Glossary

| Term | Definition |
|---|---|
| **Agent** | An AI persona with a specific system prompt, model, and tool restrictions. Can be the primary agent or a subagent. |
| **Agent loop** | The core cycle of assembling prompts, querying the LLM, executing tools, and managing state. |
| **AGENTS.md** | A markdown file containing project-specific instructions injected into the system prompt. |
| **Auto-compaction** | Automatic summarization of older conversation messages to stay within the context window. |
| **Checkpoint** | A snapshot of file state taken after tool execution, enabling undo/revert. |
| **Coordinator** | A session mode where the agent delegates work to teammate agents instead of executing directly. |
| **Durable rule** | A persistent permission allow/deny rule that lasts for the session. |
| **Fork** | A subagent that inherits the parent's prompt cache for cost-efficient parallel work. |
| **Headless mode** | Non-interactive execution mode for CI/CD and automation. |
| **HITL** | Human-in-the-loop. The pattern where the system prompts the user for approval before executing an action. |
| **Hook** | A lifecycle callback that runs custom logic (shell command or HTTP request) on specific events. |
| **Mailbox** | File-based inter-agent communication system used by coordinator teammates. |
| **MCP** | Model Context Protocol. A standard for connecting AI systems with external tool servers. |
| **Permission bridge** | Dual-transport system that routes teammate permission requests to the coordinator for approval. |
| **Plan mode** | A session mode where the agent can only read and suggest — no write or execute actions. |
| **Plugin** | A runtime-loaded extension that adds tools, hooks, and capabilities. |
| **Project** | A workspace directory that LiteAI manages, with its own configuration and session state. |
| **Provider** | An LLM API service (Anthropic, OpenAI, Google, etc.) that LiteAI connects to. |
| **Section registry** | Internal system that caches and assembles system prompt sections. |
| **Session** | A persistent conversation with its own history, tool state, and checkpoint trail. |
| **Sidechain transcript** | The conversation history of a completed fork subagent, persisted for review. |
| **Skill** | A task-focused instruction package (SKILL.md) that guides the agent through a specific workflow. |
| **SSE** | Server-Sent Events. A protocol for streaming events from server to client over HTTP. |
| **Swarm** | A team of coordinator teammate agents working in parallel with mailbox communication. |
| **Teammate** | A worker agent spawned by a coordinator to handle a specific task. |
| **Turn** | One cycle of the agent loop: user message → agent processing → response. |
| **Verification agent** | A read-only adversarial agent that reviews changes and reports PASS/FAIL/PARTIAL. |
| **Worktree** | Git-based sandboxing where the agent operates in an isolated working copy. |
