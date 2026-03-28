import type { AssistantMessage, Message, Part, UserMessage } from "@liteai/sdk/client"
import { Icon } from "@liteai/ui/icon"
import { IconButton } from "@liteai/ui/icon-button"
import { ResizeHandle } from "@liteai/ui/resize-handle"
import { findLast } from "@liteai/util/array"
import { createMediaQuery } from "@solid-primitives/media"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  estimateSessionContextBreakdown,
  type SessionContextBreakdownKey,
} from "@/components/session/session-context-breakdown"
import { createSessionContextFormatter } from "@/components/session/session-context-format"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import type { Sizing } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import "./trace-panel.css"

import { CompareView } from "./trace-compare"
import { TraceDetailView } from "./trace-detail"
import { fmt, SPAN_COLORS, spanType } from "./trace-helpers"
import type { TraceDetail, TraceInfo } from "./trace-types"

const BREAKDOWN_COLOR: Record<SessionContextBreakdownKey, string> = {
  system: "var(--syntax-info)",
  user: "var(--syntax-success)",
  assistant: "var(--syntax-property)",
  thinking: "var(--syntax-constant)",
  tool: "var(--syntax-warning)",
  defs: "var(--syntax-primitive)",
  other: "var(--syntax-comment)",
}

const BREAKDOWN_LABEL: Record<SessionContextBreakdownKey, string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
  thinking: "Thinking",
  tool: "Tools",
  defs: "Tool Defs",
  other: "Other",
}

