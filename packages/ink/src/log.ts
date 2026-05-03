import { logForDebugging } from './debug.js'

export const logError = (err: Error | string, ...args: unknown[]) => {
  const msg = args.length ? `[ink error] ${String(err)} ${args.map(String).join(' ')}` : `[ink error] ${String(err)}`
  logForDebugging(msg, { level: 'error' })
}
