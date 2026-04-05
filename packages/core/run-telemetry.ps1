$env:LITEAI_ENABLE_TELEMETRY = "1"
$env:OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf"
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel.smartnest.info"

# Quick check to remind you to edit the domain
if ($env:OTEL_EXPORTER_OTLP_ENDPOINT -match "YOURDOMAIN") {
    Write-Host "WARNING: Don't forget to open this script and replace YOURDOMAIN.com with your home server domain!" -ForegroundColor Yellow
}

Write-Host "Starting @liteai/core with Telemetry pointing to $($env:OTEL_EXPORTER_OTLP_ENDPOINT)..." -ForegroundColor Cyan

# Run the dev script from package.json
bun run dev