export function TracePanel(props: { size: Sizing }) {
  const sdk = useSDK()
  const layout = useLayout()
  const language = useLanguage()
  const sync = useSync()
  const { params, view } = useSessionLayout()
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const [overview, setOverview] = createSignal(true)

  const opened = createMemo(() => isDesktop() && view().trace.opened())
  const width = createMemo(() => layout.trace.width())
  const close = () => view().trace.close()

  const [traces, setTraces] = createSignal<TraceInfo[]>([])
  const [toolDefs, setToolDefs] = createSignal<Record<string, unknown>[] | null>(null)
  const [traceSystem, setTraceSystem] = createSignal<string | null>(null)
  const [store, setStore] = createStore({
    selected: undefined as string | undefined,
    detail: undefined as TraceDetail | undefined,
    loading: false,
    tab: "run" as "run" | "prompts" | "attributes" | "messages",
    filter: {
      agent: "" as string,
      model: "" as string,
      provider: "" as string,
      status: "all" as "all" | "ok" | "error",
      minDur: undefined as number | undefined,
      maxDur: undefined as number | undefined,
    },
    search: "",
    searchIDs: undefined as string[] | undefined,
    zoom: { start: 0, end: 1 },
    compare: {
      active: false,
      a: undefined as string | undefined,
      b: undefined as string | undefined,
      detailA: undefined as TraceDetail | undefined,
      detailB: undefined as TraceDetail | undefined,
    },
  })

  const load = async (id: string) => {
    const res = await sdk.client.project.session.trace.list({
      sessionID: id,
      projectID: sdk.projectID,
      deep: true,
    })
    const list = (res.data ?? []) as TraceInfo[]
    setTraces(list)
    const last = list.findLast((t) => t.hasTools || t.hasSystem)
    if (last) {
      const sid = last.sessionID || id
      const r = await sdk.client.project.session.trace.get({
        sessionID: sid,
        traceID: last.id,
        projectID: sdk.projectID,
      })
      const d = r.data as TraceDetail | undefined
      if (d) {
        setToolDefs(d.tools)
        setTraceSystem(d.system)
      }
    }
  }

  const detail = async (sid: string, tid: string) => {
    setStore("loading", true)
    const res = await sdk.client.project.session.trace.get({
      sessionID: sid,
      traceID: tid,
      projectID: sdk.projectID,
    })
    if (res.data) setStore("detail", res.data as TraceDetail)
    setStore("loading", false)
  }

  const doSearch = async (sid: string, query: string) => {
    if (!query.trim()) {
      setStore("searchIDs", undefined)
      return
    }
    const res = await sdk.client.project.session.trace.search({
      sessionID: sid,
      q: query,
      projectID: sdk.projectID,
    })
    if (res.data) {
      setStore("searchIDs", res.data.ids)
    }
  }

  const status = createMemo(() => {
    const id = params.id
    if (!id) return undefined
    return sync.data.session_status[id]?.type
  })

  createEffect(
    on(
      () => params.id,
      (id) => {
        setTraces([])
        setStore({
          selected: undefined,
          detail: undefined,
          loading: false,
          search: "",
          searchIDs: undefined,
        })
        if (id && opened()) load(id)
      },
    ),
  )

  createEffect(
    on(opened, (open) => {
      if (!open) return
      const id = params.id
      if (id) load(id)
    }),
  )

  // Reload traces when session finishes (status transitions to idle)
  createEffect(
    on(status, (cur, prev) => {
      if (!opened()) return
      const id = params.id
      if (!id) return
      if (prev && prev !== "idle" && (!cur || cur === "idle")) load(id)
    }),
  )

  // Poll for new traces while the session is busy and the panel is open
  createEffect(() => {
    const id = params.id
    if (!id || !opened() || status() !== "busy") return
    const interval = setInterval(() => load(id), 2000)
    onCleanup(() => clearInterval(interval))
  })

  // Debounced search effect
  let timer: number | undefined
  createEffect(
    on(
      () => store.search,
      (q) => {
        clearTimeout(timer)
        const id = params.id
        if (!id) return
        timer = window.setTimeout(() => doSearch(id, q), 300)
      },
    ),
  )

  const select = (trace: TraceInfo) => {
    const id = params.id
    if (!id) return
    const sid = trace.sessionID || id

    if (store.compare.active) {
      if (!store.compare.a) {
        setStore("compare", "a", trace.id)
        sdk.client.project.session.trace
          .get({ sessionID: sid, traceID: trace.id, projectID: sdk.projectID })
          .then((r) => setStore("compare", "detailA", r.data as TraceDetail))
      } else if (!store.compare.b && trace.id !== store.compare.a) {
        setStore("compare", "b", trace.id)
        sdk.client.project.session.trace
          .get({ sessionID: sid, traceID: trace.id, projectID: sdk.projectID })
          .then((r) => setStore("compare", "detailB", r.data as TraceDetail))
      }
      return
    }

    setStore("selected", trace.id)
    setStore("tab", "run")
    if (sid !== id) void sync.session.sync(sid)
    detail(sid, trace.id)
  }

  const messages = createMemo(() => {
    const id = params.id
    if (!id) return []
    const parent = sync.data.message[id] ?? []
    const sid = store.detail?.sessionID
    if (!sid || sid === id) return parent
    const child = sync.data.message[sid] ?? []
    if (child.length === 0) return parent
    return [...parent, ...child]
  })

  const tokens = createMemo(() => {
    if (!store.detail) return undefined
    const ids = store.detail.contextIDs
    const msg = messages().find((m) => m.role === "assistant" && m.id === ids?.[ids.length - 1])
    if (!msg || msg.role !== "assistant") return undefined
    return msg as {
      tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
      cost: number
    }
  })

  // ── Session-level metrics (same as context tab) ──
  const sessionMessages = createMemo(() => {
    const id = params.id
    if (!id) return [] as Message[]
    return (sync.data.message[id] ?? []) as Message[]
  })

  const metrics = createMemo(() => getSessionContextMetrics(sessionMessages(), sync.data.provider.all))
  const ctx = createMemo(() => metrics().context)

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )
  const cost = createMemo(() => usd().format(metrics().totalCost))
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))

  const counts = createMemo(() => {
    const all = sessionMessages()
    const user = all.reduce((n, x) => n + (x.role === "user" ? 1 : 0), 0)
    const assistant = all.reduce((n, x) => n + (x.role === "assistant" ? 1 : 0), 0)
    return { all: all.length, user, assistant }
  })

  const userMessages = createMemo(() => sessionMessages().filter((m) => m.role === "user") as UserMessage[])

  const systemPrompt = createMemo(
    () => traceSystem()?.trim() || findLast(userMessages(), (m) => !!m.system)?.system?.trim() || undefined,
  )

  const breakdown = createMemo(
    on(
      () => [ctx()?.message.id, ctx()?.input, sessionMessages().length, systemPrompt(), toolDefs()],
      () => {
        const c = ctx()
        if (!c?.input) return []
        return estimateSessionContextBreakdown({
          messages: sessionMessages(),
          parts: sync.data.part as Record<string, Part[] | undefined>,
          input: c.input,
          systemPrompt: systemPrompt(),
          toolDefs: toolDefs(),
        })
      },
    ),
  )

  // Per-span token lookup (so every span row can show tokens without selection)
  const spanTokens = createMemo(() => {
    const map = new Map<string, { input: number; output: number; total: number; cost: number }>()
    for (const trace of traces()) {
      const mid = trace.messageID
      const msg = sessionMessages().find((m) => m.role === "assistant" && m.id === mid) as
        | (AssistantMessage & { cost: number })
        | undefined
      if (!msg) continue
      const total = msg.tokens.input + msg.tokens.output
      if (total <= 0) continue
      map.set(trace.id, { input: msg.tokens.input, output: msg.tokens.output, total, cost: msg.cost })
    }
    return map
  })

  // Unique values for filter dropdowns
  const agents = createMemo(() => [...new Set(traces().map((t) => t.agent))].sort())
  const models = createMemo(() => [...new Set(traces().map((t) => t.modelID))].sort())
  const providers = createMemo(() => [...new Set(traces().map((t) => t.providerID))].sort())

  // Filtered traces
  const filtered = createMemo(() => {
    let list = traces()
    const f = store.filter

    if (f.agent) list = list.filter((t) => t.agent === f.agent)
    if (f.model) list = list.filter((t) => t.modelID === f.model)
    if (f.provider) list = list.filter((t) => t.providerID === f.provider)
    if (f.status === "ok") list = list.filter((t) => !t.error)
    if (f.status === "error") list = list.filter((t) => !!t.error)
    const minDur = f.minDur
    if (minDur !== undefined)
      list = list.filter((t) => {
        const dur = (t.timeEnd ?? Date.now()) - t.timeStart
        return dur >= minDur
      })
    const maxDur = f.maxDur
    if (maxDur !== undefined)
      list = list.filter((t) => {
        const dur = (t.timeEnd ?? Date.now()) - t.timeStart
        return dur <= maxDur
      })
    if (store.searchIDs) {
      const ids = new Set(store.searchIDs)
      list = list.filter((t) => ids.has(t.id))
    }
    return list
  })

  // Total latency across all traces (unfiltered)
  const latency = createMemo(() => {
    const all = traces()
    if (all.length === 0) return 0
    const start = Math.min(...all.map((t) => t.timeStart))
    const end = Math.max(...all.map((t) => t.timeEnd ?? Date.now()))
    return end - start
  })

  // Timeline scale for waterfall bars (filtered + zoomed)
  const timeline = createMemo(() => {
    const all = filtered()
    if (all.length === 0) return { start: 0, end: 1 }
    const start = Math.min(...all.map((t) => t.timeStart))
    const end = Math.max(...all.map((t) => t.timeEnd ?? Date.now()))
    const range = Math.max(end - start, 1)
    const zStart = start + range * store.zoom.start
    const zEnd = start + range * store.zoom.end
    return { start: zStart, end: Math.max(zEnd, zStart + 1) }
  })

  const hasError = createMemo(() => traces().some((t) => t.error))

  const resetFilters = () => {
    setStore("filter", { agent: "", model: "", provider: "", status: "all", minDur: undefined, maxDur: undefined })
    setStore("search", "")
    setStore("searchIDs", undefined)
    setStore("zoom", { start: 0, end: 1 })
  }

  const zoomIn = () => {
    const { start, end } = store.zoom
    const range = end - start
    const mid = (start + end) / 2
    const next = Math.max(range * 0.5, 0.05)
    setStore("zoom", { start: Math.max(0, mid - next / 2), end: Math.min(1, mid + next / 2) })
  }

  const zoomOut = () => {
    const { start, end } = store.zoom
    const range = end - start
    const mid = (start + end) / 2
    const next = Math.min(range * 2, 1)
    setStore("zoom", { start: Math.max(0, mid - next / 2), end: Math.min(1, mid + next / 2) })
  }

  const zoomReset = () => setStore("zoom", { start: 0, end: 1 })

  const toggleCompare = () => {
    if (store.compare.active) {
      setStore("compare", { active: false, a: undefined, b: undefined, detailA: undefined, detailB: undefined })
    } else {
      setStore("compare", { active: true, a: undefined, b: undefined, detailA: undefined, detailB: undefined })
    }
  }

  const isCompareSelected = (id: string) => store.compare.a === id || store.compare.b === id

  const hasActiveFilters = createMemo(
    () =>
      store.filter.agent !== "" ||
      store.filter.model !== "" ||
      store.filter.provider !== "" ||
      store.filter.status !== "all" ||
      store.filter.minDur !== undefined ||
      store.filter.maxDur !== undefined ||
      store.search !== "" ||
      store.zoom.start !== 0 ||
      store.zoom.end !== 1,
  )

  return (
    <Show when={isDesktop()}>
      <aside
        id="trace-panel"
        aria-label="Trace"
        aria-hidden={!opened()}
        inert={!opened()}
        class="trace-panel-aside"
        classList={{
          "trace-panel-aside--hidden": !opened(),
          "trace-panel-aside--animated": !props.size.active(),
        }}
        style={{ width: opened() ? `${width()}px` : "0px" }}
      >
        <div class="trace-panel-inner">
          {/* ── Status Bar ─────────────────────────────────── */}
          <div class="trace-statusbar">
            <div class="trace-statusbar-left">
              <Icon name="status" size="small" />
              <span class="trace-statusbar-title">Trace</span>
              <span class="trace-statusbar-sep">|</span>
              <span class="trace-status-badge" classList={{ "trace-status-badge--error": hasError() }}>
                {hasError() ? "ERROR" : "OK"}
              </span>
              <span class="trace-statusbar-sep">|</span>
              <span class="trace-statusbar-latency">⏱ {fmt(latency())}</span>
              <span class="trace-statusbar-count">
                {filtered().length}/{traces().length} spans
              </span>
              <Show when={ctx()}>
                {(c) => (
                  <div class="trace-statusbar-metrics">
                    <span class="trace-statusbar-sep">|</span>
                    <span class="trace-statusbar-metric">🔄 {c().total.toLocaleString(language.intl())}</span>
                    <span class="trace-statusbar-metric">{cost()}</span>
                    <Show when={c().usage !== null}>
                      <span class="trace-statusbar-metric">{c().usage}% ctx</span>
                    </Show>
                  </div>
                )}
              </Show>
            </div>
            <div class="trace-statusbar-right">
              <button
                type="button"
                class="trace-compare-toggle"
                classList={{ "trace-compare-toggle--active": store.compare.active }}
                onClick={toggleCompare}
                title="Compare two spans"
              >
                ⇄ Compare
              </button>
              <IconButton
                icon="download"
                variant="ghost"
                title="Export traces"
                onClick={async () => {
                  const id = params.id
                  if (!id) return
                  // Collect all unique session IDs from traces (parent + sub-agents)
                  const sids = [...new Set(traces().map((t) => t.sessionID || id))]
                  // Sync any child sessions that haven't been loaded yet
                  await Promise.all(sids.filter((s) => s !== id).map((s) => sync.session.sync(s)))
                  // Gather messages from all sessions
                  const all = sids.flatMap((s) => sync.data.message[s] ?? [])
                  const seen = new Set<string>()
                  const msgs = all.filter((m) => {
                    if (seen.has(m.id)) return false
                    seen.add(m.id)
                    return true
                  })
                  const msgsWithParts = msgs.map((m) => ({
                    ...m,
                    parts: sync.data.part[m.id] ?? [],
                  }))
                  const exportData = {
                    sessions: sids,
                    traces: traces(),
                    messages: msgsWithParts,
                  }
                  const data = JSON.stringify(exportData, null, 2)
                  const blob = new Blob([data], { type: "application/json" })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement("a")
                  a.href = url
                  a.download = `traces-${id}.json`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                }}
              />
              <IconButton icon="close-small" variant="ghost" title="Close" onClick={close} />
            </div>
          </div>

          {/* ── Filters Bar ──────────────────────────────── */}
          <div class="trace-filterbar">
            <div class="trace-filterbar-row">
              <div class="trace-search-wrap">
                <span class="trace-search-icon">🔍</span>
                <input
                  class="trace-search"
                  type="text"
                  placeholder="Search prompts & tools…"
                  value={store.search}
                  onInput={(e) => setStore("search", e.currentTarget.value)}
                />
              </div>
              <select
                class="trace-filter-select"
                value={store.filter.agent}
                onChange={(e) => setStore("filter", "agent", e.currentTarget.value)}
              >
                <option value="">All agents</option>
                <For each={agents()}>{(a) => <option value={a}>{a}</option>}</For>
              </select>
              <select
                class="trace-filter-select"
                value={store.filter.model}
                onChange={(e) => setStore("filter", "model", e.currentTarget.value)}
              >
                <option value="">All models</option>
                <For each={models()}>{(m) => <option value={m}>{m}</option>}</For>
              </select>
              <select
                class="trace-filter-select"
                value={store.filter.provider}
                onChange={(e) => setStore("filter", "provider", e.currentTarget.value)}
              >
                <option value="">All providers</option>
                <For each={providers()}>{(p) => <option value={p}>{p}</option>}</For>
              </select>
              <select
                class="trace-filter-select"
                value={store.filter.status}
                onChange={(e) => setStore("filter", "status", e.currentTarget.value as "all" | "ok" | "error")}
              >
                <option value="all">All status</option>
                <option value="ok">OK</option>
                <option value="error">Error</option>
              </select>
            </div>
            <div class="trace-filterbar-row">
              <div class="trace-dur-range">
                <input
                  class="trace-filter-input"
                  type="number"
                  placeholder="Min ms"
                  value={store.filter.minDur ?? ""}
                  onInput={(e) => {
                    const v = e.currentTarget.value
                    setStore("filter", "minDur", v ? Number(v) : undefined)
                  }}
                />
                <span class="trace-dur-sep">–</span>
                <input
                  class="trace-filter-input"
                  type="number"
                  placeholder="Max ms"
                  value={store.filter.maxDur ?? ""}
                  onInput={(e) => {
                    const v = e.currentTarget.value
                    setStore("filter", "maxDur", v ? Number(v) : undefined)
                  }}
                />
              </div>
              <div class="trace-zoom-controls">
                <button type="button" class="trace-zoom-btn" onClick={zoomIn} title="Zoom in">
                  ＋
                </button>
                <button type="button" class="trace-zoom-btn" onClick={zoomOut} title="Zoom out">
                  －
                </button>
                <button type="button" class="trace-zoom-btn" onClick={zoomReset} title="Reset zoom">
                  ⊡
                </button>
              </div>
              <Show when={hasActiveFilters()}>
                <button type="button" class="trace-reset-btn" onClick={resetFilters}>
                  Reset
                </button>
              </Show>
            </div>
          </div>

          {/* ── Session Overview (collapsible) ──────────── */}
          <div class="trace-overview">
            <button type="button" class="trace-overview-toggle" onClick={() => setOverview(!overview())}>
              <span class="trace-overview-chevron" classList={{ "trace-overview-chevron--open": overview() }}>
                ▶
              </span>
              Session Overview
              <Show when={ctx()}>
                {(c) => (
                  <span class="trace-statusbar-metric" style={{ "margin-left": "auto" }}>
                    {c().providerLabel} / {c().modelLabel}
                  </span>
                )}
              </Show>
            </button>
            <Show when={overview()}>
              <div class="trace-overview-body">
                <div class="trace-overview-grid">
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.session")}</div>
                    <div class="trace-overview-value">{info()?.title ?? params.id ?? "—"}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.messages")}</div>
                    <div class="trace-overview-value">{counts().all.toLocaleString(language.intl())}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.provider")}</div>
                    <div class="trace-overview-value">{ctx()?.providerLabel ?? "—"}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.model")}</div>
                    <div class="trace-overview-value">{ctx()?.modelLabel ?? "—"}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.limit")}</div>
                    <div class="trace-overview-value">{formatter().number(ctx()?.limit)}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.totalTokens")}</div>
                    <div class="trace-overview-value">{formatter().number(ctx()?.total)}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.usage")}</div>
                    <div class="trace-overview-value">{formatter().percent(ctx()?.usage)}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.inputTokens")}</div>
                    <div class="trace-overview-value">{formatter().number(ctx()?.input)}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.outputTokens")}</div>
                    <div class="trace-overview-value">{formatter().number(ctx()?.output)}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.reasoningTokens")}</div>
                    <div class="trace-overview-value">{formatter().number(ctx()?.reasoning)}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.cacheTokens")}</div>
                    <div class="trace-overview-value">
                      {`${formatter().number(ctx()?.cacheRead)} / ${formatter().number(ctx()?.cacheWrite)}`}
                    </div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.userMessages")}</div>
                    <div class="trace-overview-value">{counts().user.toLocaleString(language.intl())}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.assistantMessages")}</div>
                    <div class="trace-overview-value">{counts().assistant.toLocaleString(language.intl())}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.totalCost")}</div>
                    <div class="trace-overview-value">{cost()}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.sessionCreated")}</div>
                    <div class="trace-overview-value">{formatter().time(info()?.time.created)}</div>
                  </div>
                  <div class="trace-overview-stat">
                    <div class="trace-overview-label">{language.t("context.stats.lastActivity")}</div>
                    <div class="trace-overview-value">{formatter().time(ctx()?.message.time.created)}</div>
                  </div>
                </div>

                <Show when={breakdown().length > 0}>
                  <div class="trace-breakdown">
                    <div class="trace-breakdown-label">Context Breakdown</div>
                    <div class="trace-breakdown-bar">
                      <For each={breakdown()}>
                        {(seg) => (
                          <div
                            class="trace-breakdown-segment"
                            style={{
                              width: `${seg.width}%`,
                              "background-color": BREAKDOWN_COLOR[seg.key],
                            }}
                          />
                        )}
                      </For>
                    </div>
                    <div class="trace-breakdown-legend">
                      <For each={breakdown()}>
                        {(seg) => (
                          <div class="trace-breakdown-item">
                            <div class="trace-breakdown-dot" style={{ "background-color": BREAKDOWN_COLOR[seg.key] }} />
                            {BREAKDOWN_LABEL[seg.key]} {seg.percent}%
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>
          </div>

          {/* ── Main Layout: Span Tree (left) + Detail (right) ── */}
          <div class="trace-main">
            {/* Left: Span Tree */}
            <div class="trace-sidebar">
              <div class="trace-sidebar-header">
                <span class="trace-sidebar-label">Spans</span>
              </div>
              <div class="trace-sidebar-list">
                <Show when={filtered().length === 0}>
                  <div class="trace-sidebar-empty">
                    {traces().length === 0 ? "No trace data" : "No spans match filters"}
                  </div>
                </Show>
                <For each={filtered()}>
                  {(trace) => {
                    const type = spanType(trace)
                    const color = SPAN_COLORS[type] ?? SPAN_COLORS.default
                    const dur = () =>
                      trace.timeEnd ? fmt(trace.timeEnd - trace.timeStart) : fmt(Date.now() - trace.timeStart)
                    const tl = timeline()
                    const range = tl.end - tl.start
                    const left = Math.max(0, ((trace.timeStart - tl.start) / range) * 100)
                    const w = Math.min(100 - left, (((trace.timeEnd ?? Date.now()) - trace.timeStart) / range) * 100)
                    return (
                      <button
                        type="button"
                        class="trace-span"
                        classList={{
                          "trace-span--selected": store.selected === trace.id && !store.compare.active,
                          "trace-span--compare": isCompareSelected(trace.id),
                        }}
                        onClick={() => select(trace)}
                      >
                        <span class="trace-span-dot" style={{ background: color }} />
                        <div class="trace-span-info">
                          <span class="trace-span-agent">{trace.agent}</span>
                          <span class="trace-span-name">
                            {trace.providerID}/{trace.modelID}
                          </span>
                          <Show when={spanTokens().get(trace.id)}>
                            {(tk) => <span class="trace-span-tokens">🔄 {tk().total.toLocaleString()}</span>}
                          </Show>
                          <span class="trace-span-dur">{dur()}</span>
                        </div>
                        {/* Waterfall bar */}
                        <div class="trace-span-waterfall">
                          <div
                            class="trace-span-bar"
                            style={{
                              left: `${left}%`,
                              width: `${Math.max(w, 2)}%`,
                              background: color,
                            }}
                          />
                        </div>
                        <Show when={store.compare.active}>
                          <span class="trace-span-compare-badge">
                            {store.compare.a === trace.id ? "A" : store.compare.b === trace.id ? "B" : ""}
                          </span>
                        </Show>
                      </button>
                    )
                  }}
                </For>
              </div>
            </div>

            {/* Right: Detail or Compare Pane */}
            <div class="trace-content">
              <Show when={store.compare.active && store.compare.detailA && store.compare.detailB}>
                <CompareView
                  a={store.compare.detailA as TraceDetail}
                  b={store.compare.detailB as TraceDetail}
                  onExit={toggleCompare}
                />
              </Show>
              <Show when={store.compare.active && !(store.compare.detailA && store.compare.detailB)}>
                <div class="trace-content-empty">
                  <div class="trace-content-empty-text">
                    {!store.compare.a ? "Select first span (A)" : "Select second span (B)"}
                  </div>
                </div>
              </Show>
              <Show when={!store.compare.active}>
                <Show
                  when={store.detail}
                  fallback={
                    <div class="trace-content-empty">
                      <div class="trace-content-empty-text">Select a span to inspect</div>
                    </div>
                  }
                >
                  {(d) => (
                    <TraceDetailView
                      detail={d()}
                      tab={store.tab}
                      setTab={(tab) => setStore("tab", tab)}
                      messages={messages()}
                      tokens={tokens()}
                    />
                  )}
                </Show>
              </Show>
            </div>
          </div>
        </div>
        <Show when={opened()}>
          <div onPointerDown={() => props.size.start()}>
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={width()}
              min={500}
              max={typeof window === "undefined" ? 1200 : window.innerWidth * 0.7}
              collapseThreshold={400}
              onResize={(w) => {
                props.size.touch()
                layout.trace.resize(w)
              }}
              onCollapse={close}
            />
          </div>
        </Show>
      </aside>
    </Show>
  )
}
