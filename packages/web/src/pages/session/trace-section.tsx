import { createSignal, type JSX, Show } from "solid-js"

export function Section(props: { title: string; extra?: JSX.Element; children: JSX.Element }) {
  const [open, setOpen] = createSignal(false)
  return (
    <div class="trace-section">
      <button type="button" class="trace-section-head" onClick={() => setOpen(!open())}>
        <span>
          {open() ? "▼" : "▶"} {props.title}
        </span>
        <Show when={props.extra}>{props.extra}</Show>
      </button>
      <Show when={open()}>
        <div class="trace-section-body">{props.children}</div>
      </Show>
    </div>
  )
}
