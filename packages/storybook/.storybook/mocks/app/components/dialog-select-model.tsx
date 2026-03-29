import { type JSX, splitProps, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"

export function ModelSelectorPopover(props: {
  triggerAs: ValidComponent
  triggerProps?: Record<string, unknown>
  children: JSX.Element
}) {
  const [local] = splitProps(props, ["triggerAs", "triggerProps", "children"])
  return (
    <Dynamic component={local.triggerAs} {...(local.triggerProps ?? {})}>
      {local.children}
    </Dynamic>
  )
}
