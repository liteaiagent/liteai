import type { Accessor, Component, Setter } from "solid-js"
import { Show } from "solid-js"

export type SettingsScope = "user" | "project"

export const SettingsScopeSwitcher: Component<{
  scope: Accessor<SettingsScope>
  setScope: Setter<SettingsScope>
  hasWorkspace: Accessor<boolean>
}> = (props) => {
  return (
    <div class="flex items-center gap-1 bg-surface-stronger rounded-lg p-0.5 w-fit">
      <button
        type="button"
        class={`px-3 py-1 rounded-md text-12-medium transition-colors ${
          props.scope() === "user"
            ? "bg-surface-base text-text-strong shadow-sm"
            : "text-text-weak hover:text-text-strong"
        }`}
        onClick={() => props.setScope("user")}
      >
        User
      </button>
      <button
        type="button"
        class={`px-3 py-1 rounded-md text-12-medium transition-colors ${
          props.scope() === "project"
            ? "bg-surface-base text-text-strong shadow-sm"
            : props.hasWorkspace()
              ? "text-text-weak hover:text-text-strong"
              : "text-text-weaker cursor-not-allowed"
        }`}
        onClick={() => {
          if (props.hasWorkspace()) props.setScope("project")
        }}
        disabled={!props.hasWorkspace()}
      >
        Project
      </button>
      <Show when={props.scope() === "project" && !props.hasWorkspace()}>
        <span class="text-11-regular text-text-weaker ml-1">No workspace</span>
      </Show>
    </div>
  )
}
