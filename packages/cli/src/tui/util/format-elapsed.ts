/** Integer-snapped for live displays: "3s", "1m 42s", "1h 5m", or "" if <1s */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return ""

  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m`
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  return `${seconds}s`
}

/** Compact token count: "1.2K", "3.5M" */
export function formatTokenCount(n: number): string {
  if (n < 1000) return n.toString()
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`.replace(/\.0K$/, "K")
  return `${(n / 1_000_000).toFixed(1)}M`.replace(/\.0M$/, "M")
}
