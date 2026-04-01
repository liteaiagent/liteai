import type { Component, JSX } from "solid-js"
import { createMemo, onMount, splitProps } from "solid-js"
import spriteRaw from "./provider-icons/sprite.svg?raw"
import { type IconName, iconNames } from "./provider-icons/types"

/** Injects the provider-icon SVG sprite sheet as a hidden DOM element.
 * Must be mounted once, above any ProviderIcon usage. */
export const ProviderIconSprite: Component = () => {
  let ref: HTMLDivElement | undefined
  onMount(() => {
    if (ref) ref.innerHTML = spriteRaw
  })
  return <div ref={ref} aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden" />
}

export type ProviderIconProps = JSX.SVGElementTags["svg"] & {
  id: string
}

export const ProviderIcon: Component<ProviderIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])
  const resolved = createMemo(() => (iconNames.includes(local.id as IconName) ? local.id : "synthetic"))
  return (
    <svg
      data-component="provider-icon"
      {...rest}
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    >
      <title>{local.id}</title>
      <use href={`#${resolved()}`} />
    </svg>
  )
}
