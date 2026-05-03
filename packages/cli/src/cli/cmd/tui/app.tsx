import { render } from "@liteai/ink"
import { type AppProps, App as ReactApp } from "../../../tui/app"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"

export async function tui(input: AppProps) {
  const unguard = win32InstallCtrlCGuard()
  win32DisableProcessedInput()

  try {
    const { waitUntilExit } = await render(<ReactApp {...input} />, { exitOnCtrlC: false })
    await waitUntilExit()
  } finally {
    // Restore ENABLE_PROCESSED_INPUT so Ctrl+C generates SIGINT again.
    // Critical when Ink unmounts on error: componentDidCatch → unmount
    // removes the stdin readable listener and rejects waitUntilExit.
    // Without unguard, SIGINT stays disabled and the process is unkillable.
    unguard?.()
  }
}
