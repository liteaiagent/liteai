# ─── LiteAI Telemetry → Remote Stack ──────────────────────────────────────────
# Stack: Tempo (traces) + Prometheus (metrics) + Loki (logs) + Grafana
# Only Tempo is exposed via Traefik at otel.smartnest.info
# Grafana UI: https://grafana.smartnest.info
# ──────────────────────────────────────────────────────────────────────────────

$LANGFUSE_SECRET_KEY="sk-lf-896ebbdb-d1b2-4741-87c7-cdfe1eb5e35d"
$LANGFUSE_PUBLIC_KEY="pk-lf-808022c3-a0f6-43ab-b403-3a016942fe69"
$LANGFUSE_BASE_URL="https://langfuse.smartnest.info"

# Build Basic Auth header for OpenTelemetry
$Bytes = [System.Text.Encoding]::UTF8.GetBytes("${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}")
$LangfuseAuth = [Convert]::ToBase64String($Bytes)

# Enable LiteAI telemetry subsystem
$env:LITEAI_ENABLE_TELEMETRY = "1"

# ─── Traces → Langfuse ───────────────────────────────────────────────────────
$env:OTEL_TRACES_EXPORTER = "otlp"
$env:OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf"
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "$LANGFUSE_BASE_URL/api/public/otel"
$env:OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Basic $LangfuseAuth"

# ─── Alternative: Traces → Tempo (via Traefik) ───────────────────────────────
# $env:OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel.smartnest.info"
# Remove or comment out OTEL_EXPORTER_OTLP_HEADERS when using Tempo

# ─── Metrics / Logs ──────────────────────────────────────────────────────────
# Prometheus and Loki are NOT exposed via Traefik currently.
# To enable, add Traefik labels in docker-compose.yml and uncomment:
# $env:OTEL_METRICS_EXPORTER = "otlp"
# $env:OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = "https://metrics.smartnest.info/api/v1/otlp/v1/metrics"
# $env:OTEL_METRIC_EXPORT_INTERVAL = "5000"
# $env:OTEL_LOGS_EXPORTER = "otlp"
# $env:OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = "https://logs.smartnest.info/otlp/v1/logs"

# ─── Perfetto (optional, independent local trace file) ───────────────────────
# Uncomment to also write a Chrome Trace Event file for Perfetto UI analysis:
# $env:LITEAI_PERFETTO_TRACE = "1"

# Quick check to remind you to edit the domain
if ($env:OTEL_EXPORTER_OTLP_ENDPOINT -match "YOURDOMAIN") {
    Write-Host "WARNING: Don't forget to open this script and replace YOURDOMAIN.com with your home server domain!" -ForegroundColor Yellow
}

Write-Host "Starting @liteai/core with Telemetry pointing to $($env:OTEL_EXPORTER_OTLP_ENDPOINT)..." -ForegroundColor Cyan
Write-Host "  Traces  : otlp ($($env:OTEL_EXPORTER_OTLP_PROTOCOL))" -ForegroundColor DarkCyan
Write-Host "  Metrics : $(if ($env:OTEL_METRICS_EXPORTER) { $env:OTEL_METRICS_EXPORTER } else { 'disabled' })" -ForegroundColor DarkCyan
Write-Host "  Logs    : $(if ($env:OTEL_LOGS_EXPORTER) { $env:OTEL_LOGS_EXPORTER } else { 'disabled' })" -ForegroundColor DarkCyan
Write-Host "  Perfetto: $(if ($env:LITEAI_PERFETTO_TRACE) { 'enabled' } else { 'disabled' })" -ForegroundColor DarkCyan
Write-Host ""

# Run the dev script from package.json
bun run dev
