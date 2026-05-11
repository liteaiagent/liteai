---
title: Environment variables
description: "Complete reference for all LiteAI environment variables — core, configuration, feature toggles, server, telemetry, and provider keys."
---

# Environment variables

All LiteAI environment variables use the `LITEAI_` prefix. These take precedence over `settings.json` values but are overridden by CLI flags.

```
CLI flags > Environment variables > Project settings > Global settings
```

---

## Model & provider

| Variable | Type | Default | Description |
|---|---|---|---|
| `LITEAI_PROVIDER` | string | auto-detect | Override LLM provider |
| `LITEAI_MODEL` | string | provider default | Override model (e.g., `claude-sonnet-4-20250514`) |

---

## Configuration paths

| Variable | Type | Description |
|---|---|---|
| `LITEAI_CONFIG` | string | Absolute path to a custom `settings.json` file |
| `LITEAI_CONFIG_DIR` | string | Absolute path to a custom `.liteai/` directory |
| `LITEAI_CONFIG_CONTENT` | string | Inline JSON config content (overrides file-based config) |
| `LITEAI_TUI_CONFIG` | string | Path to TUI-specific configuration file |
| `LITEAI_HOME` | string | Override the `.liteai` home directory location (default: `~/.liteai`) |
| `LITEAI_PLUGIN_DIR` | string | Comma-separated plugin directories |
| `LITEAI_DISABLE_PROJECT_CONFIG` | boolean | Ignore project-level `settings.json` |

---

## Permission & mode

| Variable | Type | Default | Description |
|---|---|---|---|
| `LITEAI_PERMISSION` | string | — | JSON permission object (overrides `permission` in settings) |
| `LITEAI_PERMISSION_MODE` | string | `default` | Permission mode preset |
| `LITEAI_COORDINATOR_MODE` | boolean | `false` | Enable coordinator mode (multi-agent orchestration) |
| `LITEAI_FORK_SUBAGENT` | boolean | `false` | Enable fork subagent model (cache-identical spawning) |
| `LITEAI_PLATFORM` | string | `liteai` | Platform profile for instruction file conventions (`liteai`, `claude`, `gemini`, `codex`) |
| `LITEAI_CLIENT` | string | `cli` | Client identifier (e.g., `cli`, `vscode`, `web`) |

---

## Feature toggles

| Variable | Type | Default | Description |
|---|---|---|---|
| `LITEAI_DISABLE_AUTOCOMPACT` | boolean | `false` | Disable auto-compaction when context is full |
| `LITEAI_DISABLE_PRUNE` | boolean | `false` | Disable tool output pruning |
| `LITEAI_DISABLE_AUTOUPDATE` | boolean | `false` | Disable auto-update checks |
| `LITEAI_DISABLE_AGENTS` | boolean | `false` | Ignore global agent folders |
| `LITEAI_DISABLE_SKILLS` | boolean | `false` | Ignore global skill folders |
| `LITEAI_DISABLE_MEMORY` | boolean | `false` | Disable agent memory |
| `LITEAI_DISABLE_FILEWATCHER` | boolean | `false` | Disable file system watcher |
| `LITEAI_DISABLE_LSP_DOWNLOAD` | boolean | `false` | Disable automatic LSP server binary downloads |
| `LITEAI_DISABLE_TERMINAL_TITLE` | boolean | `false` | Disable terminal title updates |
| `LITEAI_DISABLE_MODELS_FETCH` | boolean | `false` | Disable fetching model registry from models.dev |
| `LITEAI_DISABLE_FILETIME_CHECK` | boolean | `false` | Disable file modification time checks (used to detect external edits) |
| `LITEAI_ENABLE_ALPHA_MODELS` | boolean | `false` | Show alpha/preview models in model selection |
| `LITEAI_INJECT_SKILLS_IN_SYSTEM_PROMPT` | boolean | `false` | Inject skill descriptions directly into the system prompt |

---

## Compaction tuning

| Variable | Type | Description |
|---|---|---|
| `LITEAI_COMPACTION_BUFFER_TOKENS` | number | Token buffer reserved during compaction to avoid overflow |
| `LITEAI_PRUNE_MINIMUM_TOKENS` | number | Minimum token count before pruning is considered |
| `LITEAI_PRUNE_PROTECT_TOKENS` | number | Token count of recent messages protected from pruning |

---

## Server

| Variable | Type | Description |
|---|---|---|
| `LITEAI_SERVER_PASSWORD` | string | Server authentication password (enables basic auth) |
| `LITEAI_SERVER_USERNAME` | string | Server authentication username (default: `liteai`) |
| `LITEAI_SERVER_CSRF_TOKEN` | string | CSRF bearer token for API access |

---

## Shell & tools

| Variable | Type | Description |
|---|---|---|
| `LITEAI_GIT_BASH_PATH` | string | Custom path to Git Bash executable (Windows) |
| `LITEAI_BASH_TIMEOUT_MS` | number | Shell command execution timeout in ms |
| `LITEAI_OUTPUT_TOKEN_MAX` | number | Maximum tokens in tool output before truncation |

---

## Model registry

| Variable | Type | Description |
|---|---|---|
| `LITEAI_MODELS_URL` | string | Custom URL for the models.dev registry |
| `LITEAI_MODELS_PATH` | string | Local path to a models.dev registry file (testing/offline use) |

---

## Telemetry

| Variable | Type | Description |
|---|---|---|
| `LITEAI_TELEMETRY` | string | Telemetry level (`off`, `basic`, `verbose`) |
| `LITEAI_TELEMETRY_EXPORTER` | string | Exporter type (`console`, `otlp`, `perfetto`) |

---

## Isolation

| Variable | Type | Description |
|---|---|---|
| `LITEAI_ISOLATION` | string | Sandbox mode (`none`, `worktree`, `docker`) |

---

## Provider API keys

These environment variables authenticate with LLM providers. They don't use the `LITEAI_` prefix:

| Variable | Provider |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI |
| `GOOGLE_API_KEY` | Google (Gemini) |
| `AWS_ACCESS_KEY_ID` | AWS Bedrock |
| `AWS_SECRET_ACCESS_KEY` | AWS Bedrock |
| `AWS_REGION` | AWS Bedrock (region) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google Vertex AI |

Provider API keys can also be set in `settings.json` under `provider.<id>.options.apiKey`.

---

## Sharing

| Variable | Type | Description |
|---|---|---|
| `LITEAI_AUTO_SHARE` | boolean | Enable automatic session sharing |

---

## Development & testing

These variables are primarily for LiteAI development and testing:

| Variable | Type | Description |
|---|---|---|
| `LITEAI_DB_MEMORY` | boolean | Use in-memory SQLite database |
| `LITEAI_DISABLE_CHANNEL_DB` | boolean | Disable channel database operations |
| `LITEAI_SKIP_MIGRATIONS` | boolean | Skip database schema migrations |
| `LITEAI_FAKE_VCS` | string | Fake VCS backend for testing |

---

:::note
On Windows, boolean flags accept `"true"` or `"1"` (case-insensitive). Any other value or absence is treated as `false`.
:::

## What's next?

- [**Settings reference**](/configuration/settings) — Full settings.json schema
- [**Tools reference**](/reference/tools-reference) — Available tools
