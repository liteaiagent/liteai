import { type Counter, type Histogram, metrics, type UpDownCounter } from "@opentelemetry/api"

/**
 * Lazy-initialized metrics object.
 * We must NOT create OpenTelemetry instruments immediately on import,
 * because if `initializeTelemetry()` hasn't been called yet, OTel returns
 * a silent NO-OP proxy that will intentionally drop all metrics!
 */

const state = {
  interactions: undefined as Counter | undefined,
  llmRequests: undefined as Counter | undefined,
  llmDuration: undefined as Histogram | undefined,
  llmTtft: undefined as Histogram | undefined,
  tokensInput: undefined as Counter | undefined,
  tokensOutput: undefined as Counter | undefined,
  tokensCacheRead: undefined as Counter | undefined,
  tokensCacheWrite: undefined as Counter | undefined,
  costTotal: undefined as Counter | undefined,
  toolsTotal: undefined as Counter | undefined,
  toolsDuration: undefined as Histogram | undefined,
  toolsErrors: undefined as Counter | undefined,
  compactionsTotal: undefined as Counter | undefined,
  retriesTotal: undefined as Counter | undefined,
  sessionsActive: undefined as UpDownCounter | undefined,
}

function getMeter() {
  return metrics.getMeter("com.liteai.metrics", "1.0.0")
}

export const Metrics = {
  get interactions() {
    return (state.interactions ??= getMeter().createCounter("liteai.interactions.total", {
      description: "Total user prompts processed",
    }))
  },
  get llmRequests() {
    return (state.llmRequests ??= getMeter().createCounter("liteai.llm_requests.total", {
      description: "Total LLM API calls (multi-turn = multiple per interaction)",
    }))
  },
  get llmDuration() {
    return (state.llmDuration ??= getMeter().createHistogram("liteai.llm_request.duration_ms", {
      description: "LLM response latency distribution",
      unit: "ms",
    }))
  },
  get llmTtft() {
    return (state.llmTtft ??= getMeter().createHistogram("liteai.llm_request.ttft_ms", {
      description: "Time-to-first-token distribution",
      unit: "ms",
    }))
  },
  get tokensInput() {
    return (state.tokensInput ??= getMeter().createCounter("liteai.tokens.input", {
      description: "Cumulative input tokens consumed",
    }))
  },
  get tokensOutput() {
    return (state.tokensOutput ??= getMeter().createCounter("liteai.tokens.output", {
      description: "Cumulative output tokens generated",
    }))
  },
  get tokensCacheRead() {
    return (state.tokensCacheRead ??= getMeter().createCounter("liteai.tokens.cache_read", {
      description: "Cumulative cache read tokens",
    }))
  },
  get tokensCacheWrite() {
    return (state.tokensCacheWrite ??= getMeter().createCounter("liteai.tokens.cache_write", {
      description: "Cumulative cache creation tokens",
    }))
  },
  get costTotal() {
    return (state.costTotal ??= getMeter().createCounter("liteai.cost.total", {
      description: "Cumulative dollar cost",
    }))
  },
  get toolsTotal() {
    return (state.toolsTotal ??= getMeter().createCounter("liteai.tools.total", {
      description: "Total tool invocations",
    }))
  },
  get toolsDuration() {
    return (state.toolsDuration ??= getMeter().createHistogram("liteai.tools.duration_ms", {
      description: "Tool execution latency distribution",
      unit: "ms",
    }))
  },
  get toolsErrors() {
    return (state.toolsErrors ??= getMeter().createCounter("liteai.tools.errors", {
      description: "Tool failure count",
    }))
  },
  get compactionsTotal() {
    return (state.compactionsTotal ??= getMeter().createCounter("liteai.compactions.total", {
      description: "Number of auto-compactions triggered",
    }))
  },
  get retriesTotal() {
    return (state.retriesTotal ??= getMeter().createCounter("liteai.retries.total", {
      description: "Number of retryable errors encountered",
    }))
  },
  get sessionsActive() {
    return (state.sessionsActive ??= getMeter().createUpDownCounter("liteai.sessions.active", {
      description: "Currently active sessions",
    }))
  },
}
