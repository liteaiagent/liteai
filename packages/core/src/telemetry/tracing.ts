import { context as otelContext, trace, type Span } from '@opentelemetry/api';
import { AsyncLocalStorage } from 'async_hooks';

import { 
  startInteractionPerfettoSpan, endInteractionPerfettoSpan,
  startLLMRequestPerfettoSpan, endLLMRequestPerfettoSpan,
  startToolPerfettoSpan, endToolPerfettoSpan
} from './perfetto';
import { isTelemetryEnabled } from './instrumentation';

export type { Span };

export interface LLMRequestNewContext {
  systemPrompt?: string;
  querySource?: string;
  tools?: string;
}

export interface LLMResponseMetadata {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  success?: boolean;
  statusCode?: number;
  error?: string;
  ttftMs?: number;
}

export interface HookResult {
  type: string;
  context?: any;
}

interface SpanContext {
  span: Span;
  startTime: number;
  attributes: Record<string, string | number | boolean>;
  ended?: boolean;
  perfettoSpanId?: string;
}

const interactionContext = new AsyncLocalStorage<SpanContext | undefined>();
const toolContext = new AsyncLocalStorage<SpanContext | undefined>();
const activeSpans = new Map<string, WeakRef<SpanContext>>();
const strongSpans = new Map<string, SpanContext>();

let interactionSequence = 0;
let _cleanupIntervalStarted = false;
const SPAN_TTL_MS = 30 * 60 * 1000; // 30 mins

function getSpanId(span: Span): string {
  return span.spanContext().spanId || '';
}

function getTracer() {
  return trace.getTracer('com.liteai.tracing', '1.0.0');
}

function ensureCleanupInterval(): void {
  if (_cleanupIntervalStarted) return;
  _cleanupIntervalStarted = true;
  const interval = setInterval(() => {
    const cutoff = Date.now() - SPAN_TTL_MS;
    for (const [spanId, weakRef] of activeSpans) {
      const ctx = weakRef.deref();
      if (ctx === undefined) {
        activeSpans.delete(spanId);
        strongSpans.delete(spanId);
      } else if (ctx.startTime < cutoff) {
        if (!ctx.ended) ctx.span.end();
        activeSpans.delete(spanId);
        strongSpans.delete(spanId);
      }
    }
  }, 60_000);
  if (typeof interval.unref === 'function') {
    interval.unref();
  }
}

function createSpanAttributes(
  spanType: string,
  customAttributes: Record<string, string | number | boolean> = {}
): Record<string, string | number | boolean> {
  return {
    'span.type': spanType,
    ...customAttributes,
  };
}

export function startInteractionSpan(userPrompt: string): Span {
  ensureCleanupInterval();

  const perfettoSpanId = startInteractionPerfettoSpan(userPrompt);

  if (!isTelemetryEnabled()) {
    const dummySpan = trace.getActiveSpan() || getTracer().startSpan('dummy');
    const spanId = getSpanId(dummySpan);
    const spanContextObj: SpanContext = {
      span: dummySpan,
      startTime: Date.now(),
      attributes: {},
      perfettoSpanId,
    };
    activeSpans.set(spanId, new WeakRef(spanContextObj));
    interactionContext.enterWith(spanContextObj);
    return dummySpan;
  }

  const tracer = getTracer();
  interactionSequence++;
  const attributes = createSpanAttributes('interaction', {
    user_prompt: userPrompt,
    user_prompt_length: userPrompt.length,
    'interaction.sequence': interactionSequence,
  });

  const span = tracer.startSpan('liteai.interaction', { attributes });
  const spanId = getSpanId(span);
  
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
    perfettoSpanId,
  };
  
  activeSpans.set(spanId, new WeakRef(spanContextObj));
  interactionContext.enterWith(spanContextObj);

  return span;
}

export function endInteractionSpan(): void {
  const spanContext = interactionContext.getStore();
  if (!spanContext || spanContext.ended) return;

  if (spanContext.perfettoSpanId) {
    endInteractionPerfettoSpan(spanContext.perfettoSpanId);
  }

  if (!isTelemetryEnabled()) {
    spanContext.ended = true;
    activeSpans.delete(getSpanId(spanContext.span));
    interactionContext.enterWith(undefined);
    return;
  }

  const duration = Date.now() - spanContext.startTime;
  spanContext.span.setAttributes({ 'interaction.duration_ms': duration });
  spanContext.span.end();
  spanContext.ended = true;
  
  activeSpans.delete(getSpanId(spanContext.span));
  interactionContext.enterWith(undefined);
}

