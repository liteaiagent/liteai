---
trigger: always_on
---

# liteai Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-17

## Active Technologies
- SQLite (via drizzle-orm) for session/message persistence + JSONL sidechain transcript files on disk (003-fork-subagent-durability)
- TypeScript 5.x (strict mode) on Bun 1.x runtime + ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), effect, remeda, @opentelemetry/api (004-plan-mode)
- SQLite via drizzle-orm (session persistence, PlanModeState as JSON column) (004-plan-mode)
- TypeScript 5.x on Bun 1.x runtime (for both build tools and typing) + SolidJS, Kobalte, vanilla CSS (005-plan-mode-ui-minimal)
- TypeScript 5.x (strict mode) on Bun 1.x runtime + ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), @opentelemetry/api, gray-matter (main)
- SQLite (via drizzle-orm) for session persistence + in-memory `PlanModeStateRef` per session (main)
- TypeScript 5.x on Bun 1.x runtime + SolidJS, Kobalte (for UI), Drizzle ORM (for backend SQLite storage) (007-prompt-tray-redesign)
- SQLite (via drizzle) (007-prompt-tray-redesign)

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
- 007-prompt-tray-redesign: Added TypeScript 5.x on Bun 1.x runtime + SolidJS, Kobalte (for UI), Drizzle ORM (for backend SQLite storage)
- main: Added TypeScript 5.x (strict mode) on Bun 1.x runtime + ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), @opentelemetry/api, gray-matter
- 005-plan-mode-ui-minimal: Added TypeScript 5.x on Bun 1.x runtime (for both build tools and typing) + SolidJS, Kobalte, vanilla CSS


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
