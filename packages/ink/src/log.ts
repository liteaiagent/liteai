export const logError = (err: Error | string, ...args: unknown[]) => {
  console.error(`[ink error]`, err, ...args)
}