export function startLLMRequestSpan(model: string, newContext?: LLMRequestNewContext): Span {
  const perfettoSpanId = startLLMRequestPerfettoSpan({
    model,
    querySource: newContext?.querySource,
  });

  if (!isTelemetryEnabled()) {
    const dummySpan = trace.getActiveSpan() || getTracer().startSpan('dummy');
    const spanId = getSpanId(dummySpan);
    const spanContextObj: SpanContext = {
      span: dummySpan,
      startTime: Date.now(),
      attributes: { model },
      perfettoSpanId,
    };
    activeSpans.set(spanId, new WeakRef(spanContextObj));
    strongSpans.set(spanId, spanContextObj);
    return dummySpan;
  }

  const tracer = getTracer();
  const parentSpanCtx = interactionContext.getStore();

  const attributes = createSpanAttributes('llm_request', {
    model: model,
    'llm_request.context': parentSpanCtx ? 'interaction' : 'standalone',
  });

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active();
    
  const span = tracer.startSpan('liteai.llm_request', { attributes }, ctx);

  if (newContext?.querySource) {
    span.setAttribute('query_source', newContext.querySource);
  }

  const spanId = getSpanId(span);
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
    perfettoSpanId,
  };
  
  activeSpans.set(spanId, new WeakRef(spanContextObj));
  strongSpans.set(spanId, spanContextObj);

  return span;
}

export function endLLMRequestSpan(span?: Span, metadata?: LLMResponseMetadata): void {
  let llmSpanContext: SpanContext | undefined;

  if (span) {
    const spanId = getSpanId(span);
    llmSpanContext = activeSpans.get(spanId)?.deref();
  } else {
    llmSpanContext = Array.from(activeSpans.values())
      .findLast(r => {
        const ctx = r.deref();
        return ctx?.attributes['span.type'] === 'llm_request' || ctx?.attributes['model'];
      })?.deref();
  }

  if (!llmSpanContext) return;

  const duration = Date.now() - llmSpanContext.startTime;

  if (llmSpanContext.perfettoSpanId) {
    endLLMRequestPerfettoSpan(llmSpanContext.perfettoSpanId, {
      ttftMs: metadata?.ttftMs,
      ttltMs: duration,
      promptTokens: metadata?.inputTokens,
      outputTokens: metadata?.outputTokens,
      cacheReadTokens: metadata?.cacheReadTokens,
      cacheCreationTokens: metadata?.cacheCreationTokens,
      success: metadata?.success,
      error: metadata?.error,
    });
  }

  if (!isTelemetryEnabled()) {
    const spanId = getSpanId(llmSpanContext.span);
    activeSpans.delete(spanId);
    strongSpans.delete(spanId);
    return;
  }

  const endAttributes: Record<string, string | number | boolean> = {
    duration_ms: duration,
  };

  if (metadata) {
    if (metadata.inputTokens !== undefined) endAttributes['input_tokens'] = metadata.inputTokens;
    if (metadata.outputTokens !== undefined) endAttributes['output_tokens'] = metadata.outputTokens;
    if (metadata.cacheReadTokens !== undefined) endAttributes['cache_read_tokens'] = metadata.cacheReadTokens;
    if (metadata.cacheCreationTokens !== undefined) endAttributes['cache_creation_tokens'] = metadata.cacheCreationTokens;
    if (metadata.success !== undefined) endAttributes['success'] = metadata.success;
    if (metadata.statusCode !== undefined) endAttributes['status_code'] = metadata.statusCode;
    if (metadata.error !== undefined) endAttributes['error'] = metadata.error;
    if (metadata.ttftMs !== undefined) endAttributes['ttft_ms'] = metadata.ttftMs;
  }

  llmSpanContext.span.setAttributes(endAttributes);
  llmSpanContext.span.end();

  const spanId = getSpanId(llmSpanContext.span);
  activeSpans.delete(spanId);
  strongSpans.delete(spanId);
}

