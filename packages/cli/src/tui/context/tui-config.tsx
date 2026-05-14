import type React from "react"
import { createContext, useContext, useMemo, useState } from "react"
import type { TuiConfig as TuiConfigNS } from "../../cli/config/tui"
import { TuiConfig } from "../../cli/config/tui"

export type TuiConfigState = TuiConfigNS.Info & {
  update: (partial: Partial<TuiConfigNS.Info>) => void
}

const TuiConfigContext = createContext<TuiConfigState | undefined>(undefined)

export function useTuiConfig(): TuiConfigState {
  const context = useContext(TuiConfigContext)
  if (context === undefined) {
    throw new Error("TuiConfig context must be used within a context provider")
  }
  return context
}

export function TuiConfigProvider({
  children,
  config: initialConfig,
}: {
  children?: React.ReactNode
  config: TuiConfigNS.Info
}) {
  const [config, setConfig] = useState(initialConfig)

  const value = useMemo(
    () => ({
      ...config,
      update: (partial: Partial<TuiConfigNS.Info>) => {
        setConfig((c) => ({ ...c, ...partial }))
        // Persist to settings.json — fire-and-forget; UI updates synchronously via useState
        void TuiConfig.update(partial)
      },
    }),
    [config],
  )

  return <TuiConfigContext.Provider value={value}>{children}</TuiConfigContext.Provider>
}
