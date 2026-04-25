/**
 * Paste detection and routing hook.
 * Adapted port from MVP `hooks/usePasteHandler.ts`.
 *
 * This hook wraps the raw `onInput` handler and intercepts paste events,
 * routing them through image detection and large-text truncation before
 * they reach the text input handler.
 *
 * Key adaptations:
 * - `useDebounceCallback` (usehooks-ts) → manual `setTimeout`/`clearTimeout`
 * - `InputEvent` type → `@liteai/ink` `InputEvent`
 * - `Key` type → `@liteai/ink` `Key`
 * - `logError` → `Log.Default.error` from `@liteai/core/util/log`
 * - `getPlatform()` → `process.platform` directly
 */

import { Log } from "@liteai/core/util/log"
import type { InputEvent, Key } from "@liteai/ink"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ImageDimensions } from "../util/image-paste"
import { getImageFromClipboard, isImageFilePath, PASTE_THRESHOLD, tryReadImageFromPath } from "../util/image-paste"

const CLIPBOARD_CHECK_DEBOUNCE_MS = 50
const PASTE_COMPLETION_TIMEOUT_MS = 100

type PasteHandlerProps = {
  readonly onPaste?: (text: string) => void
  readonly onInput: (input: string, key: Key) => void
  readonly onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: ImageDimensions,
    sourcePath?: string,
  ) => void
}

