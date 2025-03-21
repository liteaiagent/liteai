import type { RGBA } from "@opentui/core"
import open from "open"
import type { JSX } from "solid-js"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
}

/**
 * Link component that renders clickable hyperlinks.
 * Clicking anywhere on the link text opens the URL in the default browser.
 */
export function Link(props: LinkProps) {
  const displayText = props.children ?? props.href

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: TUI element, not HTML
    <text
      fg={props.fg}
      onMouseUp={() => {
        open(props.href).catch(() => {})
      }}
    >
      {displayText}
    </text>
  )
}
