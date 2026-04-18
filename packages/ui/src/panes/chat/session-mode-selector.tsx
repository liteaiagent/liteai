import { Select } from "@liteai/ui/select"
import { Tooltip } from "@liteai/ui/tooltip"
import type { Component, JSX } from "solid-js"

export type SessionMode = "Normal" | "Coordinator" | "Swarm"

export interface SessionModeSelectorProps {
  /** Currently active session mode. */
  current: SessionMode
  /** Callback when the user selects a different mode. */
  onSelect: (mode: SessionMode) => void
  /** Style applied to the trigger button (animation transforms, etc). */
  triggerStyle?: JSX.CSSProperties
  /** Tooltip description text. */
  tooltip?: string
  /** Whether the entire selector is disabled. */
  disabled?: boolean
}

/**
 * Modes that are fully implemented and selectable.
 * Coordinator and Swarm appear as disabled placeholder items for discoverability.
 */
const ENABLED_MODES: Set<SessionMode> = new Set(["Normal"])

const ALL_MODES: SessionMode[] = ["Normal", "Coordinator", "Swarm"]

const MODE_LABELS: Record<SessionMode, string> = {
  Normal: "Normal",
  Coordinator: "Coordinator (coming soon)",
  Swarm: "Swarm (coming soon)",
}

/**
 * Standalone selector for the Session Mode axis.
 *
 * Currently only "Normal" is selectable. "Coordinator" and "Swarm" appear
 * as disabled options with tooltips indicating future availability.
 * This provides discoverability for upcoming multi-agent orchestration modes.
 */
export const SessionModeSelector: Component<SessionModeSelectorProps> = (props) => {
  return (
    <div data-component="prompt-session-mode-control">
      <Tooltip placement="top" gutter={4} inactive={props.disabled} value={props.tooltip ?? "Session Mode"}>
        <Select
          size="normal"
          options={ALL_MODES}
          current={props.current}
          label={(x) => MODE_LABELS[x]}
          onSelect={(v) => {
            if (v && ENABLED_MODES.has(v)) props.onSelect(v)
          }}
          class="max-w-[160px] text-text-base"
          valueClass="truncate text-13-regular text-text-base"
          triggerStyle={props.triggerStyle}
          triggerProps={{ "data-action": "prompt-session-mode" }}
          variant="ghost"
          disabled={props.disabled}
        >
          {(item) => {
            if (!item) return ""
            const enabled = ENABLED_MODES.has(item)
            return (
              <span
                classList={{
                  "text-text-weak opacity-50 cursor-not-allowed": !enabled,
                }}
                title={!enabled ? "This mode is not yet available" : undefined}
              >
                {MODE_LABELS[item]}
              </span>
            )
          }}
        </Select>
      </Tooltip>
    </div>
  )
}
