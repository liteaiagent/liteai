# LiteAI Core — Addon & Configuration Systems

> **Scope:** `src/mcp/`, `src/plugin/`, `src/agent/`, `src/skill/`, `src/hook/`, `src/command/`, `src/bundled/`, `src/style/`  
> **Last audited:** 2026-05-09

---

## 1. MCP Client

| Feature | Status | Source |
|---|:---:|---|
| MCP Client Initialization | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) |
| Stdio Transport (local) | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `StdioClientTransport` |
| StreamableHTTP Transport (remote) | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `StreamableHTTPClientTransport` |
| SSE Transport (remote fallback) | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `SSEClientTransport` |
| MCP Config Loader | ✅ | [`mcp/loader.ts`](../../packages/core/src/mcp/loader.ts) |
| MCP OAuth Provider | ✅ | [`mcp/oauth-provider.ts`](../../packages/core/src/mcp/oauth-provider.ts) |
| MCP OAuth Callback | ✅ | [`mcp/oauth-callback.ts`](../../packages/core/src/mcp/oauth-callback.ts) |
| MCP Auth Flow | ✅ | [`mcp/auth.ts`](../../packages/core/src/mcp/auth.ts) |
| MCP Tool Conversion (→ AI SDK) | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `convertMcpTool()` |
| MCP Tool List Changed (notify) | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `ToolsChanged` event |
| MCP Connect / Disconnect | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `connect()`, `disconnect()` |
| MCP Dynamic Add | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `add()` |
| MCP Status Tracking | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `status()` |
| MCP Prompt Listing | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `fetchPromptsForClient()` |
| MCP Resource Listing | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `fetchResourcesForClient()` |
| Agent-scoped MCP | ✅ | [`mcp/agent-mcp.ts`](../../packages/core/src/mcp/agent-mcp.ts) |
| Project-scoped MCP Sync | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `sync()` |
| Global MCP `.mcp.json` | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `loadMergedMcpConfigs()` |
| Env Variable Expansion | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `expandDeep()` |
| Process Cleanup (PID tracking) | ✅ | [`mcp/index.ts`](../../packages/core/src/mcp/index.ts) `pids` set, exit handler |

---

## 2. Plugin System

| Feature | Status | Source |
|---|:---:|---|
| Plugin Registry | ✅ | [`plugin/registry.ts`](../../packages/core/src/plugin/registry.ts) |
| Plugin Loader (convention-based) | ✅ | [`plugin/loader.ts`](../../packages/core/src/plugin/loader.ts) |
| Plugin Manifest | ✅ | [`plugin/manifest.ts`](../../packages/core/src/plugin/manifest.ts) |
| Plugin Types | ✅ | [`plugin/types.ts`](../../packages/core/src/plugin/types.ts) |
| Plugin Cache | ✅ | [`plugin/cache.ts`](../../packages/core/src/plugin/cache.ts) |
| Plugin Download | ✅ | [`plugin/download.ts`](../../packages/core/src/plugin/download.ts) |
| Plugin Mount | ✅ | [`plugin/mount.ts`](../../packages/core/src/plugin/mount.ts) |
| Plugin Env | ✅ | [`plugin/env.ts`](../../packages/core/src/plugin/env.ts) |
| Plugin Marketplace | ✅ | [`plugin/marketplace.ts`](../../packages/core/src/plugin/marketplace.ts) |
| Plugin Marketplace Source | ✅ | [`plugin/marketplace-source.ts`](../../packages/core/src/plugin/marketplace-source.ts) |
| Plugin Index (exports) | ✅ | [`plugin/index.ts`](../../packages/core/src/plugin/index.ts) |

---

## 3. Agent System

