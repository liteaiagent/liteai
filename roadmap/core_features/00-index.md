# LiteAI Core — Feature Status Index

> **Package:** `packages/core`  
> **Last audited:** 2026-05-09  
> **Legend:** ✅ Implemented · 🔶 Partial · ❌ Not Started · 📁 Folder Reference

---

## Document Map

| # | Document | Domain | Status |
|---|---|---|---|
| 01 | [Engine & Loop](./01-engine.md) | Session loop, HITL, compaction, loop detection, plan mode, step mode, sub-agents, memory | ✅ |
| 02 | [Addon & Config](./02-addon-config.md) | MCP, plugins, skills, agents, hooks, commands, bundled assets | ✅ |
| 03 | [Providers & Models](./03-providers.md) | Provider loaders, model registry, auth, SDK transforms | 🔶 |
| 04 | [Server & API](./04-server-api.md) | HTTP server, routes, middleware, SSE, OpenAPI | 🔶 |
| 05 | [Infrastructure](./05-infrastructure.md) | Storage, telemetry, project, control-plane, worktree, isolation, LSP | 🔶 |

---

## Source Directory Map

Complete scan of `packages/core/src/` — every top-level module with its document assignment.

| Module | Path | Document | Files |
|---|---|---|---|
| `session/` | `src/session/` | [01-engine](./01-engine.md) | `index.ts`, `llm.ts`, `message.ts`, `plan-mode-state.ts`, `processor.ts`, `retry.ts`, `revert.ts`, `schema.ts`, `session.sql.ts`, `status.ts`, `step-back.ts`, `todo.ts`, `transcript.ts`, `events.ts` |
| `session/engine/` | `src/session/engine/` | [01-engine](./01-engine.md) | `loop.ts`, `query.ts`, `persister.ts`, `pipeline.ts`, `input.ts`, `instruction.ts`, `system.ts`, `tools.ts`, `shell.ts`, `command.ts`, `namespace.ts`, `section-parser.ts`, `section-registry.ts`, `streaming-tool-executor.ts`, `compaction-orchestrator.ts`, `correction-injector.ts`, `loop-detection.ts`, `thinking-loop-detector.ts`, `stop-drift.ts`, `plan-reminder.ts`, `telemetry.ts` |
| `session/engine/loop/` | `src/session/engine/loop/` | [01-engine](./01-engine.md) | `checkpoint-store.ts`, `checkpointer.ts`, `promise-tracker.ts`, `step-latch.ts` |
| `session/tasks/` | `src/session/tasks/` | [01-engine](./01-engine.md) | `compaction.ts`, `context-breakdown.ts`, `description.ts`, `summary.ts`, `title.ts` |
| `permission/` | `src/permission/` | [01-engine](./01-engine.md) | `arity.ts`, `classifier.ts`, `next.ts`, `sandbox.ts`, `schema.ts`, `service.ts` |
| `tool/` | `src/tool/` | [01-engine](./01-engine.md) | 31 tool files, `registry.ts`, `schema.ts`, `tool.ts` |
| `mcp/` | `src/mcp/` | [02-addon](./02-addon-config.md) | `index.ts`, `loader.ts`, `auth.ts`, `agent-mcp.ts`, `oauth-callback.ts`, `oauth-provider.ts` |
| `plugin/` | `src/plugin/` | [02-addon](./02-addon-config.md) | `index.ts`, `loader.ts`, `registry.ts`, `cache.ts`, `download.ts`, `env.ts`, `manifest.ts`, `marketplace-source.ts`, `marketplace.ts`, `mount.ts`, `types.ts` |
| `agent/` | `src/agent/` | [02-addon](./02-addon-config.md) | `agent.ts`, `agent-meta.ts`, `cleanup.ts`, `context.ts`, `errors.ts`, `events.ts`, `filter.ts`, `fork.ts`, `lifecycle.ts`, `loader.ts`, `memory.ts`, `policy.ts`, `resume.ts`, `runner.ts`, `writer.ts` |
| `skill/` | `src/skill/` | [02-addon](./02-addon-config.md) | `discovery.ts`, `loader.ts`, `skill.ts`, `substitute.ts` |
| `hook/` | `src/hook/` | [02-addon](./02-addon-config.md) | `command.ts`, `hook.ts`, `http.ts`, `loader.ts` |
| `command/` | `src/command/` | [02-addon](./02-addon-config.md) | `background.ts`, `index.ts`, `loader.ts`, `semantics.ts` |
| `bundled/` | `src/bundled/` | [02-addon](./02-addon-config.md) | `agents/` (7 agents), `commands/` (2), `skills/` (2), `prompts/` (5 dirs) |
| `provider/` | `src/provider/` | [03-providers](./03-providers.md) | `provider.ts`, `state.ts`, `sdk.ts`, `models.ts`, `auth.ts`, `auth-service.ts`, `error.ts`, `schema.ts`, `sse.ts`, `transform.ts` |
| `provider/loaders/` | `src/provider/loaders/` | [03-providers](./03-providers.md) | 20+ provider loaders (anthropic, openai, google, bedrock, copilot, etc.) |
| `provider/sdk/` | `src/provider/sdk/` | [03-providers](./03-providers.md) | `code-assist/`, `copilot/` |
| `provider/transform/` | `src/provider/transform/` | [03-providers](./03-providers.md) | `message.ts`, `options.ts`, `variants.ts` |
| `server/` | `src/server/` | [04-server](./04-server-api.md) | `server.ts`, `middleware.ts`, `constants.ts`, `error.ts`, `event.ts`, `mdns.ts` |
| `server/routes/` | `src/server/routes/` | [04-server](./04-server-api.md) | 21 route files |
| `config/` | `src/config/` | [04-server](./04-server-api.md) | `config.ts`, `loader.ts`, `markdown.ts`, `paths.ts`, `schema.ts` |
| `storage/` | `src/storage/` | [05-infra](./05-infrastructure.md) | `db.ts`, `fts.ts`, `schema.sql.ts`, `schema.ts`, `storage.ts` |
| `telemetry/` | `src/telemetry/` | [05-infra](./05-infrastructure.md) | `diagnostic.ts`, `factories.ts`, `instrumentation.ts`, `perfetto.ts` |
| `project/` | `src/project/` | [05-infra](./05-infrastructure.md) | `bootstrap.ts`, `instance.ts`, `project.ts`, `project.sql.ts`, `schema.ts`, `state.ts`, `vcs.ts` |
| `control-plane/` | `src/control-plane/` | [05-infra](./05-infrastructure.md) | `workspace.ts`, `sse.ts`, `types.ts`, `schema.ts`, `workspace-context.ts`, `workspace-router-middleware.ts`, `workspace.sql.ts`, `workspace-server/`, `adaptors/` |
| `worktree/` | `src/worktree/` | [05-infra](./05-infrastructure.md) | `index.ts` (20KB) |
| `isolation/` | `src/isolation/` | [05-infra](./05-infrastructure.md) | `docker.ts`, `registry.ts` |
| `lsp/` | `src/lsp/` | [05-infra](./05-infrastructure.md) | `client.ts`, `index.ts`, `language.ts`, `lsp-handler.ts`, `server/` (40 language servers) |
| `file/` | `src/file/` | [05-infra](./05-infrastructure.md) | `index.ts`, `ignore.ts`, `protected.ts`, `ripgrep.ts`, `time.ts`, `watcher.ts` |
| `acp/` | `src/acp/` | [05-infra](./05-infrastructure.md) | `README.md`, `agent.ts`, `events.ts`, `mapper.ts`, `model.ts`, `session.ts`, `types.ts` |
| `capabilities/` | `src/capabilities/` | [05-infra](./05-infrastructure.md) | `context.ts`, `hosted.ts`, `local.ts`, `types.ts` |
| `auth/` | `src/auth/` | [05-infra](./05-infrastructure.md) | `index.ts`, `provider.ts`, `registry.ts`, `service.ts`, `providers/` |
| `account/` | `src/account/` | [05-infra](./05-infrastructure.md) | `index.ts`, `repo.ts`, `schema.ts`, `service.ts`, `account.sql.ts` |
| `share/` | `src/share/` | [05-infra](./05-infrastructure.md) | `share-next.ts`, `share.sql.ts` |
| `snapshot/` | `src/snapshot/` | [05-infra](./05-infrastructure.md) | `index.ts` (11KB) |
| `scheduler/` | `src/scheduler/` | [05-infra](./05-infrastructure.md) | `index.ts` |
| Misc singles | `src/` | Various | `main.ts`, `runtime.ts`, `brand.ts`, `md.d.ts`, `sql.d.ts` |
| `bus/` | `src/bus/` | [05-infra](./05-infrastructure.md) | `index.ts`, `bus-event.ts`, `global.ts`, `tui-event.ts` |
| `env/` | `src/env/` | [05-infra](./05-infrastructure.md) | `index.ts` |
| `flag/` | `src/flag/` | [05-infra](./05-infrastructure.md) | `flag.ts` |
| `format/` | `src/format/` | [01-engine](./01-engine.md) | `formatter.ts`, `index.ts` |
| `style/` | `src/style/` | [02-addon](./02-addon-config.md) | `style.ts` |
| `feedback/` | `src/feedback/` | [04-server](./04-server-api.md) | `feedback.ts` |
| `question/` | `src/question/` | [01-engine](./01-engine.md) | `index.ts`, `schema.ts`, `service.ts` |
| `patch/` | `src/patch/` | [01-engine](./01-engine.md) | `index.ts` (21KB) |
| `ide/` | `src/ide/` | [05-infra](./05-infrastructure.md) | `index.ts` |
| `platform/` | `src/platform/` | [05-infra](./05-infrastructure.md) | `index.ts`, `profile.ts`, `profiles/` |
| `installation/` | `src/installation/` | [05-infra](./05-infrastructure.md) | `index.ts` |
| `global/` | `src/global/` | [05-infra](./05-infrastructure.md) | `index.ts` |
| `id/` | `src/id/` | [05-infra](./05-infrastructure.md) | — |
| `effect/` | `src/effect/` | [05-infra](./05-infrastructure.md) | `runtime.ts` |
| `bun/` | `src/bun/` | [05-infra](./05-infrastructure.md) | — |
| `util/` | `src/util/` | — | Internal utilities (not documented) |
