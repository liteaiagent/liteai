/**
 * Large text paste truncation utilities.
 * Ported from MVP `PromptInput/inputPaste.ts`.
 *
 * When the user pastes text exceeding TRUNCATION_THRESHOLD characters, the
 * visible input is truncated with a numbered placeholder. The full content
 * is stored in a `PastedContent` record so it can be reconstructed at submit
 * time.
 */

const TRUNCATION_THRESHOLD = 10_000
const PREVIEW_LENGTH = 1_000

/**
 * Pasted content record — tracks truncated text and image attachments.
 */
export type PastedContent = {
  readonly id: number
  readonly type: "text" | "image"
  readonly content: string
  readonly mediaType?: string
  readonly filename?: string
  readonly dimensions?: ImageDimensions
  readonly sourcePath?: string
}

/**
 * Image dimension metadata for coordinate mapping when images are resized.
 */
export type ImageDimensions = {
  readonly originalWidth?: number
  readonly originalHeight?: number
  readonly displayWidth?: number
  readonly displayHeight?: number
}

type TruncatedMessage = {
  readonly truncatedText: string
  readonly placeholderContent: string
}

/**
 * Count the number of newline-delimited lines in the given text.
 * Inlined from MVP `history.ts#getPastedTextRefNumLines`.
 */
function countLines(text: string): number {
  return text.split("\n").length
}

/**
 * Format the placeholder reference string shown in the truncated input.
 */
function formatTruncatedTextRef(id: number, numLines: number): string {
  return `[...Truncated text #${id} +${numLines} lines...]`
}

/**
 * If the input text exceeds the truncation threshold, split it into a
 * truncated display string + the hidden content that was removed.
 *
 * @param text       Raw input text
 * @param nextPasteId  Numeric ID for the truncated placeholder reference
 * @returns The truncated text and the hidden content (empty string if not truncated)
 */
export function maybeTruncateMessageForInput(text: string, nextPasteId: number): TruncatedMessage {
  if (text.length <= TRUNCATION_THRESHOLD) {
    return { truncatedText: text, placeholderContent: "" }
  }

  const startLength = Math.floor(PREVIEW_LENGTH / 2)
  const endLength = Math.floor(PREVIEW_LENGTH / 2)

  const startText = text.slice(0, startLength)
  const endText = text.slice(-endLength)

  const placeholderContent = text.slice(startLength, -endLength)
  const truncatedLines = countLines(placeholderContent)

  const placeholderRef = formatTruncatedTextRef(nextPasteId, truncatedLines)
  const truncatedText = startText + placeholderRef + endText

  return { truncatedText, placeholderContent }
}

/**
 * Apply truncation to the current input and merge the result into the
 * pasted contents record.
 *
 * @param input           Current input value
 * @param pastedContents  Existing pasted content map
 * @returns Updated input string and pasted contents (unchanged if no truncation)
 */
export function maybeTruncateInput(
  input: string,
  pastedContents: Record<number, PastedContent>,
): { newInput: string; newPastedContents: Record<number, PastedContent> } {
  const existingIds = Object.keys(pastedContents).map(Number)
  const nextPasteId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1

  const { truncatedText, placeholderContent } = maybeTruncateMessageForInput(input, nextPasteId)

  if (!placeholderContent) {
    return { newInput: input, newPastedContents: pastedContents }
  }

  return {
    newInput: truncatedText,
    newPastedContents: {
      ...pastedContents,
      [nextPasteId]: {
        id: nextPasteId,
        type: "text",
        content: placeholderContent,
      },
    },
  }
}
