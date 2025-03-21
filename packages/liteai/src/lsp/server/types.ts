import type { ChildProcessWithoutNullStreams } from "node:child_process"

export interface Handle {
  process: ChildProcessWithoutNullStreams
  initialization?: Record<string, unknown>
}

export type RootFunction = (file: string) => Promise<string | undefined>

export interface Info {
  id: string
  extensions: string[]
  global?: boolean
  root: RootFunction
  spawn(root: string): Promise<Handle | undefined>
}
