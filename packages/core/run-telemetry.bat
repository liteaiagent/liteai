@echo off
set LITEAI_ENABLE_TELEMETRY=1
set OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
set OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.YOURDOMAIN.com

echo WARNING: Don't forget to open this script and replace YOURDOMAIN.com with your home server domain!
echo Starting @liteai/core with Telemetry pointing to %OTEL_EXPORTER_OTLP_ENDPOINT%...

bun run dev
