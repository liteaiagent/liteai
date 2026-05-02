import { useState } from "react"
import type { TuiConfig as TuiConfigNS } from "../../cli/config/tui"
import { TuiConfig } from "../../cli/config/tui"
import { createSimpleContext } from "./helper"

export const { use: useTuiConfig, provider: TuiConfigProvider } = createSimpleContext({
  name: "TuiConfig",
  init: (props: { config: TuiConfigNS.Info }) => {
    const [config, setConfig] = useState(props.config)
    return {
      ...config,
      update: (partial: Partial<TuiConfigNS.Info>) => {
        setConfig((c) => ({ ...c, ...partial }))
        // Persist to tui.json — fire-and-forget; UI updates synchronously via useState
        void TuiConfig.update(partial)
      },
    }
  },
})
