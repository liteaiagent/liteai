import { Show } from "solid-js"
import "./agent-row.css"

export interface AgentEntry {
  agentId: string
  agentType: string
  parentId: string
  isAsync: boolean
  status: "running" | "completed" | "failed" | "killed"
  activity?: string
  duration?: number
  usage?: {
    totalTokens: number
    toolCalls: number
    duration: number
  }
  error?: string
  partialResult?: string
}

export interface AgentRowProps {
  entry: AgentEntry
  selected?: boolean
  onClick?: () => void
}

export function AgentRow(props: AgentRowProps) {
  return (
    <button type="button" class="agent-row" data-selected={props.selected || undefined} onClick={props.onClick}>
      <div class="agent-row-header">
        <div class="agent-row-title">
          <span>{props.entry.agentType}</span>
          <Show when={props.entry.isAsync}>
            <span
              class="agent-row-meta"
              style={{
                "font-size": "10px",
                border: "1px solid var(--border-weak-base)",
                padding: "0 4px",
                "border-radius": "4px",
              }}
            >
              ASYNC
            </span>
          </Show>
        </div>
        <div class="agent-row-status-chip" data-status={props.entry.status}>
          {props.entry.status}
        </div>
      </div>

      <Show when={props.entry.activity}>
        <div class="agent-row-activity">{props.entry.activity}</div>
      </Show>

      <Show when={props.entry.error}>
        <div class="agent-row-activity" style={{ color: "var(--color-danger, #e74c3c)" }} title={props.entry.error}>
          {props.entry.error}
        </div>
      </Show>

      <Show when={props.entry.duration != null || props.entry.usage}>
        <div class="agent-row-meta">
          <Show when={props.entry.usage?.totalTokens}>
            <span>{props.entry.usage?.totalTokens.toLocaleString()} tokens</span>
          </Show>
          <Show when={props.entry.duration != null}>
            <span>{((props.entry.duration || 0) / 1000).toFixed(1)}s</span>
          </Show>
        </div>
      </Show>
    </button>
  )
}
