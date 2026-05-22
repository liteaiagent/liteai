# LiteAI Core — Server & API Layer

> **Scope:** `src/server/`, `src/server/routes/`, `src/config/`, `src/feedback/`  
> **Last audited:** 2026-05-09

---

## 1. HTTP Server

| Feature | Status | Source |
|---|:---:|---|
| Hono App Factory | ✅ | [`server/server.ts`](../../packages/core/src/server/server.ts) |
| Server Listen / Shutdown | ✅ | [`server/server.ts`](../../packages/core/src/server/server.ts) |
| mDNS Discovery | ✅ | [`server/mdns.ts`](../../packages/core/src/server/mdns.ts) |
| API Constants | ✅ | [`server/constants.ts`](../../packages/core/src/server/constants.ts) |
| Server Error Model | ✅ | [`server/error.ts`](../../packages/core/src/server/error.ts) |
| Server Events | ✅ | [`server/event.ts`](../../packages/core/src/server/event.ts) |

---

## 2. Middleware Stack

| Feature | Status | Source |
|---|:---:|---|
| CSRF Protection | ✅ | [`server/middleware.ts`](../../packages/core/src/server/middleware.ts) `csrfMiddleware()` |
| Auth Middleware | ✅ | [`server/middleware.ts`](../../packages/core/src/server/middleware.ts) `authMiddleware()` |
| CORS Middleware | ✅ | [`server/middleware.ts`](../../packages/core/src/server/middleware.ts) `corsMiddleware()` |
| Request Tracer (OTel) | ✅ | [`server/middleware.ts`](../../packages/core/src/server/middleware.ts) `requestTracer()` |
| Request Logger | ✅ | [`server/middleware.ts`](../../packages/core/src/server/middleware.ts) `requestLogger()` |
| Project Context Middleware | ✅ | [`server/middleware.ts`](../../packages/core/src/server/middleware.ts) `projectContextMiddleware()` |
| Error Handler | ✅ | [`server/middleware.ts`](../../packages/core/src/server/middleware.ts) `errorHandler()` |

---

## 3. API Route Tiers

### Tier 1: Server-Level (no project context)

| Route | Status | Source |
|---|:---:|---|
| `/` — Global Routes | ✅ | [`routes/global.ts`](../../packages/core/src/server/routes/global.ts) (15KB) |
| `/system` — System Info | ✅ | [`routes/system.ts`](../../packages/core/src/server/routes/system.ts) |
| `/auth` — Auth Routes | ✅ | [`routes/auth.ts`](../../packages/core/src/server/routes/auth.ts) |
| `/provider` — Provider CRUD | ✅ | [`routes/provider.ts`](../../packages/core/src/server/routes/provider.ts) |
| `/feedback` — Feedback | ✅ | [`routes/feedback.ts`](../../packages/core/src/server/routes/feedback.ts) |
| `/doc` — OpenAPI Spec | ✅ | [`server/server.ts`](../../packages/core/src/server/server.ts) inline |

### Tier 2: Project CRUD (no instance required)

| Route | Status | Source |
|---|:---:|---|
| `GET /project` — List Projects | ✅ | [`server/server.ts`](../../packages/core/src/server/server.ts) inline |
| `POST /project` — Create Project | ✅ | [`server/server.ts`](../../packages/core/src/server/server.ts) inline |
| `/project/*` — Project Routes | ✅ | [`routes/project.ts`](../../packages/core/src/server/routes/project.ts) |

### Tier 3: Project-Scoped (requires Instance)

| Route | Status | Source |
|---|:---:|---|
| `/session` — Session CRUD & SSE | ✅ | [`routes/session.ts`](../../packages/core/src/server/routes/session.ts) (43KB) |
| `/pty` — PTY Terminal | ✅ | [`routes/pty.ts`](../../packages/core/src/server/routes/pty.ts) |
| `/config` — Project Config | ✅ | [`routes/config.ts`](../../packages/core/src/server/routes/config.ts) |
| `/config/mcp` — MCP Management | ✅ | [`routes/mcp.ts`](../../packages/core/src/server/routes/mcp.ts) |
| `/config/plugin` — Plugin Management | ✅ | [`routes/plugin.ts`](../../packages/core/src/server/routes/plugin.ts) |
| `/permission` — Permissions | ✅ | [`routes/permission.ts`](../../packages/core/src/server/routes/permission.ts) |
| `/question` — HITL Questions | ✅ | [`routes/question.ts`](../../packages/core/src/server/routes/question.ts) |
| `/tool` — Tool Registry | ✅ | [`routes/tool.ts`](../../packages/core/src/server/routes/tool.ts) |
| `/style` — Output Styles | ✅ | [`routes/style.ts`](../../packages/core/src/server/routes/style.ts) |
| `/experimental` — Experimental | ✅ | [`routes/experimental.ts`](../../packages/core/src/server/routes/experimental.ts) |
| File Routes (`/file/*`) | ✅ | [`routes/file.ts`](../../packages/core/src/server/routes/file.ts) |
| Instance Routes | ✅ | [`routes/instance.ts`](../../packages/core/src/server/routes/instance.ts) |
| Workspace Routes | ✅ | [`routes/workspace.ts`](../../packages/core/src/server/routes/workspace.ts) — _registered via file route mount_ |

### Additional Routes

| Route | Status | Source |
|---|:---:|---|
| Diagnostics | ✅ | [`routes/diagnostics.ts`](../../packages/core/src/server/routes/diagnostics.ts) |
| Agent Routes | ✅ | [`routes/agent.ts`](../../packages/core/src/server/routes/agent.ts) |

---

## 4. Configuration System

📁 **Scanned:** `src/config/`

| Feature | Status | Source |
|---|:---:|---|
| Config Model | ✅ | [`config/config.ts`](../../packages/core/src/config/config.ts) |
| Config Loader (layered merge) | ✅ | [`config/loader.ts`](../../packages/core/src/config/loader.ts) (18KB) |
| Config Schema (Zod) | ✅ | [`config/schema.ts`](../../packages/core/src/config/schema.ts) (26KB) |
| Config Paths | ✅ | [`config/paths.ts`](../../packages/core/src/config/paths.ts) |
| Config Markdown Export | ✅ | [`config/markdown.ts`](../../packages/core/src/config/markdown.ts) |

---

## 5. Feedback System

| Feature | Status | Source |
|---|:---:|---|
| Feedback Service | ✅ | [`feedback/feedback.ts`](../../packages/core/src/feedback/feedback.ts) |

---

## Summary

| Category | ✅ | 🔶 | ❌ | Total |
|---|:---:|:---:|:---:|:---:|
| HTTP Server | 6 | 0 | 0 | 6 |
| Middleware | 7 | 0 | 0 | 7 |
| Tier 1 Routes | 6 | 0 | 0 | 6 |
| Tier 2 Routes | 3 | 0 | 0 | 3 |
| Tier 3 Routes | 13 | 0 | 0 | 13 |
| Additional Routes | 2 | 0 | 0 | 2 |
| Configuration | 5 | 0 | 0 | 5 |
| Feedback | 1 | 0 | 0 | 1 |
| **Total** | **43** | **0** | **0** | **43** |
