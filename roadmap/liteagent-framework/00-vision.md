# @liteagent — Open-Source Agent Framework

> **npm scope:** `@liteagent`  
> **GitHub org:** `liteaiagent`  
> **Status:** Vision — Phase 0 ready for execution  
> **Last updated:** 2026-05-09

---

## 1. The Market Gap

There is no open-source library developers can use to build tool-calling AI agents without either adopting a complex graph engine or building from scratch on top of raw LLM SDKs.

| Existing Solution | What It Is | Why It's Insufficient |
|---|---|---|
| **LangGraph / LangChain** | Graph execution engine | Too complex for loop-based agents. Forces DAG topology, node/edge abstractions, and `@langchain/core` dependency. Most coding agents are loops, not graphs. |
| **Claude Code / Gemini CLI / OpenCode** | Monolithic applications | Not libraries. You can't `npm install` them and build your own agent. To get their capabilities, you must fork and rewrite. |
| **Vercel AI SDK** | LLM stream/generation SDK | Provides `streamText`/`generateText` but zero orchestration: no loop, no checkpointing, no tool management, no permissions, no memory, no compaction. |
| **Mastra** | Full-stack AI framework | Heavy opinions on everything — routing, deployment, database. Too much framework for "I just want an agent loop." |

### The Gap

A **library** (not framework, not app) that gives developers the building blocks for a tool-calling agent:

- An execution loop with crash recovery
- Tool registration from any source (native, MCP)
- Session persistence with pluggable storage
- Agent memory across sessions
- Context window management (compaction)
- Permission/approval flows
- Plan mode (plan → approve → execute)
- **Without** forcing a specific UI, server, provider, or tool set

---

## 2. Positioning Statement

