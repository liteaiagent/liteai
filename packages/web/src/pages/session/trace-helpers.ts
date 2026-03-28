import type { TraceInfo } from "./trace-types"

export const fmt = (ms: number) => {
  if (ms < 0) return "—"
  if (ms < 1000) return `${ms}ms`
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

export const SPAN_COLORS: Record<string, string> = {
  llm: "#6366f1", // indigo
  tool: "#22c55e", // green
  agent: "#f59e0b", // amber
  default: "#8b5cf6", // violet
}

export function spanType(trace: TraceInfo) {
  if (trace.agent) return "agent"
  return "llm"
}

export function diffLines(a: string, b: string) {
  const la = a.split("\n")
  const lb = b.split("\n")
  const result: { type: "same" | "add" | "remove"; text: string }[] = []
  let ai = 0
  let bi = 0
  while (ai < la.length || bi < lb.length) {
    if (ai < la.length && bi < lb.length && la[ai] === lb[bi]) {
      result.push({ type: "same", text: la[ai] })
      ai++
      bi++
    } else if (ai < la.length && (bi >= lb.length || la[ai] !== lb[bi])) {
      result.push({ type: "remove", text: la[ai] })
      ai++
    } else {
      result.push({ type: "add", text: lb[bi] })
      bi++
    }
  }
  return result
}

export function toolDelta(a: Record<string, unknown>[] | null, b: Record<string, unknown>[] | null) {
  const names = (arr: Record<string, unknown>[] | null) => new Map((arr ?? []).map((t) => [t.name as string, t]))
  const ma = names(a)
  const mb = names(b)
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  for (const [name] of mb) {
    if (!ma.has(name)) added.push(name)
    else if (JSON.stringify(ma.get(name)) !== JSON.stringify(mb.get(name))) changed.push(name)
  }
  for (const [name] of ma) {
    if (!mb.has(name)) removed.push(name)
  }
  return { added, removed, changed }
}
