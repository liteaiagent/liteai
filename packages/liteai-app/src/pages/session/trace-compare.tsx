import { createMemo, For, Show } from "solid-js"
import { diffLines, fmt, SPAN_COLORS, spanType, toolDelta } from "./trace-helpers"
import { Section } from "./trace-section"
import type { TraceDetail } from "./trace-types"

export function CompareView(props: { a: TraceDetail; b: TraceDetail; onExit: () => void }) {
  const typeA = () => spanType(props.a)
  const typeB = () => spanType(props.b)
  const colorA = () => SPAN_COLORS[typeA()] ?? SPAN_COLORS.default
  const colorB = () => SPAN_COLORS[typeB()] ?? SPAN_COLORS.default
  const durA = () => (props.a.timeEnd ? fmt(props.a.timeEnd - props.a.timeStart) : "running")
  const durB = () => (props.b.timeEnd ? fmt(props.b.timeEnd - props.b.timeStart) : "running")

  const promptDiff = createMemo(() => {
    const sa = props.a.system ?? ""
    const sb = props.b.system ?? ""
    if (sa === sb) return undefined
    return diffLines(sa, sb)
  })

  const delta = createMemo(() => toolDelta(props.a.tools, props.b.tools))

  return (
    <div class="trace-compare-view">
      <div class="trace-compare-header">
        <div class="trace-compare-side">
          <span class="trace-compare-label" style={{ background: colorA() }}>
            A
          </span>
          <span class="trace-compare-name">
            Step {props.a.step} — {props.a.providerID}/{props.a.modelID}
          </span>
          <span class="trace-detail-badge">{durA()}</span>
        </div>
        <span class="trace-compare-vs">vs</span>
        <div class="trace-compare-side">
          <span class="trace-compare-label" style={{ background: colorB() }}>
            B
          </span>
          <span class="trace-compare-name">
            Step {props.b.step} — {props.b.providerID}/{props.b.modelID}
          </span>
          <span class="trace-detail-badge">{durB()}</span>
        </div>
        <button type="button" class="trace-reset-btn" onClick={props.onExit}>
          Exit
        </button>
      </div>

      <div class="trace-compare-body">
        {/* System Prompt Diff */}
        <Section title="System Prompt Diff">
          <Show
            when={promptDiff()}
            fallback={
              <div class="trace-empty-text">{props.a.system ? "Prompts are identical" : "No system prompts"}</div>
            }
          >
            {(lines) => (
              <div class="trace-diff">
                <For each={lines()}>
                  {(line) => (
                    <div
                      class="trace-diff-line"
                      classList={{
                        "trace-diff-add": line.type === "add",
                        "trace-diff-remove": line.type === "remove",
                      }}
                    >
                      <span class="trace-diff-marker">
                        {line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
                      </span>
                      <span class="trace-diff-text">{line.text || " "}</span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </Show>
        </Section>

        {/* Tool Delta */}
        <Section title="Tool Delta">
          <Show
            when={delta().added.length > 0 || delta().removed.length > 0 || delta().changed.length > 0}
            fallback={<div class="trace-empty-text">No tool differences</div>}
          >
            <div class="trace-tool-delta">
              <For each={delta().added}>{(name) => <div class="trace-delta-item trace-delta-added">+ {name}</div>}</For>
              <For each={delta().removed}>
                {(name) => <div class="trace-delta-item trace-delta-removed">− {name}</div>}
              </For>
              <For each={delta().changed}>
                {(name) => <div class="trace-delta-item trace-delta-changed">~ {name}</div>}
              </For>
            </div>
          </Show>
        </Section>
      </div>
    </div>
  )
}
