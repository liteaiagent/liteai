# Telemetry Phase 2: OTel Metrics & Logs Integration

## Status: Planned
## Priority: Low
## Depends On: Telemetry refactoring (✅ complete), Agentic loop rewrite (✅ complete)

---

## Context

The telemetry subsystem currently has full **trace** instrumentation (interaction → llm_request → tool span hierarchy) and a working remote stack (Tempo + Grafana). However, the **metrics** and **logs** pipelines are scaffolding-only:

- `MeterProvider` is created but zero counters/histograms/gauges exist
- `LoggerProvider` is created but `logOTelEvent()`, `logSystemPromptIfNeeded()`, and `logToolSchemaIfNeeded()` have **zero call sites** in the agentic loop
- Prometheus and Loki are deployed but receive no data

This roadmap item covers wiring these pipelines into production code.

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
Create a `src/telemetry/metrics.ts` module:
```typescript
import { metrics } from "@opentelemetry/api"

const meter = metrics.getMeter("com.liteai.metrics", "1.0.0")

export const Metrics = {
  interactions: meter.createCounter("liteai.interactions.total"),
  llmRequests: meter.createCounter("liteai.llm_requests.total"),
  llmDuration: meter.createHistogram("liteai.llm_request.duration_ms"),
  ttft: meter.createHistogram("liteai.llm_request.ttft_ms"),
  inputTokens: meter.createCounter("liteai.tokens.input"),
  outputTokens: meter.createCounter("liteai.tokens.output"),
  // ...
}
```

Then call `Metrics.interactions.add(1, { model, agent })` at the appropriate call sites.

---

## 2. OTel Logs (Structured Events)

### What They Provide (vs `log.info`)
`log.info` is app-level debug output → stdout/file. OTel Logs are **structured telemetry events** → Loki/Datadog/etc, with correlation to traces via `trace_id`.

### What's Already Built (Just Needs Call Sites)

| Function | What It Sends | Where to Call |
|---|---|---|
| `logSystemPromptIfNeeded(prompt)` | Full system prompt (deduplicated by hash) | `query.ts` after building system prompt |
| `logToolSchemaIfNeeded(name, schema)` | Tool JSON schema (deduplicated) | `query.ts` after resolving tools |
| `logOTelEvent(name, metadata)` | Generic structured event | Various (see below) |

### Additional Events to Add

| Event | Metadata | Where |
|---|---|---|
| `liteai.interaction_start` | `session_id`, `agent`, `model`, `prompt_length` | `loop.ts` prompt() |
| `liteai.interaction_end` | `session_id`, `steps`, `total_tokens`, `total_cost`, `duration_ms` | `loop.ts` after runSession |
| `liteai.compaction` | `session_id`, `type` (auto/overflow), `before_tokens`, `after_tokens` | `loop.ts` compaction-task handler |
| `liteai.error` | `session_id`, `error_type`, `error_message`, `model` | `persister.ts` error paths |
| `liteai.retry` | `session_id`, `attempt`, `delay_ms`, `error_type` | `persister.ts` retry path |

### Loki Stack Requirement
Loki needs OTLP ingestion enabled — add to `loki-config.yaml`:
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

Once metrics and logs are flowing, create pre-built dashboards:

### Operational Dashboard
- Interactions/min, LLM requests/min, active sessions
- Token consumption rate (input vs output vs cache)
- Cost per hour/day
- Error rate, retry rate

### Performance Dashboard
- LLM latency percentiles (p50, p95, p99)
- TTFT distribution
- Tool execution latency by tool name
- Compaction frequency

### Cost Dashboard
- Cost by model
- Cost by agent
- Token efficiency (cache hit ratio)
- Cost per interaction

---

## Implementation Order

1. **Phase 2a: Metrics** — Create `metrics.ts`, wire into persister/loop/query (~2h)
2. **Phase 2b: Log Call Sites** — Wire existing `logSystemPromptIfNeeded`/`logToolSchemaIfNeeded` into query.ts, add interaction events (~1h)
3. **Phase 2c: Loki Config** — Enable OTLP in Loki, expose via Traefik (~30min)
4. **Phase 2d: Dashboards** — Export Grafana dashboard JSON for provisioning (~2h)
