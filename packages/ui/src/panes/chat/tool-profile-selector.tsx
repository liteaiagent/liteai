import { Select } from "@liteai/ui/select"
import { Tooltip } from "@liteai/ui/tooltip"
import type { Component, JSX } from "solid-js"

export type ToolProfile = "Plan" | "Fast"

export interface ToolProfileSelectorProps {
  /** Currently active tool profile. */
  current: ToolProfile
  /** Callback when the user selects a different profile. */
  onSelect: (profile: ToolProfile) => void
  /** Style applied to the trigger button (animation transforms, etc). */
  triggerStyle?: JSX.CSSProperties
  /** Tooltip description text. */
  tooltip?: string
  /** Whether the selector is disabled. */
  disabled?: boolean
}

const TOOL_PROFILES: ToolProfile[] = ["Plan", "Fast"]

const PROFILE_LABELS: Record<ToolProfile, string> = {
  Plan: "Plan",
  Fast: "Fast",
}

/**
 * Standalone selector for the Tool Profile axis.
 *
 * "Plan" (default): The root agent has access to `plan_enter` / `plan_exit` tools
 *   and can enter planning mode when it deems appropriate.
 * "Fast": Plan tools are excluded from the tool pool. The agent executes
 *   directly without proposing a plan, ideal for simple or repetitive tasks.
 */
export const ToolProfileSelector: Component<ToolProfileSelectorProps> = (props) => {
  return (
    <div data-component="prompt-tool-profile-control">
      <Tooltip placement="top" gutter={4} inactive={props.disabled} value={props.tooltip ?? "Tool Profile"}>
        <Select
          size="normal"
          options={TOOL_PROFILES}
          current={props.current}
          label={(x) => PROFILE_LABELS[x]}
          onSelect={(v) => {
            if (v) props.onSelect(v)
          }}
          class="max-w-[100px] text-text-base"
          valueClass="truncate text-13-regular text-text-base"
          triggerStyle={props.triggerStyle}
          triggerProps={{ "data-action": "prompt-tool-profile" }}
          variant="ghost"
          disabled={props.disabled}
        />
      </Tooltip>
    </div>
  )
}
