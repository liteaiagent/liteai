---
trigger: always_on
---

# liteai Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-15

## Active Technologies
- SQLite (via drizzle-orm) for session/message persistence + JSONL sidechain transcript files on disk (003-fork-subagent-durability)
- TypeScript 5.x (strict mode) on Bun 1.x runtime + ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), effect, remeda, @opentelemetry/api (004-plan-mode)
- SQLite via drizzle-orm (session persistence, PlanModeState as JSON column) (004-plan-mode)

- TypeScript 5.x (strict mode) on Bun 1.x runtime + ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), effect, remeda, @modelcontextprotocol/sdk, @opentelemetry/api, gray-matter, node:async_hooks (AsyncLocalStorage) (002-subagent-architecture)

## Project Structure

```text
src/
tests/
```

## Commands

bun typecheck; bun lint

## Code Style

TypeScript 5.x (strict mode) on Bun 1.x runtime: Follow standard conventions

## Recent Changes
- 004-plan-mode: Added TypeScript 5.x (strict mode) on Bun 1.x runtime + ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), effect, remeda, @opentelemetry/api
- 003-fork-subagent-durability: Added TypeScript 5.x (strict mode) on Bun 1.x runtime + ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), effect, remeda, @modelcontextprotocol/sdk, @opentelemetry/api, gray-matter, node:async_hooks (AsyncLocalStorage)

- 002-subagent-architecture: Added TypeScript 5.x on Bun 1.x runtime + ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), effect, remeda, @modelcontextprotocol/sdk, @opentelemetry/api, gray-matter, node:async_hooks (AsyncLocalStorage)

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
