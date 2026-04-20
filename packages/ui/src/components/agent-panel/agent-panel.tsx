import { For, Show } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { type AgentEntry, AgentRow } from "./agent-row"
import { TranscriptView } from "./transcript-view"
import "./agent-panel.css"

import { createContext, useContext } from "solid-js"

export interface AgentPanelState {
  agents: Record<string, AgentEntry>
  drawerOpen: boolean
  selectedAgentId?: string
}

export type AgentPanelContextType = [AgentPanelState, SetStoreFunction<AgentPanelState>]

export const AgentPanelContext = createContext<AgentPanelContextType>()

export function useAgentPanel(): AgentPanelContextType | undefined {
  return useContext(AgentPanelContext)
}

export function useRequiredAgentPanel(): AgentPanelContextType {
  const ctx = useContext(AgentPanelContext)
  if (!ctx) {
    throw new Error("useRequiredAgentPanel must be used within an AgentPanelProvider")
  }
  return ctx
}

export function createAgentPanelState(): [AgentPanelState, SetStoreFunction<AgentPanelState>] {
  return createStore<AgentPanelState>({
    agents: {},
    drawerOpen: false,
    selectedAgentId: undefined,
  })
}

export interface AgentPanelProps {
  state: AgentPanelState
  setState: SetStoreFunction<AgentPanelState>
  onSelectAgent?: (agentId: string) => void
}

export function AgentPanel(props: AgentPanelProps) {
  const agentsList = () =>
    Object.values(props.state.agents).sort((a, b) => {
      // Basic sorting: running first, then completed.
      if (a.status === "running" && b.status !== "running") return -1
      if (b.status === "running" && a.status !== "running") return 1
      return 0
    })

  return (
    <>
      {/* Toggle button persists outside the drawer */}
      <Show when={Object.keys(props.state.agents).length > 0}>
        <button
          type="button"
          class="agent-panel-toggle"
          onClick={() => props.setState("drawerOpen", !props.state.drawerOpen)}
          title="Toggle Agents Panel"
          style={{
            background: "var(--color-fill-element, #222)",
            border: "1px solid var(--border-weak-base, #333)",
            color: "var(--text-strong, #fff)",
            padding: "6px 12px",
            "border-radius": "6px",
            cursor: "pointer",
            "font-size": "13px",
            ...(props.state.drawerOpen ? { display: "none" } : {}),
          }}
        >
          Agents ({Object.keys(props.state.agents).length})
        </button>
      </Show>

      {/* Drawer */}
      <div class="agent-panel-drawer" data-open={props.state.drawerOpen || undefined}>
        <div class="agent-panel-header">
          <div class="agent-panel-title">Active Agents</div>
          <button type="button" class="agent-panel-close" onClick={() => props.setState("drawerOpen", false)}>
            ✕
          </button>
        </div>
        <div class="agent-panel-body">
          <div class="agent-panel-list">
            <For each={agentsList()}>
              {(agent) => (
                <AgentRow
                  entry={agent}
                  selected={props.state.selectedAgentId === agent.agentId}
                  onClick={() => {
                    props.setState(
                      "selectedAgentId",
                      props.state.selectedAgentId === agent.agentId ? undefined : agent.agentId,
                    )
                    if (props.onSelectAgent) {
                      props.onSelectAgent(agent.agentId)
                    }
                  }}
                />
              )}
            </For>
          </div>
          <Show when={props.state.selectedAgentId}>{(agentId) => <TranscriptView agentId={agentId()} />}</Show>
        </div>
      </div>
    </>
  )
}