| Feature | Status | Source |
|---|:---:|---|
| Agent Model | ✅ | [`agent/agent.ts`](../../packages/core/src/agent/agent.ts) (16KB) |
| Agent Metadata | ✅ | [`agent/agent-meta.ts`](../../packages/core/src/agent/agent-meta.ts) |
| Agent Loader | ✅ | [`agent/loader.ts`](../../packages/core/src/agent/loader.ts) |
| Agent Context (root detection) | ✅ | [`agent/context.ts`](../../packages/core/src/agent/context.ts) |
| Agent Events | ✅ | [`agent/events.ts`](../../packages/core/src/agent/events.ts) |
| Agent Errors | ✅ | [`agent/errors.ts`](../../packages/core/src/agent/errors.ts) |
| Agent Filter | ✅ | [`agent/filter.ts`](../../packages/core/src/agent/filter.ts) |
| Agent Fork | ✅ | [`agent/fork.ts`](../../packages/core/src/agent/fork.ts) (15KB) |
| Agent Lifecycle | ✅ | [`agent/lifecycle.ts`](../../packages/core/src/agent/lifecycle.ts) (16KB) |
| Agent Memory | ✅ | [`agent/memory.ts`](../../packages/core/src/agent/memory.ts) |
| Agent Policy | ✅ | [`agent/policy.ts`](../../packages/core/src/agent/policy.ts) |
| Agent Resume | ✅ | [`agent/resume.ts`](../../packages/core/src/agent/resume.ts) (19KB) |
| Agent Runner | ✅ | [`agent/runner.ts`](../../packages/core/src/agent/runner.ts) (26KB) |
| Agent Writer | ✅ | [`agent/writer.ts`](../../packages/core/src/agent/writer.ts) |
| Agent Cleanup | ✅ | [`agent/cleanup.ts`](../../packages/core/src/agent/cleanup.ts) |

---

## 4. Skill System

| Feature | Status | Source |
|---|:---:|---|
| Skill Discovery | ✅ | [`skill/discovery.ts`](../../packages/core/src/skill/discovery.ts) |
| Skill Loader | ✅ | [`skill/loader.ts`](../../packages/core/src/skill/loader.ts) |
| Skill Model | ✅ | [`skill/skill.ts`](../../packages/core/src/skill/skill.ts) |
| Skill Substitution | ✅ | [`skill/substitute.ts`](../../packages/core/src/skill/substitute.ts) |
| Skill Tool (native) | ✅ | [`tool/skill.ts`](../../packages/core/src/tool/skill.ts) |

---

## 5. Hook System

| Feature | Status | Source |
|---|:---:|---|
| Hook Engine | ✅ | [`hook/hook.ts`](../../packages/core/src/hook/hook.ts) |
| Hook Loader | ✅ | [`hook/loader.ts`](../../packages/core/src/hook/loader.ts) |
| Command Hooks | ✅ | [`hook/command.ts`](../../packages/core/src/hook/command.ts) |
| HTTP Hooks | ✅ | [`hook/http.ts`](../../packages/core/src/hook/http.ts) |

---

## 6. Command System

| Feature | Status | Source |
|---|:---:|---|
| Command Registry | ✅ | [`command/index.ts`](../../packages/core/src/command/index.ts) (17KB) |
| Command Loader | ✅ | [`command/loader.ts`](../../packages/core/src/command/loader.ts) |
| Command Semantics | ✅ | [`command/semantics.ts`](../../packages/core/src/command/semantics.ts) |
| Background Task Registry | ✅ | [`command/background.ts`](../../packages/core/src/command/background.ts) |

---

## 7. Bundled Assets

| Category | Items | Source |
|---|---|---|
| Agents | `build`, `compaction`, `explore`, `general`, `plan`, `summary`, `title` | [`bundled/agents/`](../../packages/core/src/bundled/agents/) |
| Commands | `initialize`, `review` | [`bundled/commands/`](../../packages/core/src/bundled/commands/) |
| Skills | `debug`, `simplify` | [`bundled/skills/`](../../packages/core/src/bundled/skills/) |
| Prompts | `agents/`, `misc/`, `system/`, `tools/`, `toolsv1/` | [`bundled/prompts/`](../../packages/core/src/bundled/prompts/) |
| Index | ✅ | [`bundled/index.ts`](../../packages/core/src/bundled/index.ts) |

---

## 8. Output Style

| Feature | Status | Source |
|---|:---:|---|
| Style Service | ✅ | [`style/style.ts`](../../packages/core/src/style/style.ts) |

---

## Summary

| Category | ✅ | 🔶 | ❌ | Total |
|---|:---:|:---:|:---:|:---:|
| MCP Client | 20 | 0 | 0 | 20 |
| Plugin System | 11 | 0 | 0 | 11 |
| Agent System | 15 | 0 | 0 | 15 |
| Skill System | 5 | 0 | 0 | 5 |
| Hook System | 4 | 0 | 0 | 4 |
| Command System | 4 | 0 | 0 | 4 |
| Bundled Assets | 1 | 0 | 0 | 1 |
| Output Style | 1 | 0 | 0 | 1 |
| **Total** | **61** | **0** | **0** | **61** |
