import { createElement, type ElementType, type ReactElement } from "react"
import { ToggleButton } from "storybook/internal/components"
import { useGlobals } from "storybook/manager-api"

export function ThemeTool(): ReactElement {
  const [globals, updateGlobals] = useGlobals()
  const mode = globals.theme === "dark" ? "dark" : "light"
  const toggle = () => {
    const next = mode === "dark" ? "light" : "dark"
    updateGlobals({ theme: next })
  }
  return createElement(
    ToggleButton as unknown as ElementType,
    {
      title: "Toggle theme",
      active: mode === "dark",
      pressed: mode === "dark",
      onClick: toggle,
    },
    mode === "dark" ? "Dark" : "Light",
  ) as unknown as ReactElement
}
