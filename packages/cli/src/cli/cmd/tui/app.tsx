import { render } from "@liteai/ink"
import { App as ReactApp } from "../../../tui/app"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"

export async function tui(input: {
  url: string
  args: any
  config: any
  directory?: string
  projectID?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: any
}) {
  const unguard = win32InstallCtrlCGuard()
  win32DisableProcessedInput()

  return new Promise<void>((resolve) => {
    void (async () => {
      const { waitUntilExit } = await render(<ReactApp {...input} />)
      await waitUntilExit()
      unguard?.()
      resolve()
    })()
  })
}
