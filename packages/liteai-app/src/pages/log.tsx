import { createMemo, createResource, createSignal, For, type JSX, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"

interface LogEntry {
  level: string
  time: string
  delta: string
  service: string
  message: string
  extra: Record<string, string>
  raw: string
}

const LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const

/** Extract a balanced brace/bracket expression starting at pos in str. */
function balanced(str: string, pos: number): string | undefined {
  const open = str[pos]
  if (open !== "{" && open !== "[") return undefined
  const close = open === "{" ? "}" : "]"
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = pos; i < str.length; i++) {
    const ch = str[i]
    if (esc) {
      esc = false
      continue
    }
    if (ch === "\\") {
      esc = true
      continue
    }
    if (ch === '"') {
      inStr = !inStr
      continue
    }
    if (inStr) continue
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return str.slice(pos, i + 1)
    }
  }
  return undefined
}

/** Parse key=value pairs from a log line remainder, handling nested JSON bodies. */
function parseKV(str: string): { extra: Record<string, string>; remaining: string } {
  const extra: Record<string, string> = {}
  let pos = 0

  while (pos < str.length) {
    while (pos < str.length && str[pos] === " ") pos++
    if (pos >= str.length) break

    const eqMatch = str.slice(pos).match(/^(\w+)=/)
    if (!eqMatch) break

    const key = eqMatch[1]
    const valStart = pos + eqMatch[0].length

    if (valStart >= str.length) {
      extra[key] = ""
      pos = valStart
      break
    }

    const ch = str[valStart]

    if (ch === "{" || ch === "[") {
      const val = balanced(str, valStart)
      if (val) {
        extra[key] = val
        pos = valStart + val.length
        continue
      }
      extra[key] = str.slice(valStart)
      pos = str.length
      break
    }

    if (ch === '"') {
      let end = valStart + 1
      while (end < str.length) {
        if (str[end] === "\\") {
          end += 2
          continue
        }
        if (str[end] === '"') break
        end++
      }
      if (end < str.length) {
        extra[key] = str.slice(valStart, end + 1)
        pos = end + 1
        continue
      }
    }

    const spaceIdx = str.indexOf(" ", valStart)
    if (spaceIdx === -1) {
      extra[key] = str.slice(valStart)
      pos = str.length
    } else {
      extra[key] = str.slice(valStart, spaceIdx)
      pos = spaceIdx
    }
  }

  return { extra, remaining: str.slice(pos).trim() }
}

function parse(lines: string[]): LogEntry[] {
  const result: LogEntry[] = []
  for (const line of lines) {
    const match = line.match(/^(DEBUG|INFO|WARN|ERROR)\s+(\S+)\s+(\+\d+ms)\s+(.*)$/)
    if (!match) {
      const prev = result[result.length - 1]
      if (prev) {
        prev.message = prev.message ? `${prev.message}\n${line}` : line
        prev.raw += `\n${line}`
      }
      continue
    }

    const [, level, time, delta, rest] = match
    const { extra, remaining } = parseKV(rest)

    result.push({
      level,
      time,
      delta,
      service: extra.service ?? "",
      message: remaining || (Object.keys(extra).length ? "" : rest),
      extra,
      raw: line,
    })
  }
  return result
}

