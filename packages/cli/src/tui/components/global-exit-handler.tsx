/**
 * Global exit handler component.
 *
 * Mounts `useExitOnCtrlCD` at the app level so Ctrl+C / Ctrl+D double-press
 * exit works from any screen. Exposes the pending exit state via React context
 * so UI components (status line, footer) can render "Press X again to exit".
 */

import type React from "react"
import { createContext, useContext } from "react"
import { type ExitState, useExitOnCtrlCD } from "../hooks/use-exit-on-ctrl-cd"

const ExitStateContext = createContext<ExitState>({ pending: false, keyName: null })

/**
 * Read the current exit state (pending double-press status).
 * Returns `{ pending: true, keyName: "Ctrl-C" }` when the user has pressed
 * Ctrl+C once and the timeout hasn't expired yet.
 */
export function useExitState(): ExitState {
  return useContext(ExitStateContext)
}

type Props = {
  children: React.ReactNode
  /** Optional interrupt handler. Return `true` if the interrupt was consumed
   *  (e.g., cancelled an in-flight generation), preventing the first press
   *  from entering the double-press exit flow. */
  onInterrupt?: () => boolean
}

/**
 * Wrap the app tree to enable double-press Ctrl+C/D exit.
 * Must be rendered inside both `ExitProvider` and `KeybindingSetup`.
 */
export function GlobalExitHandler({ children, onInterrupt }: Props): React.ReactNode {
  const exitState = useExitOnCtrlCD(onInterrupt)

  return <ExitStateContext.Provider value={exitState}>{children}</ExitStateContext.Provider>
}
