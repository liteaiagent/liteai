// biome-ignore lint/style/noRestrictedImports: use-delayed-escape-close is an exception — uses useInput directly
import { useInput } from "@liteai/ink"
import { useEffect, useState } from "react"

/**
 * A hook that handles delayed activation of an escape key listener to close a dialog.
 * This prevents stale escape bytes in the terminal input buffer from immediately closing the dialog on mount.
 */
export function useDelayedEscapeClose(onClose: () => void, delayMs = 50) {
  const [escActive, setEscActive] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => setEscActive(true), delayMs)
    return () => clearTimeout(id)
  }, [delayMs])

  useInput(
    (_input, key) => {
      if (key.escape) onClose()
    },
    { isActive: escActive },
  )
}
