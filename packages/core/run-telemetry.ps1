# ─── LiteAI Telemetry → Langfuse ──────────────────────────────────────────────
# Traces  : LangfuseSpanProcessor (direct SDK, no OTLP needed)
# Metrics : (disabled — uncomment section below to enable via OTLP)
# Logs    : (disabled — uncomment section below to enable via OTLP)
# Langfuse UI: https://langfuse.smartnest.info
# ──────────────────────────────────────────────────────────────────────────────

# ─── Langfuse credentials ─────────────────────────────────────────────────────
# These are read directly by LangfuseSpanProcessor in instrumentation.ts
$env:LANGFUSE_SECRET_KEY = "sk-lf-b97c9296-e049-487d-a360-f5e83ca21afc"
$env:LANGFUSE_PUBLIC_KEY  = "pk-lf-70be6b53-e130-4b5a-bafe-b4d4cf232215"
$env:LANGFUSE_BASEURL     = "https://langfuse.smartnest.info"

# ─── Enable LiteAI telemetry subsystem ────────────────────────────────────────
$env:LITEAI_ENABLE_TELEMETRY = "1"

# ─── Metrics → (disabled) ─────────────────────────────────────────────────────
# Prometheus / Loki are not exposed via Traefik currently.
# Uncomment to route metrics to an OTLP-compatible endpoint:
# $env:OTEL_METRICS_EXPORTER = "otlp"
# $env:OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf"
# $env:OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = "https://metrics.smartnest.info/api/v1/otlp/v1/metrics"
# $env:OTEL_METRIC_EXPORT_INTERVAL = "5000"

# ─── Logs → (disabled) ────────────────────────────────────────────────────────
# $env:OTEL_LOGS_EXPORTER = "otlp"
# $env:OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = "https://logs.smartnest.info/otlp/v1/logs"

# ─── Perfetto (optional, independent local trace file) ───────────────────────
# Uncomment to also write a Chrome Trace Event file for Perfetto UI analysis:
# $env:LITEAI_PERFETTO_TRACE = "1"

Write-Host "Starting @liteai/core with Telemetry..." -ForegroundColor Cyan
Write-Host "  Traces  : LangfuseSpanProcessor → $($env:LANGFUSE_BASEURL)" -ForegroundColor DarkCyan
Write-Host "  Metrics : $(if ($env:OTEL_METRICS_EXPORTER) { $env:OTEL_METRICS_EXPORTER } else { 'disabled' })" -ForegroundColor DarkCyan
Write-Host "  Logs    : $(if ($env:OTEL_LOGS_EXPORTER) { $env:OTEL_LOGS_EXPORTER } else { 'disabled' })" -ForegroundColor DarkCyan
Write-Host "  Perfetto: $(if ($env:LITEAI_PERFETTO_TRACE) { 'enabled' } else { 'disabled' })" -ForegroundColor DarkCyan
Write-Host ""

# Run the dev script from package.json
bun --inspect-wait run dev
