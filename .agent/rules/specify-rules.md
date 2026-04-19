---
trigger: always_on
---

# liteai Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-19

## Active Technologies
- SQLite (via drizzle-orm) for session/message persistence + JSONL sidechain transcript files on disk (003-fork-subagent-durability)
- TypeScript 5.x (strict mode) on Bun 1.x runtime + ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), effect, remeda, @opentelemetry/api (004-plan-mode)
- SQLite via drizzle-orm (session persistence, PlanModeState as JSON column) (004-plan-mode)
- TypeScript 5.x on Bun 1.x runtime (for both build tools and typing) + SolidJS, Kobalte, vanilla CSS (005-plan-mode-ui-minimal)
- TypeScript 5.x (strict mode) on Bun 1.x runtime + ai (Vercel AI SDK), zod, hono (HTTP/SSE), drizzle-orm (SQLite), @opentelemetry/api, gray-matter (main)
- SQLite (via drizzle-orm) for session persistence + in-memory `PlanModeStateRef` per session (main)
- TypeScript 5.x on Bun 1.x runtime + SolidJS, Kobalte (for UI), Drizzle ORM (for backend SQLite storage) (007-prompt-tray-redesign)
- SQLite (via drizzle) (007-prompt-tray-redesign)
- [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION] + [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION] (008-agent-experience-ui)
- [if applicable, e.g., PostgreSQL, CoreData, files or N/A] (008-agent-experience-ui)
- TypeScript 5.x (strict mode) on Bun 1.x runtime + SolidJS, Kobalte, Vanilla CSS (frontend), Hono SSE, ai sdk, zod (backend) (008-agent-experience-ui)
- SQLite (via drizzle-orm) for state validation (008-agent-experience-ui)
- TypeScript 5.x (strict mode) on Bun 1.x runtime + SolidJS, Kobalte, Vanilla CSS (frontend), Hono SSE (transport, already wired) (008-agent-experience-ui)
- N/A — all state is in-memory reactive signals, sourced from SSE events (008-agent-experience-ui)

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
- 008-agent-experience-ui: Added TypeScript 5.x (strict mode) on Bun 1.x runtime + SolidJS, Kobalte, Vanilla CSS (frontend), Hono SSE (transport, already wired)
- 008-agent-experience-ui: Added TypeScript 5.x (strict mode) on Bun 1.x runtime + SolidJS, Kobalte, Vanilla CSS (frontend), Hono SSE, ai sdk, zod (backend)
- 008-agent-experience-ui: Added [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION] + [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
