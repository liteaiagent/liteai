# Telemetry Phase 2: OTel Metrics & Logs Integration

## Status: ✅ Data Pipelines Complete (Pending 2e: Dashboards)
## Priority: High
## Depends On: Telemetry refactoring (✅ complete), Agentic loop rewrite (✅ complete)

---

## Context

The telemetry subsystem currently has full **trace** instrumentation (interaction → llm_request → tool span hierarchy) and a working remote stack (Tempo + Grafana). However, the **metrics** and **logs** pipelines are scaffolding-only:

- `MeterProvider` is created but zero counters/histograms/gauges exist.
- `LoggerProvider` is created but `logOTelEvent()`, `logSystemPromptIfNeeded()`, and `logToolSchemaIfNeeded()` have **zero call sites** in the agentic loop.
- Prometheus and Loki are deployed but receive no data.
- Massive LLM conversational payloads are currently 10k-character truncated in Tempo due to span attribute limits. Full, untruncated payloads must be routed to Loki.

This roadmap item covers wiring these pipelines into production code, specifically referencing the mature Node.js implementation from the `liteai2` workspace.

---

## Reference Implementation: `liteai2`

We will strictly follow the `liteai2` production NodeSDK telemetry configuration as the blueprint for Phase 2. The `liteai2` workspace demonstrates proper Three-Pillar observability with dynamic exporter bridging.

**Key Reference Files:**
- **Exporter Setup:** `C:\Users\aghassan\Documents\workspace\liteai2\src\utils\telemetry\instrumentation.ts`
  *Provides the exact logic for dynamically invoking `@opentelemetry/exporter-logs-otlp-http` and `@opentelemetry/exporter-metrics-otlp-http`, and applying them to `LoggerProvider` and `MeterProvider` with proper compression schemas.*
- **Provider Initialization:** `C:\Users\aghassan\Documents\workspace\liteai2\src\bootstrap\state.ts`
  *Demonstrates how to correctly initialize the core OTel SDK `api-logs` and `sdk-metrics` providers at application boot time.*

---

## 1. OTel Metrics

### What They Provide (vs Traces)
Traces give you **per-request detail** (waterfall timelines). Metrics give you **aggregate trends over time** — dashboards, alerts, SLOs.

### Proposed Metrics

| Metric | Type | Where | What It Measures |
|---|---|---|---|
| `liteai.interactions.total` | Counter | `loop.ts` (startInteractionSpan) | Total user prompts processed |
| `liteai.llm_requests.total` | Counter | `query.ts` (startLLMRequestSpan) | Total LLM API calls (multi-turn = multiple per interaction) |
| `liteai.llm_request.duration_ms` | Histogram | `query.ts` (endLLMRequestSpan) | LLM response latency distribution |
| `liteai.llm_request.ttft_ms` | Histogram | `query.ts` | Time-to-first-token distribution |
| `liteai.tokens.input` | Counter | `persister.ts` (step-finish) | Cumulative input tokens consumed |
| `liteai.tokens.output` | Counter | `persister.ts` (step-finish) | Cumulative output tokens generated |
| `liteai.tokens.cache_read` | Counter | `persister.ts` (step-finish) | Cumulative cache read tokens |
| `liteai.tokens.cache_write` | Counter | `persister.ts` (step-finish) | Cumulative cache creation tokens |
| `liteai.cost.total` | Counter | `persister.ts` (step-finish) | Cumulative dollar cost |
| `liteai.tools.total` | Counter | `persister.ts` (tool call) | Total tool invocations |
| `liteai.tools.duration_ms` | Histogram | `persister.ts` (tool result) | Tool execution latency distribution |
| `liteai.tools.errors` | Counter | `persister.ts` (tool error) | Tool failure count |
| `liteai.compactions.total` | Counter | `loop.ts` (compaction-task) | Number of auto-compactions triggered |
| `liteai.retries.total` | Counter | `persister.ts` (retry path) | Number of retryable errors encountered |
| `liteai.sessions.active` | UpDownCounter | `loop.ts` (start/cleanup) | Currently active sessions |

