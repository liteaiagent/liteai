# ─── LiteAI Telemetry → Remote Stack ──────────────────────────────────────────
# Stack: Tempo (traces) + Prometheus (metrics) + Loki (logs) + Grafana
# Only Tempo is exposed via Traefik at otel.smartnest.info
# Grafana UI: https://grafana.smartnest.info
# ──────────────────────────────────────────────────────────────────────────────

# Enable LiteAI telemetry subsystem
$env:LITEAI_ENABLE_TELEMETRY = "1"

# ─── Traces → Tempo (via Traefik) ────────────────────────────────────────────
$env:OTEL_TRACES_EXPORTER = "otlp"
$env:OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf"
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel.smartnest.info"

# ─── Metrics / Logs ──────────────────────────────────────────────────────────
# Prometheus and Loki are NOT exposed via Traefik currently.
# To enable, add Traefik labels in docker-compose.yml and uncomment:
# $env:OTEL_METRICS_EXPORTER = "otlp"
# $env:OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = "https://metrics.smartnest.info"
# $env:OTEL_LOGS_EXPORTER = "otlp"
# $env:OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = "https://logs.smartnest.info"

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
