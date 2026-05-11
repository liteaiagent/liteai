---
title: Troubleshoot performance and stability
description: "Resolve context window overflow, slow responses, and stability issues."
---

# Troubleshoot performance and stability

## Context window overflow

**Symptom:** Agent responses become confused or incomplete.

**Causes:**
- Very long AGENTS.md files consuming too much of the window
- Many large tool results (e.g., reading entire files)
- Auto-compaction disabled

**Fixes:**
- Shorten AGENTS.md — keep it under 1000 tokens
- Enable auto-compaction: `LITEAI_DISABLE_AUTOCOMPACT=false`
- Use fork subagents for parallel tasks (each gets its own window)
- Use Plan mode for exploration (no tool results)

## Slow responses

**Causes:**
- Large context window = more tokens to process
- Slow MCP server startup
- Network latency to provider

**Fixes:**
- Use a faster/smaller model for simple tasks
- Check MCP server health: slow servers delay tool execution
- Use a closer provider endpoint (region selection)

## High memory usage

**Causes:**
- Many concurrent sessions
- Large SQLite databases
- MCP server processes

**Fixes:**
- Close unused sessions
- Clean old session data from `~/.liteai/projects/`
- Limit concurrent MCP servers

## Telemetry diagnostics

Enable Perfetto tracing to identify bottlenecks:

```json
// settings.json
{
  "telemetry": {
    "perfetto": true
  }
}
```

Export OTLP traces for external analysis:

```json
// settings.json
{
  "telemetry": {
    "otel": {
      "traceExporter": "otlp",
      "protocol": "http/json",
      "endpoint": "http://localhost:4318"
    }
  }
}
```

Open the Perfetto trace file (at `~/.liteai/traces/`) in `chrome://tracing` or the Perfetto UI to visualize session bottlenecks.

## What's next?

- [**Debug configuration**](/build/debug-configuration) — Config resolution issues
- [**Architecture: Telemetry**](/architecture/telemetry) — Telemetry deep dive
