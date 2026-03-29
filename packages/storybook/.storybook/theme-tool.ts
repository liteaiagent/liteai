import { createElement } from "react"
import { ToggleButton } from "storybook/internal/components"
import { useGlobals } from "storybook/manager-api"

export function ThemeTool() {
  const [globals, updateGlobals] = useGlobals()
  const mode = globals.theme === "dark" ? "dark" : "light"
  const toggle = () => {
    const next = mode === "dark" ? "light" : "dark"
    updateGlobals({ theme: next })
  }
  return createElement(
    ToggleButton,
    {
      title: "Toggle theme",
      active: mode === "dark",
      pressed: mode === "dark",
      onClick: toggle,
    },
    mode === "dark" ? "Dark" : "Light",
  )
}