export function usePasteHandler({ onPaste, onInput, onImagePaste }: PasteHandlerProps): {
  wrappedOnInput: (input: string, key: Key, event: InputEvent) => void
  pasteState: { chunks: string[]; timeoutId: ReturnType<typeof setTimeout> | null }
  isPasting: boolean
} {
  const [pasteState, setPasteState] = useState<{
    chunks: string[]
    timeoutId: ReturnType<typeof setTimeout> | null
  }>({ chunks: [], timeoutId: null })
  const [isPasting, setIsPasting] = useState(false)
  const isMountedRef = useRef(true)

  // Mirrors pasteState.timeoutId but updated synchronously. When paste + a
  // keystroke arrive in the same stdin chunk, both wrappedOnInput calls run
  // in the same discreteUpdates batch before React commits — the second call
  // reads stale pasteState.timeoutId (null) and takes the onInput path. If
  // that key is Enter, it submits the old input and the paste is lost.
  const pastePendingRef = useRef(false)

  const isMacOS = useMemo(() => process.platform === "darwin", [])

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // ── Clipboard image check (debounced) ─────────────────────────────────────

  const clipboardCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const checkClipboardForImage = useCallback(() => {
    if (clipboardCheckTimerRef.current) {
      clearTimeout(clipboardCheckTimerRef.current)
    }
    clipboardCheckTimerRef.current = setTimeout(() => {
      clipboardCheckTimerRef.current = null
      if (!onImagePaste || !isMountedRef.current) return

      void getImageFromClipboard()
        .then((imageData) => {
          if (imageData && isMountedRef.current) {
            onImagePaste(imageData.base64, imageData.mediaType, undefined, imageData.dimensions)
          }
        })
        .catch((error: unknown) => {
          if (isMountedRef.current) {
            Log.Default.error("[paste-handler] clipboard image read failed", { error })
          }
        })
        .finally(() => {
          if (isMountedRef.current) {
            setIsPasting(false)
          }
        })
    }, CLIPBOARD_CHECK_DEBOUNCE_MS)
  }, [onImagePaste])

  // ── Paste timeout reset ───────────────────────────────────────────────────

  const resetPasteTimeout = useCallback(
    (currentTimeoutId: ReturnType<typeof setTimeout> | null) => {
      if (currentTimeoutId) {
        clearTimeout(currentTimeoutId)
      }
      return setTimeout(
        (
          _setPasteState: typeof setPasteState,
          _onImagePaste: typeof onImagePaste,
          _onPaste: typeof onPaste,
          _setIsPasting: typeof setIsPasting,
          _checkClipboardForImage: typeof checkClipboardForImage,
          _isMacOS: boolean,
          _pastePendingRef: typeof pastePendingRef,
        ) => {
          _pastePendingRef.current = false
          _setPasteState(({ chunks }) => {
            // Join chunks and filter out orphaned focus sequences
            const pastedText = chunks.join("").replace(/\[I$/, "").replace(/\[O$/, "")

            // Check for image file paths in the pasted text.
            // When dragging multiple images, they may come as newline-separated
            // or space-separated paths.
            const lines = pastedText
              .split(/ (?=\/|[A-Za-z]:\\)/)
              .flatMap((part) => part.split("\n"))
              .filter((line) => line.trim())
            const imagePaths = lines.filter((line) => isImageFilePath(line))

            if (_onImagePaste && imagePaths.length > 0) {
              const isTempScreenshot = /\/TemporaryItems\/.*screencaptureui.*\/Screenshot/i.test(pastedText)

              void Promise.all(imagePaths.map((imagePath) => tryReadImageFromPath(imagePath))).then((results) => {
                const validImages = results.filter((r): r is NonNullable<typeof r> => r !== null)

                if (validImages.length > 0) {
                  for (const imageData of validImages) {
                    const filename = imageData.path.split("/").pop() ?? imageData.path.split("\\").pop()
                    _onImagePaste(imageData.base64, imageData.mediaType, filename, imageData.dimensions, imageData.path)
                  }
                  const nonImageLines = lines.filter((line) => !isImageFilePath(line))
                  if (nonImageLines.length > 0 && _onPaste) {
                    _onPaste(nonImageLines.join("\n"))
                  }
                  _setIsPasting(false)
                } else if (isTempScreenshot && _isMacOS) {
                  _checkClipboardForImage()
                } else {
                  if (_onPaste) {
                    _onPaste(pastedText)
                  }
                  _setIsPasting(false)
                }
              })
              return { chunks: [], timeoutId: null }
            }

            // Empty paste on macOS → check clipboard for image (Cmd+V with image)
            if (_isMacOS && _onImagePaste && pastedText.length === 0) {
              _checkClipboardForImage()
              return { chunks: [], timeoutId: null }
            }

            // Regular paste
            if (_onPaste) {
              _onPaste(pastedText)
            }
            _setIsPasting(false)
            return { chunks: [], timeoutId: null }
          })
        },
        PASTE_COMPLETION_TIMEOUT_MS,
        setPasteState,
        onImagePaste,
        onPaste,
        setIsPasting,
        checkClipboardForImage,
        isMacOS,
        pastePendingRef,
      )
    },
    [checkClipboardForImage, isMacOS, onImagePaste, onPaste],
  )

  // ── Wrapped input handler ─────────────────────────────────────────────────

  const wrappedOnInput = useCallback(
    (input: string, key: Key, event: InputEvent): void => {
      // Detect paste from the parsed keypress event.
      const isFromPaste = event.keypress.isPasted

      if (isFromPaste) {
        setIsPasting(true)
      }

      // Check if pasted text contains image file paths
      const hasImageFilePath = input
        .split(/ (?=\/|[A-Za-z]:\\)/)
        .flatMap((part) => part.split("\n"))
        .some((line) => isImageFilePath(line.trim()))

      // Handle empty paste (clipboard image on macOS)
      if (isFromPaste && input.length === 0 && isMacOS && onImagePaste) {
        checkClipboardForImage()
        setIsPasting(false)
        return
      }

      // Handle as paste if: bracketed paste, large input, continuation, or image path
      const shouldHandleAsPaste =
        onPaste && (input.length > PASTE_THRESHOLD || pastePendingRef.current || hasImageFilePath || isFromPaste)

      if (shouldHandleAsPaste) {
        pastePendingRef.current = true
        setPasteState(({ chunks, timeoutId }) => {
          return {
            chunks: [...chunks, input],
            timeoutId: resetPasteTimeout(timeoutId),
          }
        })
        return
      }

      onInput(input, key)

      if (input.length > 10) {
        // Ensure isPasting is turned off on multicharacter input, since the
        // stdin buffer may chunk at arbitrary points and split the closing
        // escape sequence.
        setIsPasting(false)
      }
    },
    [checkClipboardForImage, isMacOS, onImagePaste, onInput, onPaste, resetPasteTimeout],
  )

  return { wrappedOnInput, pasteState, isPasting }
}