### Labels (Dimensions)
All metrics should carry these attributes for slicing:
- `model` (e.g., `anthropic/claude-sonnet-4-20250514`)
- `agent` (e.g., `build`, `plan`, `explore`)
- `tool_name` (for tool-specific metrics)

### Implementation Approach
Create a `src/telemetry/metrics.ts` module, modeled entirely after `liteai2/src/utils/telemetry/instrumentation.ts`:
```typescript
import { metrics } from "@opentelemetry/api"

const meter = metrics.getMeter("com.liteai.metrics", "1.0.0")

export const Metrics = {
  interactions: meter.createCounter("liteai.interactions.total"),
  llmRequests: meter.createCounter("liteai.llm_requests.total"),
  llmDuration: meter.createHistogram("liteai.llm_request.duration_ms"),
  // ...
}
```

---

## 2. OTel Logs (Structured Events)

### What They Provide (vs `log.info`)
Standard `log.info` sends local stdout output for debugging. By connecting to Loki via `@opentelemetry/sdk-logs`, any large, unstructured block of text (like a massive 150k token LLM context window) is routed explicitly to a high-capacity time-series database. Because it is routed with an active `traceId`, Grafana perfectly pairs the massive Log payload with your Tracing Graph timelines automatically.

### What's Already Built (Just Needs Call Sites)

| Function | What It Sends | Where to Call |
|---|---|---|
| `logSystemPromptIfNeeded(prompt)` | Full system prompt (deduplicated by hash) | `query.ts` after building system prompt |
| `logToolSchemaIfNeeded(name, schema)` | Tool JSON schema (deduplicated) | `query.ts` after resolving tools |
| `logOTelEvent(name, metadata)` | Generic structured event | Various (see below) |

### LLM Payload Persistence
Instead of cramming stringified prompts into span attributes (which violates OTel strict length limits leading exactly to 10k character truncation), we will use OTel Appender Logs inside `query.ts`:
```typescript
logger.emit({
  body: JSON.stringify(payload.messages),
  attributes: { 
    "log.type": "llm.messages", 
    model: payload.model 
  }
})
```

### Loki Stack Requirement
Loki needs OTLP ingestion enabled. In `loki-config.yaml`:
```yaml
limits_config:
  otlp_config:
    resource_attributes:
      attributes_config:
        - action: index_label
          attributes:
            - service.name
            - service.version
```

---

## 3. Grafana Dashboards

Once metrics and logs are flowing, create pre-built dashboards using Prometheus and Loki as datasources:

### Operational Dashboard
- Interactions/min, LLM requests/min, active sessions
- Token consumption rate (input vs output vs cache)
- Cost per hour/day
- Error rate, retry rate

### Context & Prompts View
- A dedicated TraceQL/PromQL linked dashboard that automatically presents untruncated system prompts and multi-turn message arrays directly from Loki via Trace ID correlations.

---

## Implementation Order

1. **~~Phase 2a: Metrics SDK Bridge~~** ✅ Complete — Ported `MeterProvider` configuration to `liteai`.
2. **~~Phase 2b: Metrics Definitions~~** ✅ Complete — Created `metrics.ts` (using lazy getters) and wired into persister/loop/query.
3. **~~Phase 2c: Loki Log Bridges~~** ✅ Complete — Adapted `LoggerProvider` using `@opentelemetry/exporter-logs-otlp-http` and routed raw unwrapped LLM arrays straight to Loki.
4. **~~Phase 2d: Infrastructure Readiness~~** ✅ Complete — Traefik routing mapped internally, Prometheus 3.x modernized, and OpenTelemetry drops resolved.
5. **Phase 2e: Dashboards** 🚧 Pending — Export Grafana dashboard JSON for provisioning.
