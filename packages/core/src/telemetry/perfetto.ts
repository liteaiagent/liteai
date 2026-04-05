import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';

export type TraceEventPhase = 'B' | 'E' | 'X' | 'i' | 'C' | 'b' | 'n' | 'e' | 'M';

export type TraceEvent = {
  name: string;
  cat: string;
  ph: TraceEventPhase;
  ts: number;
  pid: number;
  tid: number;
  dur?: number;
  args?: Record<string, unknown>;
};

type PendingSpan = {
  name: string;
  category: string;
  startTime: number;
  args: Record<string, unknown>;
};

let isEnabled = false;
let tracePath: string | null = null;
const events: TraceEvent[] = [];
const metadataEvents: TraceEvent[] = [];
const pendingSpans = new Map<string, PendingSpan>();

let startTimeMs = 0;
let spanIdCounter = 0;

function getTimestamp(): number {
  return (Date.now() - startTimeMs) * 1000;
}

function generateSpanId(): string {
  return `span_${++spanIdCounter}`;
}

export function initializePerfettoTracing(): void {
  const envValue = process.env.LITEAI_PERFETTO_TRACE;
  
  if (envValue && envValue !== '0' && envValue !== 'false') {
    isEnabled = true;
    startTimeMs = Date.now();
    
    // In liteai, we output to ~/.liteai/traces
    // Random ID for now to mock session id, in a real env we import sessionId
    const sessionId = process.env.LITEAI_SESSION_ID || `session-${Date.now()}`;
    const tracesDir = join(homedir(), '.liteai', 'traces');
    
    if (envValue === '1' || envValue.toLowerCase() === 'true') {
      tracePath = join(tracesDir, `trace-${sessionId}.json`);
    } else {
      tracePath = envValue;
    }

    process.on('beforeExit', () => {
      void writePerfettoTrace();
    });
  }
}

async function writePerfettoTrace(): Promise<void> {
  if (!isEnabled || !tracePath) return;

  try {
    await mkdir(dirname(tracePath), { recursive: true });
    
    const content = JSON.stringify({
      traceEvents: [...metadataEvents, ...events],
      metadata: {
        trace_start_time: new Date(startTimeMs).toISOString(),
        total_event_count: metadataEvents.length + events.length,
      },
    }, null, 2);

    await writeFile(tracePath, content, 'utf8');
  } catch (error) {
    console.error(`Failed to write Perfetto trace to ${tracePath}:`, error);
  }
}

export function isPerfettoTracingEnabled(): boolean {
  return isEnabled;
}

export function startInteractionPerfettoSpan(userPrompt: string): string {
  if (!isEnabled) return '';

  const spanId = generateSpanId();
  pendingSpans.set(spanId, {
    name: 'Interaction',
    category: 'interaction',
    startTime: getTimestamp(),
    args: { prompt_length: userPrompt.length }
  });

  events.push({
    name: 'Interaction',
    cat: 'interaction',
    ph: 'B',
    ts: pendingSpans.get(spanId)!.startTime,
    pid: 1,
    tid: 1,
    args: pendingSpans.get(spanId)!.args,
  });

  return spanId;
}

export function endInteractionPerfettoSpan(spanId: string): void {
  if (!isEnabled || !spanId) return;

  const pending = pendingSpans.get(spanId);
  if (!pending) return;

  const endTime = getTimestamp();

  events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: 1,
    tid: 1,
    args: {
      ...pending.args,
      duration_ms: (endTime - pending.startTime) / 1000
    },
  });

  pendingSpans.delete(spanId);
}

export function startLLMRequestPerfettoSpan(args: { model: string; querySource?: string }): string {
  if (!isEnabled) return '';

  const spanId = generateSpanId();
  pendingSpans.set(spanId, {
    name: 'API Call',
    category: 'api',
    startTime: getTimestamp(),
    args: { model: args.model, query_source: args.querySource }
  });

  events.push({
    name: 'API Call',
    cat: 'api',
    ph: 'B',
    ts: pendingSpans.get(spanId)!.startTime,
    pid: 1,
    tid: 1,
    args: pendingSpans.get(spanId)!.args,
  });

  return spanId;
}

export function endLLMRequestPerfettoSpan(spanId: string, metadata: {
  ttftMs?: number;
  ttltMs?: number;
  promptTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  success?: boolean;
  error?: string;
}): void {
  if (!isEnabled || !spanId) return;

  const pending = pendingSpans.get(spanId);
  if (!pending) return;

  const endTime = getTimestamp();

  events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: 1,
    tid: 1,
    args: {
      ...pending.args,
      ...metadata,
      duration_ms: (endTime - pending.startTime) / 1000
    },
  });

  pendingSpans.delete(spanId);
}

export function startToolPerfettoSpan(toolName: string): string {
  if (!isEnabled) return '';

  const spanId = generateSpanId();
  pendingSpans.set(spanId, {
    name: `Tool: ${toolName}`,
    category: 'tool',
    startTime: getTimestamp(),
    args: { tool_name: toolName }
  });

  events.push({
    name: `Tool: ${toolName}`,
    cat: 'tool',
    ph: 'B',
    ts: pendingSpans.get(spanId)!.startTime,
    pid: 1,
    tid: 1,
    args: pendingSpans.get(spanId)!.args,
  });

  return spanId;
}

export function endToolPerfettoSpan(spanId: string, metadata?: { success?: boolean; resultTokens?: number }): void {
  if (!isEnabled || !spanId) return;

  const pending = pendingSpans.get(spanId);
  if (!pending) return;

  const endTime = getTimestamp();

  events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: 1,
    tid: 1,
    args: {
      ...pending.args,
      ...metadata,
      duration_ms: (endTime - pending.startTime) / 1000
    },
  });

  pendingSpans.delete(spanId);
}
