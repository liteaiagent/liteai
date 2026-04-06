/**
 * Telemetry public API.
 *
 * Re-exports the four sub-modules so consumers can import from
 * `@/telemetry` instead of reaching into individual files.
 */

export {
  flushTelemetry,
  initializeTelemetry,
  isTelemetryEnabled,
  registerTelemetryCleanup,
  shutdownTelemetry,
} from "./instrumentation"
export {
  initializePerfettoTracing,
  isPerfettoTracingEnabled,
} from "./perfetto"
