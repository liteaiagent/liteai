import { useEffect, useState } from "react"
import { useTuiConfig } from "../context/tui-config"
import { writeOutputFile } from "../util/output-file"

/**
 * Hook that manages writing large tool output to a local temp file.
 *
 * When `output` exceeds the configured threshold the content is persisted
 * to disk (fire-and-forget) and `savedPath` is populated so the component
 * can render a file-path reference instead of inlining the full text.
 *
 * The write is only triggered once: after `savedPath` is set subsequent
 * renders are no-ops even if `output` keeps growing.
 */
export function useOutputFile(opts: {
  output: string
  sessionID: string | undefined
  callID: string
  threshold?: number
}): {
  savedPath: string | null
} {
  const config = useTuiConfig()
  const limit = opts.threshold ?? config.output_file_threshold ?? 5000
  const [savedPath, setSavedPath] = useState<string | null>(null)

  useEffect(() => {
    if (opts.sessionID && opts.output.length > limit && !savedPath) {
      writeOutputFile({
        sessionID: opts.sessionID,
        callID: opts.callID,
        content: opts.output,
      }).then(setSavedPath)
    }
  }, [opts.output, opts.sessionID, opts.callID, limit, savedPath])

  return { savedPath }
}
