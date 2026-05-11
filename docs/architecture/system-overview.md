---
title: "Architecture: System overview"
description: "Technical architecture of LiteAI — module inventory, subsystem boundaries, multi-tenant design, and data flow."
---

# System overview

> **Source:** `packages/core/src/`
> **Last verified against code:** 2026-05-13

This page provides a technical map of LiteAI's architecture for engineers who want to understand how the system is built. Each subsystem links to a dedicated deep-dive page.

## Module inventory

LiteAI's core engine (`packages/core/src/`) is organized into 47+ subsystems:

```mermaid
graph TB
    subgraph "Entry Points"
        Main["main.ts<br/>Server bootstrap"]
        Runtime["runtime.ts<br/>Runtime detection"]
    end

    subgraph "HTTP Layer"
        Server["server/<br/>Hono app, routes, middleware"]
        Routes["server/routes/<br/>30+ API endpoints"]
    end

    subgraph "Session Engine"
        Session["session/<br/>Session lifecycle"]
        Engine["session/engine/<br/>Query, system prompt, tools"]
        Loop["Agent loop<br/>Turn management"]
        Pipeline["pipeline.ts<br/>Context processing"]
        Persister["persister.ts<br/>Event persistence"]
    end

    subgraph "Agent System"
        Agent["agent/<br/>Fork, resume, memory"]
        Coordinator["coordinator/<br/>Swarm mode, teammates"]
    end

    subgraph "Provider Abstraction"
        Provider["provider/<br/>20+ model adapters"]
        Auth["auth/<br/>OAuth, API key, Codex"]
    end

    subgraph "Tool System"
        Tool["tool/<br/>35+ built-in tools"]
        MCP["mcp/<br/>External tool protocol"]
        Skill["skill/<br/>Skill discovery & loader"]
    end

    subgraph "Configuration"
        Config["config/<br/>Schema, loader, paths"]
        Platform["platform/<br/>Profile compatibility"]
        Flag["flag/<br/>Feature flags"]
        Plugin["plugin/<br/>Plugin registry"]
    end

    subgraph "Safety & Guardrails"
        Permission["permission/<br/>Classification"]
        LoopDetect["loop-detection.ts<br/>Thinking, tool, chanting"]
        StopDrift["stop-drift.ts<br/>Plan mode enforcement"]
    end

    subgraph "Infrastructure"
        Storage["storage/<br/>SQLite + FTS"]
        Telemetry["telemetry/<br/>OpenTelemetry"]
        Bus["bus/<br/>Event system"]
        File["file/<br/>Filesystem, ripgrep"]
        Project["project/<br/>Workspace management"]
        LSP["lsp/<br/>40 language servers"]
        Snapshot["snapshot/<br/>File checkpointing"]
        Shell["shell/<br/>Shell detection"]
    end

    subgraph "Platform Support"
        ACP["acp/<br/>Agent Communication Protocol"]
        IDE["ide/<br/>IDE integration"]
        Capabilities["capabilities/<br/>Local vs hosted"]
        ControlPlane["control-plane/<br/>Multi-workspace"]
    end

    subgraph "Utilities"
        Hook["hook/<br/>Lifecycle hooks"]
        Command["command/<br/>Background tasks"]
        Feedback["feedback/<br/>User feedback"]
        Share["share/<br/>Session sharing"]
        Format["format/<br/>Output formatting"]
        Style["style/<br/>Output styling"]
        Scheduler["scheduler/<br/>Task scheduling"]
        Question["question/<br/>User questions"]
        Isolation["isolation/<br/>Worktree isolation"]
        Worktree["worktree/<br/>Git worktree mgmt"]
        Patch["patch/<br/>Unified diff engine"]
        Account["account/<br/>User accounts"]
    end

    Main --> Server --> Routes
    Routes --> Session --> Engine --> Loop
    Loop --> Provider
    Loop --> Tool
    Loop --> Agent
    Agent --> Coordinator
    Engine --> Config
    Engine --> Pipeline
    Engine --> Persister
    Config --> Platform
    Session --> Storage
    Session --> Telemetry
    Loop --> Permission
    Loop --> LoopDetect
    Tool --> MCP
    Tool --> File
    Tool --> Skill
    Provider --> Auth
```

## Subsystem summary

