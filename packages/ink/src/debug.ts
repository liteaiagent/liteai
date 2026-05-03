// Captured at module evaluation time — before the Ink constructor runs
// patchConsole() or patchStderr(). This reference points to the original,
// kernel-backed stderr.write and is immune to any later monkey-patching.
// This is what makes console-recursion structurally impossible.
const _write = process.stderr.write.bind(process.stderr)

export const logForDebugging = (message: string, _opts?: { level?: string }) => {
  if (process.env.LITEAI_DEBUG_INK) {
    _write(`[ink] ${message}\n`)
  }
}
