---
title: "Architecture: Security model"
description: "Middleware stack, permission system internals, sandbox modes, and tenant isolation."
---

# Security model

> **Source:** `src/server/middleware.ts`, `src/permission/`, `src/isolation/`

## Middleware stack

Every HTTP request passes through 7 middleware layers:

| Order | Middleware | Purpose |
|---|---|---|
| 1 | `requestTracer()` | OpenTelemetry span creation |
| 2 | `requestLogger()` | Request/response audit logging |
| 3 | `corsMiddleware()` | CORS headers for cross-origin web clients |
| 4 | `csrfMiddleware()` | CSRF token validation (bearer token) |
| 5 | `authMiddleware()` | Username/password or token authentication |
| 6 | `projectContextMiddleware()` | Inject project instance into request context |
| 7 | `errorHandler()` | Structured error responses |

## Permission service

**Source:** `src/permission/service.ts`

The permission service classifies tool calls and routes them for approval:

1. **Check durable rules** — Session-scoped persistent allow/deny rules
2. **Check mode** — Plan mode blocks all writes; bypass mode allows all
3. **Classifier pre-approval** — For coordinator teammates, a classifier can auto-approve
4. **Prompt user** — In default mode, show the action and wait for approval

### Permission modes

| Mode | Behavior |
|---|---|
| `default` | Prompt for each new action type |
| `auto` | Auto-approve non-dangerous actions |
| `bypass` | Auto-approve everything |
| `plan` | Deny all write/execute actions |

## Sandbox modes

| Sandbox | Source | Isolation |
|---|---|---|
| **Worktree** | `src/worktree/` | Git-level — isolated working copy |
| **Docker** | `src/isolation/docker.ts` | Container-level — mapped volumes |
| **None** | Default | No isolation |

Worktree isolation creates a separate git worktree for the agent, with changes merged back on completion. The worktree manager handles lifecycle, mtime refresh (to prevent GC races), and cleanup.

## Tenant isolation

- **Project instances** provide logical separation per project
- **Session state** is never shared between concurrent sessions
- **Coordinator teammates** use `AsyncLocalStorage` with deep-cloned `AppState` snapshots
- **Cache-safe params** use session-scoped LRU caches (max 256 entries) to prevent cross-tenant cache pollution