> *"LangGraph is a graph engine. Mastra is a framework. @liteagent is a toolkit."*
>
> *Most agents don't need graphs — they need `Read → Think → Act → Observe` with crash recovery, tool management, and memory. That's what this is.*
>
> *Battle-tested primitives extracted from [LiteAI](https://github.com/liteaiagent/liteai) — a production coding agent with 30+ tools, 40 LSP adapters, and 20+ provider integrations.*

---

## 3. Three-Tier Product Strategy

```
┌─────────────────────────────────────────────────────────────────────┐
│  Tier 3 — @liteai/core (PRODUCT)                                    │
│  The full LiteAI coding agent: 31 tools, 20 providers, HTTP server, │
│  LSP, TUI, VSCode extension, control plane, ACP, bundled agents     │
│  Built ON TOP of @liteagent/core                                    │
├─────────────────────────────────────────────────────────────────────┤
│  Tier 2 — @liteagent/core (FRAMEWORK)                               │
│  Agent building blocks: ToolRegistry, MCP, SessionManager, Memory,  │
│  PermissionGate, CompactionEngine, PlanMode, PromptBuilder,         │
│  LoopDetection, StepMode, InstructionLoader                        │
│  Built ON TOP of @liteagent/loop                                    │
├─────────────────────────────────────────────────────────────────────┤
│  Tier 1 — @liteagent/loop (PRIMITIVES)                              │
│  Forward-only execution loop: Checkpointer, PromiseTracker,        │
│  LoopEvent, EventConsumer, MemoryCheckpointer                      │
│  Zero dependencies. ~335 LOC. The gateway.                          │
└─────────────────────────────────────────────────────────────────────┘
```

| Tier | Package | What It Is | Target User |
|---|---|---|---|
| 1 | `@liteagent/loop` | Pure loop primitives. Zero deps. | "I want checkpointing for my `while(true)` loop" |
| 2 | `@liteagent/core` | Agent framework. DI interfaces. MCP included. | "I want to build my own coding agent" |
| 3 | `@liteai/core` | LiteAI product. Reference implementation. | "I want a complete coding agent, ready to use" |

### The Funnel

```
npm i @liteagent/loop          → user likes it
npm i @liteagent/core          → user builds an agent
discovers @liteai/core         → user sees the reference implementation
contributes back               → ecosystem grows
```

---

## 4. What a Developer Gets

### Tier 1: "I just want a loop"

```typescript
import { MemoryCheckpointer, PromiseTracker } from "@liteagent/loop"
import type { LoopEvent, Checkpointer } from "@liteagent/loop"

const checkpointer = new MemoryCheckpointer()
const tracker = new PromiseTracker()

// Wire up your own streamText → LoopEvent pipeline
// Checkpointer handles crash recovery
// PromiseTracker ensures no fire-and-forget side-effects
```

### Tier 2: "I want to build an agent"

```typescript
import {
  createAgent,
  NativeToolProvider,
  McpToolProvider,
  FileMemoryStore,
  RuleBasedGate,
  InstructionFileSection,
} from "@liteagent/core"

const agent = createAgent({
  model: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  tools: [
    new NativeToolProvider([readFileTool, writeFileTool, runCommandTool]),
    new McpToolProvider({
      servers: [
        { name: "github", command: "npx @github/mcp" },
        { name: "postgres", command: "npx @postgres/mcp", args: ["--url", DB_URL] },
      ],
    }),
  ],
  storage: new SqliteStorageAdapter("./agent.db"),
  memory: new FileMemoryStore("~/.myagent/memory"),
  permission: new RuleBasedGate(myRules),
  prompt: [
    new InstructionFileSection("AGENTS.md"),
    new EnvironmentSection(),
    new MemorySection(),
  ],
  planMode: true,
  loopDetection: true,
})

const result = await agent.run("session-1", "Fix the failing test in utils.ts")
// result: { status: "ok", message: LoopMessage } | { status: "error", error } | { status: "aborted" }
```

### Tier 3: "I want the full experience"

```bash
npm install @liteai/core
npx liteai --port 3000
# → Full HTTP server, 31 tools, 20 providers, TUI, LSP, everything
```

---

## 5. Strategic Value

### For the Ecosystem

| Value | Why It Matters |
|---|---|
| **Ecosystem positioning** | LiteAI becomes the project that *defined* the loop-based agent pattern. Others build on your primitives. |
| **Forced architectural discipline** | Clean interfaces prevent coupling from creeping back into `packages/core`. |
| **Adoption funnel** | `npm i @liteagent/loop` → user discovers LiteAI. Classic OSS flywheel. |
| **Community contributions** | Others build `PostgresCheckpointer`, `RedisStorageAdapter`, `S3MemoryStore`. You don't maintain them. |
| **Competitive moat** | The framework is open. The product (tools, prompts, LSP, provider integrations) is the moat. |

### For LiteAI

| Value | Why It Matters |
|---|---|
| **Better architecture** | Interface boundaries make `packages/core` more testable and maintainable. |
| **Faster iteration** | Framework tests run without SQLite, without providers, without the full server. |
| **Rebranding support** | Any consumer of `@liteagent/core` brings their own brand — no `~/.liteai` dependency. |
| **Reference implementation** | LiteAI proves the framework works at production scale. |

---

## 6. Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| npm scope | `@liteagent` | Short, memorable. No redundancy in `@liteagent/core` or `@liteagent/loop`. |
| GitHub org | `liteaiagent` | Available. Doesn't need to match npm scope. |
| MCP placement | **In `@liteagent/core`** (not sub-export) | MCP is infrastructure in 2026, not optional. Every serious agent needs it. Friction of separate import not justified. |
| AI SDK coupling | Own types + AI SDK adapter | Loop core imports zero from `ai`. Adapter maps `streamText` → `LoopEvent`. Insulates from AI SDK version churn. |
| Generics | No — concrete types | TypeScript-only, Vercel AI SDK is the target. No `<TMessage, TPart>` ceremony. |
| Extraction timing | Incremental, alongside persistence roadmap | Design interfaces during implementation. Extract after battle-tested. |

---

## 7. Related Documents

- [01-architecture.md](./01-architecture.md) — Interface designs, scope analysis, dependency graph
- [02-roadmap.md](./02-roadmap.md) — Phased execution plan
- [Engine Loop Package Analysis](../engine-loop-decoupling/engine_loop_package_analysis.md) — @liteagent/loop extraction details (Tier 1)
- [Project-Scoped Persistence](../project-scoped-persistence/00-architecture.md) — Memory & session systems being designed interface-first
