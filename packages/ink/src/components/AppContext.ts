import { createContext } from 'react'

export type TerminalColors = {
  palette: (string | undefined)[]
  defaultForeground?: string
  defaultBackground?: string
}

export type AppContextProps = {
  /**
   * Exit (unmount) the whole Ink app.
   */
  readonly exit: (error?: Error) => void

  /**
   * Query the terminal for its current color palette (OSC 10/11 and palette 0-15).
   */
  readonly getPalette: (options: { size: number }) => Promise<TerminalColors>

  /**
   * Clear the cached palette results so the next getPalette() re-queries.
   */
  readonly clearPaletteCache: () => void

  /**
   * Suspend Ink and hand over the terminal to an external TUI.
   */
  readonly suspend: () => void

  /**
   * Resume Ink after an external TUI handoff.
   */
  readonly resume: () => void

  /**
   * Toggle the internal Ink debug repaints overlay.
   */
  readonly toggleDebugOverlay: () => void

  /**
   * Toggle the internal Ink console overlay.
   */
  readonly toggleConsole: () => void
}

/**
 * `AppContext` is a React context, which exposes a method to manually exit the app (unmount)
 * and various low-level renderer and terminal control APIs.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
const AppContext = createContext<AppContextProps>({
  exit() {},
  async getPalette() {
    return { palette: [] }
  },
  clearPaletteCache() {},
  suspend() {},
  resume() {},
  toggleDebugOverlay() {},
  toggleConsole() {},
})

// eslint-disable-next-line custom-rules/no-top-level-side-effects
AppContext.displayName = 'InternalAppContext'

export default AppContext
