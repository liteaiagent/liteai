import type React from "react"
import { createContext, useContext } from "react"

export interface Args {
  model?: string
  agent?: string
  prompt?: string
  continue?: boolean
  sessionID?: string
  fork?: boolean
}

const ArgsContext = createContext<Args | undefined>(undefined)

export function useArgs(): Args {
  const context = useContext(ArgsContext)
  if (context === undefined) {
    throw new Error("Args context must be used within a context provider")
  }
  return context
}

export function ArgsProvider({ children, ...props }: { children?: React.ReactNode } & Args) {
  return <ArgsContext.Provider value={props}>{children}</ArgsContext.Provider>
}