export default function LogViewer() {
  const sdk = useGlobalSDK()
  const [store, setStore] = createStore({
    service: "" as string,
    level: "DEBUG" as string,
    filter: "",
    expanded: new Set<number>(),
  })

  const [data, { refetch }] = createResource(async () => {
    try {
      const res = await fetch(`${sdk.url}/global/log`)
      const text = await res.text()
      try {
        return JSON.parse(text) as { lines: string[]; services: string[] }
      } catch {
        const lines = text.split("\n").filter(Boolean)
        const svc = new Set<string>()
        for (const l of lines) {
          const m = l.match(/service=(\S+)/)
          if (m) svc.add(m[1])
        }
        return { lines, services: [...svc].sort() }
      }
    } catch {
      return { lines: [], services: [] }
    }
  })

  const entries = createMemo(() => {
    const d = data()
    if (!d) return []
    return parse(d.lines)
  })

  const services = () => data()?.services ?? []

  const filtered = createMemo(() => {
    const lvl = LEVELS.indexOf(store.level as (typeof LEVELS)[number])
    const q = store.filter.toLowerCase()
    const svc = store.service
    return entries().filter((e) => {
      const idx = LEVELS.indexOf(e.level as (typeof LEVELS)[number])
      if (idx >= 0 && idx < lvl) return false
      if (svc && e.service !== svc && !e.service.startsWith(`${svc}.`) && !e.service.startsWith(`${svc}:`)) return false
      if (q && !e.raw.toLowerCase().includes(q)) return false
      return true
    })
  })

  const [autoRefresh, setAutoRefresh] = createSignal(false)
  let timer: ReturnType<typeof setInterval> | undefined

  const toggleAuto = () => {
    if (autoRefresh()) {
      clearInterval(timer)
      timer = undefined
      setAutoRefresh(false)
    } else {
      setAutoRefresh(true)
      timer = setInterval(() => refetch(), 2000)
    }
  }

  const toggle = (idx: number) => {
    const next = new Set(store.expanded)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setStore("expanded", next)
  }

  const ctrl: JSX.CSSProperties = {
    background: "var(--color-surface-raised-base, #252540)",
    color: "var(--color-text-base)",
    border: "1px solid var(--color-border-base, #444)",
    "border-radius": "4px",
    padding: "4px 8px",
    "font-size": "12px",
    "font-family": "inherit",
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "background-color": "var(--color-background-base)",
        color: "var(--color-text-base)",
        "font-family": "var(--font-mono, 'JetBrains Mono', monospace)",
        "font-size": "14px",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          padding: "8px 12px",
          "border-bottom": "1px solid var(--color-border-base, #333)",
          "align-items": "center",
          "flex-shrink": "0",
          "background-color": "var(--color-surface-base, #1a1a2e)",
        }}
      >
        <select value={store.service} onChange={(e) => setStore("service", e.currentTarget.value)} style={ctrl}>
          <option value="">All services</option>
          <For each={services()}>{(s) => <option value={s}>{s}</option>}</For>
        </select>

        <select value={store.level} onChange={(e) => setStore("level", e.currentTarget.value)} style={ctrl}>
          <For each={LEVELS}>{(l) => <option value={l}>{l}</option>}</For>
        </select>

        <input
          type="text"
          placeholder="Filter..."
          value={store.filter}
          onInput={(e) => setStore("filter", e.currentTarget.value)}
          style={{ ...ctrl, "flex-grow": "1", "min-width": "120px" }}
        />

        <button type="button" onClick={() => refetch()} style={{ ...ctrl, cursor: "pointer", padding: "4px 12px" }}>
          Refresh
        </button>

        <button
          type="button"
          onClick={toggleAuto}
          style={{
            ...ctrl,
            cursor: "pointer",
            padding: "4px 12px",
            ...(autoRefresh() ? { background: "var(--color-text-info, #60a5fa)", color: "#000" } : {}),
          }}
        >
          Auto
        </button>

        <button
          type="button"
          onClick={() => {
            if (store.expanded.size > 0) {
              setStore("expanded", new Set())
            } else {
              const all = new Set<number>()
              for (let i = 0; i < filtered().length; i++) all.add(i)
              setStore("expanded", all)
            }
          }}
          style={{ ...ctrl, cursor: "pointer", padding: "4px 12px" }}
        >
          {store.expanded.size > 0 ? "Collapse" : "Expand"}
        </button>

        <span style={{ color: "var(--color-text-weak)", "margin-left": "auto", "white-space": "nowrap" }}>
          {filtered().length} / {entries().length} entries
        </span>
      </div>

      {/* Log entries */}
      <div style={{ "flex-grow": "1", overflow: "auto", padding: "4px 0" }}>
        <Show
          when={!data.loading}
          fallback={
            <div style={{ padding: "20px", "text-align": "center", color: "var(--color-text-weak)" }}>Loading...</div>
          }
        >
          <table style={{ width: "100%", "border-collapse": "collapse", "table-layout": "fixed" }}>
            <colgroup>
              <col style={{ width: "56px" }} />
              <col style={{ width: "84px" }} />
              <col style={{ width: "56px" }} />
              <col style={{ width: "140px" }} />
              <col />
            </colgroup>
            <thead>
              <tr
                style={{
                  "border-bottom": "1px solid var(--color-border-base, #333)",
                  "text-align": "left",
                  color: "var(--color-text-weak)",
                  position: "sticky",
                  top: "0",
                  "background-color": "var(--color-surface-base, #1a1a2e)",
                  "z-index": "1",
                }}
              >
                <th style={{ padding: "4px 8px" }}>Level</th>
                <th style={{ padding: "4px 8px" }}>Time</th>
                <th style={{ padding: "4px 8px" }}>Delta</th>
                <th style={{ padding: "4px 8px" }}>Service</th>
                <th style={{ padding: "4px 8px" }}>Message / Extra</th>
              </tr>
            </thead>
            <tbody>
              <For each={filtered()}>
                {(entry, idx) => {
                  const hasExtra = () => Object.keys(entry.extra).filter((k) => k !== "service").length > 0
                  const multiline = () => entry.message.includes("\n")
                  const expandable = () => hasExtra() || multiline()
                  const expanded = () => store.expanded.has(idx())
                  const firstLine = () => {
                    const nl = entry.message.indexOf("\n")
                    return nl === -1 ? entry.message : entry.message.slice(0, nl)
                  }
                  return (
                    <>
                      <tr
                        onClick={() => expandable() && toggle(idx())}
                        style={{
                          "border-bottom": "1px solid var(--color-border-base, #1f1f3a)",
                          cursor: expandable() ? "pointer" : "default",
                          "background-color":
                            entry.level === "ERROR"
                              ? "rgba(239, 68, 68, 0.06)"
                              : entry.level === "WARN"
                                ? "rgba(245, 158, 11, 0.04)"
                                : "transparent",
                        }}
                      >
                        <td style={{ padding: "2px 8px" }}>
                          <LevelBadge level={entry.level} />
                        </td>
                        <td style={{ padding: "2px 8px", color: "var(--color-text-weak)" }}>{entry.time.slice(11)}</td>
                        <td style={{ padding: "2px 8px", color: "var(--color-text-weak)" }}>{entry.delta}</td>
                        <td
                          style={{
                            padding: "2px 8px",
                            color: "var(--color-text-info, #60a5fa)",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                        >
                          {entry.service}
                        </td>
                        <td
                          style={{
                            padding: "2px 8px",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                        >
                          {firstLine() || formatInline(entry.extra)}
                          <Show when={expandable()}>
                            <span style={{ color: "var(--color-text-weak)", "margin-left": "6px" }}>
                              {expanded() ? "▼" : "▶"}
                            </span>
                          </Show>
                        </td>
                      </tr>
                      <Show when={expanded() && expandable()}>
                        <tr>
                          <td
                            colSpan={5}
                            style={{
                              padding: "8px 24px 12px",
                              "background-color": "var(--color-surface-raised-base, #1a1a30)",
                              "border-bottom": "1px solid var(--color-border-base, #333)",
                            }}
                          >
                            <Show when={multiline()}>
                              <pre
                                style={{
                                  margin: "0 0 6px",
                                  padding: "8px 12px",
                                  "background-color": "var(--color-background-base, #0d0d1a)",
                                  "border-radius": "4px",
                                  border: "1px solid var(--color-border-base, #2a2a4a)",
                                  "white-space": "pre-wrap",
                                  "word-break": "break-all",
                                  "font-size": "11px",
                                  "line-height": "1.5",
                                  "max-height": "400px",
                                  overflow: "auto",
                                  color: "var(--color-text-base)",
                                }}
                              >
                                {entry.message}
                              </pre>
                            </Show>
                            <Show when={hasExtra()}>
                              <ExtraDetails extra={entry.extra} />
                            </Show>
                          </td>
                        </tr>
                      </Show>
                    </>
                  )
                }}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </div>
  )
}

function LevelBadge(props: { level: string }) {
  const bg = () => {
    switch (props.level) {
      case "ERROR":
        return "rgba(239, 68, 68, 0.15)"
      case "WARN":
        return "rgba(245, 158, 11, 0.15)"
      case "INFO":
        return "rgba(96, 165, 250, 0.12)"
      default:
        return "rgba(128, 128, 128, 0.1)"
    }
  }
  const color = () => {
    switch (props.level) {
      case "ERROR":
        return "#ef4444"
      case "WARN":
        return "#f59e0b"
      case "INFO":
        return "#60a5fa"
      default:
        return "var(--color-text-weak)"
    }
  }
  return (
    <span
      style={{
        display: "inline-block",
        "border-radius": "3px",
        padding: "0 4px",
        "font-size": "10px",
        "font-weight": "600",
        "letter-spacing": "0.5px",
        background: bg(),
        color: color(),
      }}
    >
      {props.level}
    </span>
  )
}

/** Render expanded details with proper JSON formatting for body/headers fields. */
function ExtraDetails(props: { extra: Record<string, string> }) {
  const items = () =>
    Object.entries(props.extra)
      .filter(([k]) => k !== "service")
      .map(([key, val]) => ({ key, val, json: tryParse(val) }))

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
      <For each={items()}>
        {(item) => (
          <div>
            <span
              style={{
                color: "var(--color-text-info, #60a5fa)",
                "font-size": "11px",
                "font-weight": "600",
                "margin-bottom": "2px",
                display: "block",
              }}
            >
              {item.key}
            </span>
            <Show
              when={item.json !== undefined}
              fallback={<span style={{ color: "var(--color-text-base)", "font-size": "11px" }}>{item.val}</span>}
            >
              <pre
                style={{
                  margin: "0",
                  padding: "8px 12px",
                  "background-color": "var(--color-background-base, #0d0d1a)",
                  "border-radius": "4px",
                  border: "1px solid var(--color-border-base, #2a2a4a)",
                  "white-space": "pre-wrap",
                  "word-break": "break-all",
                  "font-size": "11px",
                  "line-height": "1.5",
                  "max-height": "400px",
                  overflow: "auto",
                }}
              >
                <Show when={typeof item.json !== "string"} fallback={item.json as string}>
                  <JsonTree value={item.json} depth={0} />
                </Show>
              </pre>
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}

function tryParse(val: string): unknown | undefined {
  if (!val.startsWith("{") && !val.startsWith("[") && !val.startsWith('"')) return undefined
  try {
    return JSON.parse(val)
  } catch {
    return undefined
  }
}

/** Recursively render a JSON value with syntax coloring. */
function JsonTree(props: { value: unknown; depth: number }): JSX.Element {
  const v = props.value
  const indent = "  ".repeat(props.depth)
  const inner = "  ".repeat(props.depth + 1)

  if (v === null) return <span style={{ color: "#f59e0b" }}>null</span>
  if (v === undefined) return <span style={{ color: "#f59e0b" }}>undefined</span>
  if (typeof v === "boolean") return <span style={{ color: "#f59e0b" }}>{String(v)}</span>
  if (typeof v === "number") return <span style={{ color: "#c084fc" }}>{String(v)}</span>

  if (typeof v === "string") {
    const display = v.length > 200 ? `${v.slice(0, 200)}...[${v.length - 200} more]` : v
    return <span style={{ color: "#86efac" }}>"{display}"</span>
  }

  if (Array.isArray(v)) {
    if (v.length === 0) return <span>{"[]"}</span>
    return (
      <span>
        {"[\n"}
        <For each={v}>
          {(item, idx) => (
            <span>
              {inner}
              <JsonTree value={item} depth={props.depth + 1} />
              {idx() < v.length - 1 ? ",\n" : "\n"}
            </span>
          )}
        </For>
        {`${indent}]`}
      </span>
    )
  }

  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length === 0) return <span>{"{}"}</span>
    return (
      <span>
        {"{\n"}
        <For each={entries}>
          {([key, val], idx) => (
            <span>
              {inner}
              <span style={{ color: "#93c5fd" }}>"{key}"</span>
              {": "}
              <JsonTree value={val} depth={props.depth + 1} />
              {idx() < entries.length - 1 ? ",\n" : "\n"}
            </span>
          )}
        </For>
        {`${indent}}`}
      </span>
    )
  }

  return <span>{String(v)}</span>
}

function formatInline(extra: Record<string, string>) {
  return Object.entries(extra)
    .filter(([k]) => k !== "service")
    .map(([k, v]) => {
      const short = v.length > 60 ? `${v.slice(0, 60)}…` : v
      return `${k}=${short}`
    })
    .join(" ")
}
