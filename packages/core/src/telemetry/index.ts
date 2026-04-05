/**
 * Telemetry public API.
 *
 * Re-exports the four sub-modules so consumers can import from
 * `@/telemetry` instead of reaching into individual files.
 */
export {
  isTelemetryEnabled,
  initializeTelemetry,
  shutdownTelemetry,
  flushTelemetry,
  registerTelemetryCleanup,
} from "./instrumentation"

export {
  startInteractionSpan,
  endInteractionSpan,
  startLLMRequestSpan,
  endLLMRequestSpan,
  startToolSpan,
  endToolSpan,
  startHookSpan,
  endHookSpan,
} from "./tracing"

export type { Span, LLMRequestNewContext, LLMResponseMetadata, HookResult } from "./tracing"

export {
  initializePerfettoTracing,
  isPerfettoTracingEnabled,
} from "./perfetto"

export {
  logOTelEvent,
  logSystemPromptIfNeeded,
  logToolSchemaIfNeeded,
  clearEventTrackingState,
} from "./events"