| Subsystem | Source | Features | Deep dive |
|---|---|---|---|
| **Session engine** | `src/session/` | Agent loop, query assembly, compaction, checkpointing | [Session engine →](/architecture/session-engine) |
| **Provider system** | `src/provider/` | 20+ provider adapters, streaming, token counting | [Provider system →](/architecture/provider-system) |
| **Agent system** | `src/agent/`, `src/coordinator/` | Fork subagents, coordinator swarms, teammate runner | [Coordinator & swarms →](/architecture/coordinator-swarms) |
| **Tool system** | `src/tool/`, `src/mcp/` | 35+ native tools, MCP integration, skill system | [Tools reference →](/reference/tools-reference) |
| **Context pipeline** | `src/session/engine/` | System prompt assembly, section registry, instructions, plan reminders | [Context & memory →](/architecture/context-memory) |
| **Transport** | `src/server/`, `src/lsp/`, `src/acp/` | HTTP/SSE, LSP stdio, ACP, Extension Callbacks | [Transport channels →](/architecture/transport-channels) |
| **Storage** | `src/storage/` | SQLite, full-text search, session persistence | — |
| **Telemetry** | `src/telemetry/` | OpenTelemetry, Langfuse, Perfetto trace export | [Telemetry →](/architecture/telemetry) |
| **Security** | `src/permission/`, `src/server/middleware.ts` | Permission service, middleware stack, sandboxing | [Security model →](/architecture/security-model) |
| **Config** | `src/config/`, `src/flag/` | Layered merge, Zod schema, feature flags | [Settings →](/configuration/settings) |
| **Hooks** | `src/hook/` | Lifecycle event hooks (command, HTTP, prompt, agent) | [Hooks →](/build/hooks) |
| **Authentication** | `src/auth/` | OAuth (Copilot, Code Assist), Codex, AI4ALL | [Provider system →](/architecture/provider-system) |
| **Shell** | `src/shell/` | Shell detection and safe defaults | — |
| **Snapshot** | `src/snapshot/` | File state checkpointing for `/undo` | — |
| **Plugins** | `src/plugin/` | Plugin registry, install, marketplace | — |
| **Skills** | `src/skill/` | Skill discovery, loading, frontmatter parsing | — |
| **Scheduler** | `src/scheduler/` | Task scheduling infrastructure | — |
| **Isolation** | `src/isolation/`, `src/worktree/` | Git worktree isolation for parallel agents | — |
| **Infrastructure** | `src/project/`, `src/file/`, `src/lsp/` | Workspace management, filesystem, 40 LSP adapters | — |

## Multi-tenant design

LiteAI is a **multi-tenant, multi-session** server:

- **Tenant isolation** is achieved through **project instances** — each project gets its own runtime context with isolated configuration, storage, and session state
- **Session isolation** ensures concurrent sessions within the same project do not share mutable state
- **Coordinator teammate isolation** uses `AsyncLocalStorage` to provide each in-process teammate with its own execution context

```mermaid
graph TB
    Server[LiteAI Server]
    
    subgraph "Project A"
        PA[Instance A]
        SA1[Session 1]
        SA2[Session 2]
        PA --> SA1
        PA --> SA2
    end
    
    subgraph "Project B"
        PB[Instance B]
        SB1[Session 1]
        PB --> SB1
    end
    
    Server --> PA
    Server --> PB
```

## Data flow — a single turn

```mermaid
sequenceDiagram
    participant Client
    participant Router as API Router
    participant MW as Middleware
    participant Session as Session Engine
    participant SP as System Prompt
    participant Tools as Tool Registry
    participant Perm as Permission Service
    participant LLM as Provider Adapter

    Client->>Router: POST /session/:id/message
    Router->>MW: Auth + CSRF + CORS + Tracing
    MW->>Session: Dispatch to session
    Session->>SP: Assemble system prompt
    SP-->>Session: Rendered prompt sections
    Session->>Tools: Get tool definitions
    Tools-->>Session: Tool schemas
    Session->>LLM: Query (system + history + tools)
    LLM-->>Session: Stream response
    
    alt Tool call in response
        Session->>Perm: Check permission
        Perm-->>Session: Approved/Denied
        Session->>Tools: Execute tool
        Tools-->>Session: Tool result
        Session->>Session: Checkpoint state
        Session->>LLM: Continue with result
    end
    
    Session-->>Client: SSE event stream
```

## Technology stack

| Layer | Technology |
|---|---|
| **Runtime** | Bun |
| **HTTP framework** | Hono |
| **Database** | SQLite (via bun:sqlite) |
| **Schema validation** | Zod |
| **Effect system** | Effect (typed errors, dependency injection) |
| **Telemetry** | OpenTelemetry SDK + Langfuse |
| **Package management** | Bun workspaces (monorepo) |
| **Testing** | Bun test runner |
| **Build** | TypeScript + Bun bundler |

## Feature completion

For a detailed breakdown of what's implemented vs. planned, see the [Feature status overview](/roadmap/feature-status).

## What's next?

- [**Session engine & loop**](/architecture/session-engine) — How the agent loop processes turns
- [**Provider system**](/architecture/provider-system) — Multi-provider adapter architecture
- [**Coordinator & swarms**](/architecture/coordinator-swarms) — Agent orchestration design
