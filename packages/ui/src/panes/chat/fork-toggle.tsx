import { Button } from "@liteai/ui/button"
import { Icon } from "@liteai/ui/icon"
import { Tooltip } from "@liteai/ui/tooltip"
import type { Component, JSX } from "solid-js"

export interface ForkToggleProps {
  /** Whether fork optimization is enabled. */
  enabled: boolean
  /** Callback when the user toggles the fork state. */
  onToggle: (enabled: boolean) => void
  /** Style applied to the button (animation transforms, etc). */
  style?: JSX.CSSProperties
  /** Whether the toggle is disabled (e.g. Coordinator mode forces fork off). */
  disabled?: boolean
  /** Tooltip for the disabled state. */
  disabledTooltip?: string
  /** Tooltip for the enabled state. */
  enabledTooltip?: string
}

/**
 * Standalone toggle for the Fork optimization axis.
 *
 * When enabled, subagent systems spawn with optimized, isolated context cache.
 * Certain session modes (Coordinator) may disable this control.
 */
export const ForkToggle: Component<ForkToggleProps> = (props) => {
  const tooltip = () => {
    if (props.disabled) return props.disabledTooltip ?? "Fork unavailable in this mode"
    return props.enabled
      ? (props.enabledTooltip ?? "Fork enabled — click to disable")
      : (props.disabledTooltip ?? "Fork disabled — click to enable")
  }

  return (
    <Tooltip placement="top" gutter={8} value={tooltip()}>
      <Button
        data-action="prompt-fork-toggle"
        data-component="prompt-fork-control"
        variant="ghost"
        onClick={() => {
          if (!props.disabled) props.onToggle(!props.enabled)
        }}
        classList={{
          "h-7 px-1.5 shrink-0 flex items-center justify-center gap-1 text-13-regular": true,
          "text-text-base": !props.enabled,
          "text-icon-success-base": props.enabled && !props.disabled,
          "opacity-40 cursor-not-allowed": !!props.disabled,
        }}
        style={props.style}
        disabled={props.disabled}
        aria-label={tooltip()}
        aria-pressed={props.enabled}
      >
        <Icon name="fork" size="small" />
        <span class="text-12-regular">Fork</span>
      </Button>
    </Tooltip>
  )
}
