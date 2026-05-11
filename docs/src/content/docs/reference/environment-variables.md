---
title: Environment variables
description: "Complete reference for LiteAI environment variables."
---

# Environment variables

All LiteAI environment variables use the `LITEAI_` prefix.

## Core

| Variable | Default | Description |
|---|---|---|
| `LITEAI_PROVIDER` | auto-detect | Override LLM provider |
| `LITEAI_MODEL` | provider default | Override model |
| `LITEAI_PERMISSION` | — | JSON permission object |
| `LITEAI_PERMISSION_MODE` | `default` | Permission mode |
| `LITEAI_COORDINATOR_MODE` | `false` | Enable coordinator mode |
| `LITEAI_PLATFORM` | `liteai` | Platform profile (`standard`, `claude`, `gemini`, `codex`) |

## Configuration

| Variable | Description |
|---|---|
| `LITEAI_CONFIG` | Absolute path to custom settings.json |
| `LITEAI_CONFIG_DIR` | Absolute path to custom `.liteai/` directory |
| `LITEAI_PLUGIN_DIR` | Comma-separated plugin directories |
| `LITEAI_DISABLE_PROJECT_CONFIG` | Ignore project-level settings |

## Feature toggles

| Variable | Default | Description |
|---|---|---|
| `LITEAI_DISABLE_AUTOCOMPACT` | `false` | Disable auto-compaction |
| `LITEAI_DISABLE_PRUNE` | `false` | Disable tool output pruning |
| `LITEAI_DISABLE_AUTOUPDATE` | `false` | Disable auto-update checks |
| `LITEAI_DISABLE_AGENTS` | `false` | Ignore global agent folders |
| `LITEAI_DISABLE_SKILLS` | `false` | Ignore global skill folders |
| `LITEAI_DISABLE_MEMORY` | `false` | Disable agent memory |

## Server

| Variable | Description |
|---|---|
| `LITEAI_SERVER_PASSWORD` | Server authentication password |
| `LITEAI_SERVER_USERNAME` | Server authentication username |
| `LITEAI_SERVER_CSRF_TOKEN` | CSRF bearer token |

## Telemetry

| Variable | Description |
|---|---|
| `LITEAI_TELEMETRY` | Telemetry level (`off`, `basic`, `verbose`) |
| `LITEAI_TELEMETRY_EXPORTER` | Exporter type (`console`, `otlp`, `perfetto`) |

## Isolation

| Variable | Description |
|---|---|
| `LITEAI_ISOLATION` | Sandbox mode (`none`, `worktree`, `docker`) |

## Provider API keys

| Variable | Provider |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI |
| `GOOGLE_API_KEY` | Google (Gemini) |
| `AWS_ACCESS_KEY_ID` | AWS Bedrock |
| `AWS_SECRET_ACCESS_KEY` | AWS Bedrock |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google Vertex AI |

:::note
On Windows, truthy flags accept `"true"` or `"1"` (case-insensitive).
:::
