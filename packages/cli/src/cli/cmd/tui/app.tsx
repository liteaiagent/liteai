import { render } from "@liteai/ink"
import { type AppProps, App as ReactApp } from "../../../tui/app"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"

export async function tui(input: AppProps) {
  const unguard = win32InstallCtrlCGuard()
  win32DisableProcessedInput()

  return new Promise<void>((resolve) => {
    void (async () => {
      const { waitUntilExit } = await render(<ReactApp {...input} />, { exitOnCtrlC: false })
      await waitUntilExit()
      unguard?.()
      resolve()
    })()
  })
}
