---
title: "Architecture: Telemetry & observability"
description: "OpenTelemetry instrumentation, Perfetto trace export, and diagnostic services."
---

# Telemetry & observability

> **Source:** `src/telemetry/`

LiteAI uses OpenTelemetry for distributed tracing and Perfetto for visual trace analysis.

## Instrumentation

**Source:** `src/telemetry/instrumentation.ts`

Key spans tracked:

| Span | What it measures |
|---|---|
| `session.turn` | Full turn lifecycle (prompt → response) |
| `provider.query` | LLM API call duration and tokens |
| `tool.execute` | Individual tool execution |
| `compaction` | Auto-compaction timing |
| `permission.check` | Permission service latency |
| `agent.spawn` | Subagent/teammate creation |

## Exporter factories

**Source:** `src/telemetry/factories.ts`

LiteAI supports multiple trace exporters:
- **Console** — Development debugging
- **OTLP** — Send to any OpenTelemetry collector (Jaeger, Zipkin, etc.)
- **Perfetto** — Chrome-compatible trace files

## Perfetto trace export

**Source:** `src/telemetry/perfetto.ts`

Export traces as Perfetto-compatible files for visual analysis in `chrome://tracing` or the Perfetto UI. Useful for profiling token usage, tool execution latency, and session bottlenecks.

## Diagnostic service

**Source:** `src/telemetry/diagnostic.ts`

Collects system health metrics exposed via the `/diagnostics` API route:
- Memory usage
- Active session count
- Provider connection status
- Tool execution statistics

## Request tracing

Every HTTP request gets an OpenTelemetry span via the `requestTracer()` middleware, enabling end-to-end tracing from client request through LLM query to response delivery.
