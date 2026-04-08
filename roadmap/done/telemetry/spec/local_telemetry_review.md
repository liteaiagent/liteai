# Local Telemetry Stack — Review (Remote Deployment)

## Setup

```
┌──────────────────────────────────────────────────────────┐
│  Remote Server (Docker + Traefik)                        │
│                                                          │
│  Traefik ─── otel.smartnest.info ──→ Tempo:4318 (OTLP)  │
│         └── grafana.smartnest.info ─→ Grafana:3000       │
│                                                          │
│  Internal only:                                          │
│    Prometheus:9090 (metrics)                             │
│    Loki:3100 (logs)                                      │
└──────────────────────────────────────────────────────────┘
                        ▲
                        │ HTTPS (http/protobuf)
                        │
┌──────────────────────────────────────────────────────────┐
│  Windows Dev Machine (LiteAI)                            │
│  run-telemetry.ps1 → bun run dev                         │
└──────────────────────────────────────────────────────────┘
```

---

## 🔴 Critical: Script Was Missing `OTEL_TRACES_EXPORTER` (Fixed)

The script set the global endpoint and protocol, but never told the SDK to create any exporters:

```diff
  $env:LITEAI_ENABLE_TELEMETRY = "1"
+ $env:OTEL_TRACES_EXPORTER = "otlp"          # ← THIS WAS MISSING
  $env:OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf"
  $env:OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel.smartnest.info"
```

Without `OTEL_TRACES_EXPORTER=otlp`, `parseExporterTypes()` returns `[]` → zero exporters created → **no telemetry data would have been sent**.

---

## Docker Compose Assessment (Remote Context)

| Component | Status | Notes |
|---|---|---|
| **Tempo** (traces) | ✅ Correct | OTLP HTTP/gRPC receivers, exposed via Traefik at `otel.smartnest.info:4318` |
| **Grafana** (UI) | ✅ Correct | Exposed via Traefik at `grafana.smartnest.info`, auto-provisioned datasources |
| **Prometheus** (metrics) | ⚠️ Internal only | No Traefik labels — can't receive metrics from external LiteAI. Fine for UAT (traces-only) |
| **Loki** (logs) | ⚠️ Internal only + missing OTLP config | No Traefik labels + no `otlp_config` in loki-config.yaml. Fine for UAT (traces-only) |
| **Traefik network** | ✅ Correct | External `traefik-net` with static IPs — standard for Traefik deployments |
| **Port mappings** | ✅ N/A | Not needed — Traefik handles routing on the remote server |

> [!TIP]
> For a traces-only UAT, the current docker-compose is perfectly fine. Prometheus and Loki are placeholders for future metrics/logs expansion.

---

## What Works Now

After the script fix:

1. **Traces → Tempo** ✅ via `otel.smartnest.info` over HTTPS with `http/protobuf` protocol
2. **Grafana** ✅ accessible at `grafana.smartnest.info` with Tempo datasource pre-configured
3. **Span hierarchy** ✅ `liteai.interaction` → `liteai.llm_request` → `liteai.tool` (from loop.ts/query.ts/persister.ts)

## What's Disabled (By Design)

- Metrics export (Prometheus not exposed externally)
- Log export (Loki not exposed externally + needs OTLP config)
- Perfetto local traces (opt-in via `LITEAI_PERFETTO_TRACE=1`)

---

## UAT Smoke Test

1. ☐ Start remote stack: `docker compose up -d`
2. ☐ Verify Grafana at `https://grafana.smartnest.info`
3. ☐ Run `.\run-telemetry.ps1` — verify output shows "Traces: otlp (http/protobuf)"
4. ☐ Send a prompt in LiteAI
5. ☐ Open Grafana → Explore → Tempo → Search
6. ☐ Find `liteai.interaction` span
7. ☐ Expand span tree: verify `liteai.llm_request` and `liteai.tool` children
8. ☐ Check span attributes: `model`, `user_prompt`, `input_tokens`, `output_tokens`, `duration_ms`