export function startToolSpan(toolName: string, input?: string): Span {
  const perfettoSpanId = startToolPerfettoSpan(toolName);

  if (!isTelemetryEnabled()) {
    const dummySpan = trace.getActiveSpan() || getTracer().startSpan('dummy');
    const spanId = getSpanId(dummySpan);
    const spanContextObj: SpanContext = {
      span: dummySpan,
      startTime: Date.now(),
      attributes: { 'span.type': 'tool', tool_name: toolName },
      perfettoSpanId,
    };
    activeSpans.set(spanId, new WeakRef(spanContextObj));
    toolContext.enterWith(spanContextObj);
    return dummySpan;
  }

  const tracer = getTracer();
  const parentSpanCtx = interactionContext.getStore();

  const attributes = createSpanAttributes('tool', { tool_name: toolName });

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active();
    
  const span = tracer.startSpan('liteai.tool', { attributes }, ctx);

  if (input) {
    span.setAttribute('tool_input', input.substring(0, 5000));
  }

  const spanId = getSpanId(span);
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
    perfettoSpanId,
  };
  
  activeSpans.set(spanId, new WeakRef(spanContextObj));
  toolContext.enterWith(spanContextObj);

  return span;
}

export function endToolSpan(toolResult?: string, resultTokens?: number): void {
  const toolSpanContext = toolContext.getStore();
  if (!toolSpanContext) return;

  if (toolSpanContext.perfettoSpanId) {
    endToolPerfettoSpan(toolSpanContext.perfettoSpanId, {
      success: true,
      resultTokens,
    });
  }

  if (!isTelemetryEnabled()) {
    const spanId = getSpanId(toolSpanContext.span);
    activeSpans.delete(spanId);
    toolContext.enterWith(undefined);
    return;
  }

  const duration = Date.now() - toolSpanContext.startTime;
  const endAttributes: Record<string, string | number | boolean> = {
    duration_ms: duration,
  };

  if (resultTokens !== undefined) {
    endAttributes['result_tokens'] = resultTokens;
  }

  toolSpanContext.span.setAttributes(endAttributes);
  toolSpanContext.span.end();

  const spanId = getSpanId(toolSpanContext.span);
  activeSpans.delete(spanId);
  toolContext.enterWith(undefined);
}

export function startHookSpan(hookEvent: string): Span {
  if (!isTelemetryEnabled()) {
    const dummySpan = trace.getActiveSpan() || getTracer().startSpan('dummy');
    const spanId = getSpanId(dummySpan);
    const spanContextObj: SpanContext = {
      span: dummySpan,
      startTime: Date.now(),
      attributes: { 'span.type': 'hook', hook_event: hookEvent },
    };
    activeSpans.set(spanId, new WeakRef(spanContextObj));
    strongSpans.set(spanId, spanContextObj);
    return dummySpan;
  }

  const tracer = getTracer();
  const parentSpanCtx = toolContext.getStore() ?? interactionContext.getStore();

  const attributes = createSpanAttributes('hook', { hook_event: hookEvent });

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active();
    
  const span = tracer.startSpan('liteai.hook', { attributes }, ctx);

  const spanId = getSpanId(span);
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
  };
  
  activeSpans.set(spanId, new WeakRef(spanContextObj));
  strongSpans.set(spanId, spanContextObj);

  return span;
}

export function endHookSpan(span: Span, result?: HookResult): void {
  const spanId = getSpanId(span);
  const hookSpanContext = activeSpans.get(spanId)?.deref();

  if (!hookSpanContext) return;

  if (!isTelemetryEnabled()) {
    activeSpans.delete(spanId);
    strongSpans.delete(spanId);
    return;
  }

  const duration = Date.now() - hookSpanContext.startTime;
  const attributes: Record<string, string | number | boolean> = {
    duration_ms: duration,
  };

  if (result) {
    attributes['hook.type'] = result.type;
  }

  hookSpanContext.span.setAttributes(attributes);
  hookSpanContext.span.end();

  activeSpans.delete(spanId);
  strongSpans.delete(spanId);
}
