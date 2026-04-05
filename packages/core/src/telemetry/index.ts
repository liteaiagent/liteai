/**
 * Telemetry public API.
 *
 * Re-exports the four sub-modules so consumers can import from
 * `@/telemetry` instead of reaching into individual files.
 */

export {
  clearEventTrackingState,
  logOTelEvent,
  logSystemPromptIfNeeded,
  logToolSchemaIfNeeded,
} from "./events"
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
export type { HookResult, LLMRequestNewContext, LLMResponseMetadata, Span } from "./tracing"
export {
  endHookSpan,
  endInteractionSpan,
  endLLMRequestSpan,
  endToolSpan,
  startHookSpan,
  startInteractionSpan,
  startLLMRequestSpan,
  startToolSpan,
} from "./tracing"
